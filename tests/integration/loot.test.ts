import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, bosses, guilds, instances, legacyWowItems, lootEntries, lootNameAliases, users, wowItems } from "@/db/schema";
import type { Db } from "@/db/types";
import { AuthorizationError } from "@/lib/authz/policy";
import type { ItemLookup } from "@/server/blizzard/client";
import { TOMBSTONE, deleteGuild, deleteUserAccount, exportUserData } from "@/server/services/account";
import { seedDemoGuild } from "@/db/seed";
import { createCharacter } from "@/server/services/characters";
import { refreshItemCache, resolveItems } from "@/server/services/items";
import {
  awardLoot,
  characterLoot,
  commitImport,
  discardImport,
  getImportPreview,
  listLoot,
  listRaidNights,
  previewImport,
  purgeStaleLootDrafts,
  reverseLoot,
} from "@/server/services/loot";
import { createGuild, createMember, createTestDb, createVisitor } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

// WoW: Forever launches Nov 4, 2026; loot can't be dated before it or in the future.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-12-11T04:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/loot", name), "utf8");

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  return "resolved";
}

async function setup() {
  const guild = await createGuild(db);
  const gm = await createMember(db, guild, "Grand Master");
  const marshal = await createMember(db, guild, "Marshal");
  const knight = await createMember(db, guild, "Knight");
  const squire = await createMember(db, guild, "Squire");
  const applicant = await createMember(db, guild, "Postulant", "applicant");
  const visitor = await createVisitor(db, guild.guild.id);
  const add = async (actor: typeof knight, name: string, surname: string, wowClass: string, spec: string, role: string) =>
    (await createCharacter(db, actor, { faction: "alliance", wowClass, spec, role, level: "60", professions: [], name, surname }))!;
  const cassian = await add(knight, "Cassian", "Blackmere", "rogue", "Combat", "melee");
  const ambrose = await add(squire, "Ambrose", "Duskmantle", "warlock", "Destruction", "ranged");
  const athanasius = await add(marshal, "Athanasius", "Highcrest", "warrior", "Protection", "tank");
  const godfrey = await add(gm, "Godfrey", "Shieldmere", "paladin", "Protection", "tank");
  return { guild, gm, marshal, knight, squire, applicant, visitor, cassian, ambrose, athanasius, godfrey };
}

async function award(g: Awaited<ReturnType<typeof setup>>, extra: Record<string, string> = {}) {
  return awardLoot(db, g.marshal, {
    item: "|cffa335ee|Hitem:18203::::::::60:::::|h[Eskhandar's Right Claw]|h|r",
    characterId: g.cassian.id,
    response: "council",
    awardedOn: "2026-12-10",
    note: "",
    ...extra,
  });
}

describe("permissions", () => {
  it("lets members read loot, officers record it, and visitors in only when the guild makes it public", async () => {
    const g = await setup();
    await award(g);

    for (const actor of [g.visitor, g.applicant]) {
      await expect(listLoot(db, actor)).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(await listLoot(db, g.squire)).toHaveLength(1);
    expect(await listRaidNights(db, g.knight)).toEqual([{ raidDate: "2026-12-10", items: 1, instances: [] }]);

    await db.update(guilds).set({ lootPublic: true }).where(eq(guilds.id, g.guild.guild.id));
    expect(await listLoot(db, g.visitor)).toHaveLength(1);
    expect(await characterLoot(db, { ...g.visitor, userId: null }, g.cassian.id)).toHaveLength(1);

    await expect(award(g, {})).resolves.toBeTruthy();
    await expect(awardLoot(db, g.knight, { item: "18203", characterId: g.cassian.id, response: "roll", awardedOn: "2026-12-10" })).rejects.toThrow(
      /Oficial/,
    );
    const [entry] = await listLoot(db, g.marshal);
    await expect(reverseLoot(db, g.knight, { entryId: entry!.id, reason: "No" })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(previewImport(db, g.knight, { raw: fixture("gargul.json") })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(previewImport(db, g.visitor, { raw: fixture("gargul.json") })).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("recording by hand", () => {
  it("records an award from an item link with the recipient's full name, and audits it", async () => {
    const g = await setup();
    const result = await award(g, { note: "Best in slot" });
    expect(result).toMatchObject({ itemName: "Eskhandar's Right Claw", recipientName: "Cassian Blackmere" });

    const [row] = await listLoot(db, g.squire);
    expect(row).toMatchObject({
      itemId: 18203,
      itemName: "Eskhandar's Right Claw",
      character: { id: g.cassian.id, name: "Cassian" },
      response: "council",
      raidDate: "2026-12-10",
      source: "manual",
      note: "Best in slot",
      reversal: null,
    });
    // It's 11pm on Dec 10 in the guild's zone (Eastern), so tonight's award keeps the real time.
    expect(row!.awardedAt.toISOString()).toBe("2026-12-11T04:00:00.000Z");
    const earlier = await award(g, { awardedOn: "2026-12-08" });
    const backdated = (await listLoot(db, g.squire)).find((r) => r.id === earlier.id);
    expect(backdated!.awardedAt.toISOString()).toBe("2026-12-09T01:00:00.000Z");
    const [audit] = await db.select().from(auditLog).where(eq(auditLog.action, "loot.award"));
    expect(audit!.after).toMatchObject({ characterName: "Cassian Blackmere", itemName: "Eskhandar's Right Claw" });

    // The link taught the cache the item's name, so the name alone now works.
    const byName = await award(g, { item: "eskhandar's right claw" });
    expect(byName.itemName).toBe("Eskhandar's Right Claw");
  });

  it("requires a recipient unless the item was disenchanted or banked, and rejects unknown names and bad dates", async () => {
    const g = await setup();
    await expect(award(g, { characterId: "" })).rejects.toThrow(/Elige quién recibió el objeto/);
    await expect(award(g, { characterId: "", response: "disenchant" })).resolves.toMatchObject({ recipientName: null });
    await expect(award(g, { item: "Sword of Nobody" })).rejects.toThrow(/ningún objeto llamado/);
    await expect(award(g, { awardedOn: "2026-10-01" })).rejects.toThrow(/anterior al lanzamiento de World of Warcraft: Forever/);
    await expect(award(g, { awardedOn: "2027-01-01" })).rejects.toThrow(/fecha futura/);
    const other = await setup();
    await expect(award(g, { characterId: other.cassian.id })).rejects.toThrow(/No se ha encontrado el personaje/);
  });

  it("names an ID-only item from Blizzard when configured, else as a placeholder", async () => {
    const g = await setup();
    const plain = await award(g, { item: "19999" });
    expect(plain.itemName).toBe("Item #19999");
    const client = { getItem: async (): Promise<ItemLookup> => ({ status: "ok", item: { itemId: 19998, name: "Test Blade", quality: 4, itemLevel: 70, icon: "inv_sword_39" } }) };
    const fetched = await awardLoot(db, g.marshal, { item: "https://www.wowhead.com/classic/item=19998", characterId: g.cassian.id, response: "roll", awardedOn: "2026-12-10" }, { client });
    expect(fetched.itemName).toBe("Test Blade");
    const rows = await listLoot(db, g.marshal);
    expect(rows.find((r) => r.itemId === 19998)).toMatchObject({ icon: "inv_sword_39", quality: 4, itemFromBlizzard: true });
  });
});

describe("reversals", () => {
  it("strikes an award with a reason, once, and never reverses a reversal", async () => {
    const g = await setup();
    const { id } = await award(g);
    const reversal = await reverseLoot(db, g.marshal, { entryId: id, reason: "Wrong rogue" });
    const [row] = await listLoot(db, g.squire);
    expect(row!.reversal).toMatchObject({ reason: "Wrong rogue" });
    expect(await listRaidNights(db, g.squire)).toEqual([{ raidDate: "2026-12-10", items: 0, instances: [] }]);

    await expect(reverseLoot(db, g.marshal, { entryId: id, reason: "Again" })).rejects.toThrow(/ya se anuló/);
    await expect(reverseLoot(db, g.marshal, { entryId: reversal.id, reason: "Undo" })).rejects.toThrow(/Solo se pueden anular entregas/);
    await expect(reverseLoot(db, g.marshal, { entryId: id, reason: "" })).rejects.toThrow();

    const [copy] = await db.select().from(lootEntries).where(eq(lootEntries.id, reversal.id));
    expect(copy).toMatchObject({ kind: "reversal", reversesEntryId: id, itemId: 18203, characterId: g.cassian.id, raidDate: "2026-12-10", note: "Wrong rogue" });
  });
});

describe("the append-only guard", () => {
  it("rejects edits and deletes, but lets references become NULL and identity be redacted during deletion", async () => {
    const g = await setup();
    const { id } = await award(g, { note: "Council agreed" });
    const where = eq(lootEntries.id, id);

    expect(await rejection(db.update(lootEntries).set({ itemName: "Something else" }).where(where))).toMatch(/append-only; changing item_name/);
    expect(await rejection(db.update(lootEntries).set({ response: "roll" }).where(where))).toMatch(/append-only/);
    expect(await rejection(db.delete(lootEntries).where(where))).toMatch(/DELETE is not allowed/);
    expect(await rejection(db.update(lootEntries).set({ recipientName: TOMBSTONE }).where(where))).toMatch(/append-only/);

    await db.update(lootEntries).set({ characterId: null }).where(where);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('guildbook.audit_redact', 'on', true)`);
      await tx.update(lootEntries).set({ recipientName: TOMBSTONE, note: TOMBSTONE }).where(where);
    });
    const [row] = await db.select().from(lootEntries).where(where);
    expect(row).toMatchObject({ characterId: null, recipientName: TOMBSTONE, note: TOMBSTONE });
    const redactingToOther = db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('guildbook.audit_redact', 'on', true)`);
      await tx.update(lootEntries).set({ recipientName: "Someone" }).where(where);
    });
    expect(await rejection(redactingToOther)).toMatch(/append-only/);
  });

  it("rejects links to another guild's characters, and reversals of another guild's awards", async () => {
    const a = await setup();
    const b = await setup();
    const base = { kind: "award" as const, itemId: 1, itemName: "X", response: "roll" as const, awardedAt: new Date(), raidDate: "2026-12-10", source: "manual" as const };
    expect(await rejection(db.insert(lootEntries).values({ ...base, guildId: a.guild.guild.id, characterId: b.cassian.id }))).toMatch(/foreign key|loot_entries_character_fk/);

    const { id } = await award(b);
    expect(
      await rejection(db.insert(lootEntries).values({ ...base, guildId: a.guild.guild.id, kind: "reversal", reversesEntryId: id })),
    ).toMatch(/must reverse an award|foreign key/);
  });
});

describe("imports", () => {
  it("previews a Gargul export, matches names, commits, remembers choices and skips re-imports", async () => {
    const g = await setup();
    const { batchId, rows, warnings } = await previewImport(db, g.marshal, { raw: fixture("gargul.json") });
    expect({ rows, warnings }).toEqual({ rows: 5, warnings: 1 });

    const preview = await getImportPreview(db, g.marshal, batchId);
    const names = Object.fromEntries(preview.names.map((n) => [n.key, n.match ? [n.match.via, n.match.character.id] : null]));
    expect(names).toEqual({
      cassian: ["first_name", g.cassian.id],
      "ambrose duskmantle": ["name", g.ambrose.id],
      athanasius: ["first_name", g.athanasius.id],
      godfrey: ["first_name", g.godfrey.id],
    });
    expect(preview.duplicateCount).toBe(0);

    const result = await commitImport(db, g.marshal, {
      batchId,
      decisions: {
        cassian: `char:${g.cassian.id}`,
        "ambrose duskmantle": `char:${g.ambrose.id}`,
        athanasius: "name",
        godfrey: `char:${g.godfrey.id}`,
      },
      remember: "on",
    });
    expect(result).toEqual({ inserted: 5, duplicates: 0, skipped: 0 });

    const ledger = await listLoot(db, g.squire);
    const byItem = new Map(ledger.map((r) => [r.itemId, r]));
    expect(byItem.get(18203)).toMatchObject({ character: { id: g.cassian.id }, recipientName: "Cassian Blackmere", source: "gargul", raidDate: "2026-12-08" });
    expect(byItem.get(17073)).toMatchObject({ character: null, recipientName: "Athanasius" });
    expect(byItem.get(18264)).toMatchObject({ character: null, recipientName: null, response: "disenchant" });
    expect(byItem.get(16863)).toMatchObject({ character: { id: g.godfrey.id }, itemName: "Gauntlets of Might" });

    const aliases = await db.select().from(lootNameAliases).where(eq(lootNameAliases.guildId, g.guild.guild.id));
    expect(aliases.map((a) => a.alias).sort()).toEqual(["cassian", "godfrey"]);

    await expect(commitImport(db, g.marshal, { batchId })).rejects.toThrow(/ya se confirmó/);

    // The same export again, and Gargul's TMB export of the same raid (same checksums), add nothing twice.
    const again = await previewImport(db, g.marshal, { raw: fixture("gargul.json") });
    const againPreview = await getImportPreview(db, g.marshal, again.batchId);
    expect(againPreview.duplicateCount).toBe(5);
    expect(againPreview.names.find((n) => n.key === "godfrey")?.match?.via).toBe("alias");
    expect(await commitImport(db, g.marshal, { batchId: again.batchId })).toEqual({ inserted: 0, duplicates: 5, skipped: 0 });

    const tmb = await previewImport(db, g.marshal, { raw: fixture("gargul-tmb.csv") });
    const tmbResult = await commitImport(db, g.marshal, { batchId: tmb.batchId, decisions: { godfrey: "skip" } });
    expect(tmbResult).toEqual({ inserted: 0, duplicates: 3, skipped: 1 });

    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.guildId, g.guild.guild.id), eq(auditLog.action, "loot.import")));
    expect(audit!.after).toMatchObject({ inserted: 5, parser: "gargul-json" });
  });

  it("links RCLootCouncil awards to the guild's instances and bosses by name", async () => {
    const g = await setup();
    const [mc] = await db.insert(instances).values({ guildId: g.guild.guild.id, name: "Molten Core", shortName: "MC", size: 40 }).returning();
    const [garr] = await db.insert(bosses).values({ guildId: g.guild.guild.id, instanceId: mc!.id, name: "Garr" }).returning();
    const { batchId } = await previewImport(db, g.marshal, { raw: fixture("rclc.csv"), parserId: "rclc-csv" });
    expect(await commitImport(db, g.marshal, { batchId })).toMatchObject({ inserted: 4 });
    const rows = await db.select().from(lootEntries).where(eq(lootEntries.guildId, g.guild.guild.id));
    expect(rows.find((r) => r.itemId === 19019)).toMatchObject({ instanceId: mc!.id, bossId: garr!.id, votes: 5, source: "rclc" });
    expect(rows.find((r) => r.itemId === 18203)).toMatchObject({ instanceId: null, instanceName: "Onyxia's Lair", bossName: "Onyxia" });
  });

  it("rejects exports it can't read and discards drafts", async () => {
    const g = await setup();
    await expect(previewImport(db, g.marshal, { raw: "hello" })).rejects.toThrow(/no parece una exportación de Gargul ni de RCLootCouncil/);
    const { batchId } = await previewImport(db, g.marshal, { raw: fixture("rclc.json") });
    await discardImport(db, g.marshal, batchId);
    await expect(getImportPreview(db, g.marshal, batchId)).rejects.toThrow(/se descartó/);
    vi.setSystemTime(new Date("2026-12-30T00:00:00Z"));
    expect(await purgeStaleLootDrafts(db)).toBeGreaterThanOrEqual(1);
  });
});

describe("privacy", () => {
  it("exports a member's loot, and on account deletion keeps the rows but replaces their name", async () => {
    const g = await setup();
    const { id } = await award(g, { note: "For Cassian" });
    await award(g, { characterId: g.ambrose.id, item: "18203" });

    const exported = await exportUserData(db, g.knight.userId);
    expect(exported.lootReceived).toEqual([expect.objectContaining({ itemId: 18203, recipientName: "Cassian Blackmere", note: "For Cassian" })]);

    const [user] = await db.select().from(users).where(eq(users.id, g.knight.userId));
    await deleteUserAccount(db, g.knight.userId, user!.name!);

    const [row] = await db.select().from(lootEntries).where(eq(lootEntries.id, id));
    expect(row).toMatchObject({ characterId: null, recipientName: TOMBSTONE, note: TOMBSTONE, itemName: "Eskhandar's Right Claw" });
    const others = await listLoot(db, g.squire);
    expect(others.find((r) => r.character?.id === g.ambrose.id)?.recipientName).toBe("Ambrose Duskmantle");
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.action, "loot.award"), eq(auditLog.targetId, id)));
    expect(audit!.after).toMatchObject({ characterName: TOMBSTONE });
  });

  it("deletes a guild with its loot ledger", async () => {
    const g = await setup();
    const { id } = await award(g);
    await reverseLoot(db, g.marshal, { entryId: id, reason: "Test" });
    await previewImport(db, g.marshal, { raw: fixture("gargul.json") });
    await deleteGuild(db, g.gm, g.guild.guild.name);
    expect(await db.select().from(lootEntries).where(eq(lootEntries.guildId, g.guild.guild.id))).toEqual([]);
  });
});

describe("demo seed", () => {
  it("seeds the first two raid nights' loot, with one reversed award", async () => {
    const guild = await seedDemoGuild(db, "loot-seed");
    const rows = await db.select().from(lootEntries).where(eq(lootEntries.guildId, guild.id));
    expect(rows.filter((r) => r.kind === "award")).toHaveLength(17);
    expect(rows.filter((r) => r.kind === "reversal")).toEqual([expect.objectContaining({ itemId: 16860, recipientName: "Godfrey Shieldmere" })]);
    expect(new Set(rows.map((r) => r.raidDate))).toEqual(new Set(["2026-12-08", "2026-12-10"]));
    expect(rows.every((r) => r.bossId && r.instanceId)).toBe(true);
  });
});

describe("item cache", () => {
  const item = (itemId: number, name: string, itemLevel = 60): ItemLookup => ({ status: "ok", item: { itemId, name, quality: 3, itemLevel, icon: "inv_misc_gem_01" } });

  it("fills gaps from Blizzard at most daily per item, and lets import names win", async () => {
    let calls = 0;
    const client = { getItem: async (id: number): Promise<ItemLookup> => (calls++, id === 30001 ? item(id, "Blizzard Name") : { status: "missing" }) };
    const first = await resolveItems(db, [30001, 30002], { client, version: "forever" });
    expect(first.get(30001)).toMatchObject({ name: "Blizzard Name", icon: "inv_misc_gem_01", fromBlizzard: true });
    expect(first.has(30002)).toBe(false);
    expect(calls).toBe(2);
    await resolveItems(db, [30001], { client, version: "forever" });
    expect(calls).toBe(2);

    const g = await setup();
    await awardLoot(db, g.marshal, { item: "Import Name (#30001)", characterId: g.cassian.id, response: "roll", awardedOn: "2026-12-10" });
    const [row] = await db.select().from(wowItems).where(and(eq(wowItems.gameVersion, "forever"), eq(wowItems.itemId, 30001)));
    expect(row).toMatchObject({ name: "Import Name", nameSource: "manual", icon: "inv_misc_gem_01" });
  });

  it("keeps each game version's item separately, looked up in that version's namespace", async () => {
    const asked: [number, string][] = [];
    const client = {
      getItem: async (id: number, version = "forever"): Promise<ItemLookup> => (asked.push([id, version]), item(id, "Shared Blade", version === "anniversary" ? 115 : 63)),
    };
    const forever = await resolveItems(db, [31001], { client, version: "forever" });
    const anniversary = await resolveItems(db, [31001], { client, version: "anniversary" });
    expect(asked).toEqual([
      [31001, "forever"],
      [31001, "anniversary"],
    ]);
    expect(forever.get(31001)).toMatchObject({ itemLevel: 63 });
    expect(anniversary.get(31001)).toMatchObject({ itemLevel: 115 });
    // Cached per version: neither lookup repeats, and each version reads its own row.
    expect((await resolveItems(db, [31001], { client, version: "anniversary" })).get(31001)?.itemLevel).toBe(115);
    expect(asked).toHaveLength(2);
    // Versions Battle.net doesn't serve are never looked up.
    expect((await resolveItems(db, [31001], { client, version: "era" })).size).toBe(0);
    expect(asked).toHaveLength(2);
  });

  it("shows an Anniversary guild's loot with Anniversary item details and a TBC Wowhead link", async () => {
    const guild = await createGuild(db, { gameVersion: "anniversary", realmSlug: "dreamscythe", faction: "horde" });
    const officer = await createMember(db, guild, "Oficial");
    await db.insert(wowItems).values([
      { gameVersion: "forever", itemId: 31002, name: "Era Name", nameSource: "import", icon: "era_icon", itemLevel: 60 },
      { gameVersion: "anniversary", itemId: 31002, name: "Anniversary Name", nameSource: "import", icon: "tbc_icon", itemLevel: 110 },
    ]);
    await awardLoot(db, officer, { item: "31002", response: "disenchant", awardedOn: "2026-12-10" });
    const [row] = await listLoot(db, officer);
    expect(row).toMatchObject({ itemId: 31002, itemName: "Anniversary Name", icon: "tbc_icon", gameVersion: "anniversary" });
    const { wowheadItemUrl } = await import("@/lib/loot/items");
    expect(wowheadItemUrl(31002, row!.gameVersion)).toBe("https://www.wowhead.com/tbc/item=31002");
    expect(wowheadItemUrl(31002, "forever")).toBe("https://www.wowhead.com/classic/item=31002");
  });

  it("refreshes Blizzard data after 25 days in each row's version and deletes what can't be refreshed within 30", async () => {
    const now = new Date("2026-12-11T00:00:00Z");
    const day = 86_400_000;
    await db.insert(wowItems).values([
      { gameVersion: "forever", itemId: 40001, name: "Stale Blizzard", nameSource: "blizzard", detailsSource: "blizzard", icon: "a", itemLevel: 60, blizzardFetchedAt: new Date(now.getTime() - 26 * day) },
      { gameVersion: "anniversary", itemId: 40001, name: "Stale Blizzard", nameSource: "blizzard", detailsSource: "blizzard", icon: "a", itemLevel: 60, blizzardFetchedAt: new Date(now.getTime() - 26 * day) },
      { gameVersion: "forever", itemId: 40002, name: "Expired Blizzard", nameSource: "blizzard", detailsSource: "blizzard", icon: "b", blizzardFetchedAt: new Date(now.getTime() - 31 * day) },
      { gameVersion: "forever", itemId: 40003, name: "Imported", nameSource: "import", quality: 4, detailsSource: "blizzard", icon: "c", blizzardFetchedAt: new Date(now.getTime() - 31 * day) },
    ]);
    const asked: string[] = [];
    const client = {
      getItem: async (id: number, version = "forever"): Promise<ItemLookup> => {
        asked.push(`${version}:${id}`);
        return id === 40001 ? item(id, "Fresh Blizzard", version === "anniversary" ? 110 : 62) : { status: "error" };
      },
    };
    const result = await refreshItemCache(db, client, now);
    expect(result).toMatchObject({ refreshed: 2, deleted: 1, cleared: 1 });
    expect(asked).toEqual(expect.arrayContaining(["forever:40001", "anniversary:40001"]));
    const rows = await db
      .select()
      .from(wowItems)
      .where(sql`${wowItems.itemId} between 40001 and 40003`)
      .orderBy(wowItems.itemId, wowItems.gameVersion);
    expect(rows.map((r) => [r.gameVersion, r.itemId, r.name, r.icon, r.itemLevel, r.detailsSource])).toEqual([
      ["forever", 40001, "Fresh Blizzard", "inv_misc_gem_01", 62, "blizzard"],
      ["anniversary", 40001, "Fresh Blizzard", "inv_misc_gem_01", 110, "blizzard"],
      ["forever", 40003, "Imported", null, null, null],
    ]);
  });

  it("fills in rows that were never looked up, and drops expired Blizzard data from the pre-version table", async () => {
    const now = new Date("2026-12-11T00:00:00Z");
    const day = 86_400_000;
    await db.insert(wowItems).values({ gameVersion: "anniversary", itemId: 40010, name: "Copied", nameSource: "import", icon: "x" });
    await db.insert(legacyWowItems).values([
      { itemId: 40011, name: "Old Blizzard", nameSource: "blizzard", detailsSource: "blizzard", blizzardFetchedAt: new Date(now.getTime() - 31 * day) },
      { itemId: 40012, name: "Old Import", nameSource: "import", icon: "y", detailsSource: "blizzard", blizzardFetchedAt: new Date(now.getTime() - 31 * day) },
    ]);
    const client = { getItem: async (id: number): Promise<ItemLookup> => item(id, "Copied", 105) };
    const result = await refreshItemCache(db, client, now);
    expect(result.legacy).toEqual({ deleted: 1, cleared: 1 });
    const [filled] = await db.select().from(wowItems).where(and(eq(wowItems.gameVersion, "anniversary"), eq(wowItems.itemId, 40010)));
    expect(filled).toMatchObject({ itemLevel: 105, blizzardCheckedAt: now });
    const legacy = await db.select().from(legacyWowItems).where(sql`${legacyWowItems.itemId} between 40011 and 40012`);
    expect(legacy.map((r) => [r.itemId, r.icon, r.blizzardFetchedAt])).toEqual([[40012, null, null]]);
  });
});
