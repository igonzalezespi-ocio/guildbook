import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, auditLog, battlenetLinks, characters } from "@/db/schema";
import type { Db } from "@/db/types";
import { AuthorizationError } from "@/lib/authz/policy";
import { BlizzardClient } from "@/server/blizzard/client";
import { blizzardConfigFromEnv } from "@/server/blizzard/config";
import { decryptToken } from "@/server/blizzard/crypto";
import { createMockFetch } from "@/server/blizzard/mock";
import { DomainError } from "@/server/errors";
import { reviewApplication, submitApplication } from "@/server/services/applications";
import {
  type BattlenetDeps,
  getEligibleCharacters,
  importBattlenetCharacter,
  linkBattlenetAccount,
  refreshBattlenetSnapshot,
  syncGuildCharacters,
  unlinkBattlenet,
} from "@/server/services/battlenet";
import { createCharacter, updateCharacter } from "@/server/services/characters";
import { createGuild, createMember, createTestDb, createVisitor, reloadActor, validApplication } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const anyRealm = { realmSlugs: [] as string[] };
const tokenKey = Buffer.alloc(32, 9);

function makeDeps(): BattlenetDeps {
  const config = { ...blizzardConfigFromEnv({}), mock: true };
  return { client: new BlizzardClient(config, createMockFetch()), tokenKey };
}
const deps = makeDeps();

type Actor = Awaited<ReturnType<typeof createVisitor>>;

/** Links the actor's own mock Battle.net account (derived from the code) and returns its Alliance characters. */
async function link(actor: Actor, seed: string = actor.userId) {
  await linkBattlenetAccount(db, actor, { code: `mock-${seed}`, redirectUri: "http://localhost:3000/api/battlenet/callback" }, deps);
  const { characters: eligible } = await getEligibleCharacters(db, actor, anyRealm);
  const byName = (name: string) => {
    const c = eligible.find((x) => x.name === name);
    if (!c) throw new Error(`No eligible ${name}`);
    return c;
  };
  return { eligible, byName };
}

async function auditActions(guildId: string) {
  return (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, guildId))).map((r) => r.action);
}

describe("linking", () => {
  it("stores the account, a snapshot and an encrypted token, and audits it", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, guild.guild.id);
    await link(visitor);

    const [row] = await db.select().from(battlenetLinks).where(eq(battlenetLinks.userId, visitor.userId));
    expect(row).toMatchObject({ region: "us", snapshotStatus: "ok" });
    expect(row!.battletag).toMatch(/^Pilgrim#\d{4}$/);
    expect(row!.characters.map((c) => [c.name, c.region, c.gameVersion ?? "forever"])).toEqual([
      ["Aldric", "us", "forever"],
      ["Brenna", "us", "forever"],
      ["Corwin", "us", "forever"],
      ["Grukk", "us", "forever"],
      ["Elowen", "us", "anniversary"],
      ["Isolde", "eu", "forever"],
    ]);
    // The Anniversary character is kept, tagged with its version, for Anniversary guilds only.
    expect(row!.scan).toMatchObject({ foreverNamespace: "profile-classic1x-us", excluded: [] });
    expect(row!.scan!.foreverNamespaces).toEqual(["profile-classic1x-us", "profile-classic1x-eu"]);
    expect(row!.scan!.namespaces.map((n) => [n.namespace, n.region, n.httpStatus, n.characters])).toEqual([
      ["profile-classic1x-us", "us", 200, 5],
      ["profile-classicann-us", "us", 200, 1],
      ["profile-classic-us", "us", 404, 0],
      ["profile-us", "us", 404, 0],
      ["profile-classic1x-eu", "eu", 200, 1],
      ["profile-classicann-eu", "eu", 404, 0],
      ["profile-classic-eu", "eu", 404, 0],
      ["profile-eu", "eu", 404, 0],
    ]);
    expect(row!.accessTokenEnc).not.toContain("mock-user");
    expect(decryptToken(row!.accessTokenEnc!, tokenKey)).toBe(`mock-user.${visitor.userId}`);
    expect(row!.tokenExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(await auditActions(guild.guild.id)).toContain("battlenet.link");
  });

  it("filters the snapshot to the guild's faction and configured realms", async () => {
    const alliance = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, alliance.guild.id);
    const { eligible } = await link(visitor);
    expect(eligible.map((c) => c.name)).toEqual(["Aldric", "Brenna", "Corwin"]);

    const realmOnly = await getEligibleCharacters(db, visitor, { realmSlugs: ["silverpine"] });
    expect(realmOnly.characters.map((c) => c.name)).toEqual(["Corwin"]);

    const horde = await createGuild(db, { faction: "horde" });
    const hordeView = await getEligibleCharacters(db, { ...visitor, guildId: horde.guild.id }, anyRealm);
    expect(hordeView.characters.map((c) => c.name)).toEqual(["Grukk"]);
  });

  it("offers each guild only the characters in its region", async () => {
    const us = await createGuild(db, { faction: "alliance", region: "us" });
    const eu = await createGuild(db, { faction: "alliance", region: "eu" });
    const visitor = await createVisitor(db, us.guild.id);
    await link(visitor);
    const euView = await getEligibleCharacters(db, { ...visitor, guildId: eu.guild.id }, anyRealm);
    expect(euView.characters.map((c) => [c.name, c.region])).toEqual([["Isolde", "eu"]]);
    // Region-prefixed realm allowlist entries only apply in their region.
    const euRealms = await getEligibleCharacters(db, { ...visitor, guildId: eu.guild.id }, { realmSlugs: ["eu:elsewhere", "us:hollowmere"] });
    expect(euRealms.characters).toEqual([]);
    const euListed = await getEligibleCharacters(db, { ...visitor, guildId: eu.guild.id }, { realmSlugs: ["eu:hollowmere", "us:silverpine"] });
    expect(euListed.characters.map((c) => c.name)).toEqual(["Isolde"]);

    // Snapshots from before regions have no region on their characters: they were US.
    const [row] = await db.select().from(battlenetLinks).where(eq(battlenetLinks.userId, visitor.userId));
    const legacy = row!.characters.filter((c) => c.region === "us").map(({ region: _region, ...c }) => c);
    await db.update(battlenetLinks).set({ characters: legacy }).where(eq(battlenetLinks.userId, visitor.userId));
    expect((await getEligibleCharacters(db, visitor, anyRealm)).characters.map((c) => c.name)).toEqual(["Aldric", "Brenna", "Corwin"]);
    expect((await getEligibleCharacters(db, { ...visitor, guildId: eu.guild.id }, anyRealm)).characters).toEqual([]);
  });

  it("keeps one region's characters when the other region refuses the account", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, guild.guild.id);
    await link(visitor, `${visitor.userId}-eu-forbidden`);
    const [row] = await db.select().from(battlenetLinks).where(eq(battlenetLinks.userId, visitor.userId));
    expect(row!.snapshotStatus).toBe("ok");
    expect(row!.characters.map((c) => c.region)).toEqual(["us", "us", "us", "us", "us"]);
    expect(row!.scan!.namespaces.filter((n) => n.region === "eu").map((n) => n.status)).toEqual(["forbidden", "forbidden", "forbidden", "forbidden"]);
  });

  it("refuses a Battle.net account already linked to another Discord user", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const first = await createVisitor(db, guild.guild.id);
    const second = await createVisitor(db, guild.guild.id);
    await link(first);
    await expect(link(second, first.userId)).rejects.toThrow(/ya está vinculada a otra cuenta de Discord/);
  });

  it("refreshes while the token is valid and asks to reconnect once it expires", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, guild.guild.id);
    await link(visitor);
    await expect(refreshBattlenetSnapshot(db, visitor, deps)).resolves.toMatchObject({ status: "ok" });

    await db.update(battlenetLinks).set({ tokenExpiresAt: new Date(Date.now() - 1000) }).where(eq(battlenetLinks.userId, visitor.userId));
    await expect(refreshBattlenetSnapshot(db, visitor, deps)).rejects.toThrow(/Vuelve a conectar Battle.net/);
  });

  it("unlinks with an audit entry; signed-out visitors can't link", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, guild.guild.id);
    await link(visitor);
    await unlinkBattlenet(db, visitor);
    expect(await db.select().from(battlenetLinks).where(eq(battlenetLinks.userId, visitor.userId))).toHaveLength(0);
    expect(await auditActions(guild.guild.id)).toContain("battlenet.unlink");
    await expect(unlinkBattlenet(db, visitor)).rejects.toBeInstanceOf(DomainError);

    const anonymous = { guildId: guild.guild.id, userId: null, membershipId: null, tier: "public" as const };
    await expect(
      linkBattlenetAccount(db, anonymous, { code: "mock-x", redirectUri: "http://localhost/cb" }, deps),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("verified applications", () => {
  it("takes name, class, level and realm from the snapshot, ignoring spoofed form values", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, guild.guild.id);
    const { byName } = await link(visitor);
    const aldric = byName("Aldric");

    const app = await submitApplication(
      db,
      visitor,
      {
        ...validApplication,
        bnetCharacterId: aldric.id,
        characterName: "Impostor",
        wowClass: "warrior",
        level: "12",
        characterSurname: "Lightward",
        spec: "Protection",
        role: "tank",
      },
      anyRealm,
    );
    expect(app).toMatchObject({
      characterName: "Aldric",
      characterSurname: "Lightward",
      wowClass: "paladin",
      level: 60,
      verified: true,
      bnetCharacterId: aldric.id,
      realmSlug: "crusaders-reach",
      realmName: "Crusader's Reach",
    });
    expect(app.battletag).toMatch(/^Pilgrim#/);
    expect(app.bnetSnapshotAt).toBeInstanceOf(Date);
  });

  it("rejects a spoofed verified character: another account's, the wrong faction, unknown, or with no link", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const other = await createVisitor(db, guild.guild.id);
    const theirs = (await link(other)).byName("Aldric");
    const visitor = await createVisitor(db, guild.guild.id);

    // No link at all.
    await expect(submitApplication(db, visitor, { ...validApplication, bnetCharacterId: theirs.id }, anyRealm)).rejects.toThrow(
      /no está en tu cuenta de Battle.net vinculada/,
    );

    await link(visitor);
    const [mine] = await db.select().from(battlenetLinks).where(eq(battlenetLinks.userId, visitor.userId));
    const grukk = mine!.characters.find((c) => c.name === "Grukk")!;
    for (const bnetCharacterId of [theirs.id, grukk.id, "123456789"]) {
      await expect(submitApplication(db, visitor, { ...validApplication, bnetCharacterId }, anyRealm)).rejects.toBeInstanceOf(
        DomainError,
      );
    }
    // A spec from another class is still refused for the verified class.
    const aldric = mine!.characters.find((c) => c.name === "Aldric")!;
    await expect(
      submitApplication(db, visitor, { ...validApplication, bnetCharacterId: aldric.id, spec: "Arms" }, anyRealm),
    ).rejects.toThrow();
    expect(await db.select().from(applications).where(eq(applications.userId, visitor.userId))).toHaveLength(0);
  });

  it("keeps manual entry as the fallback, marked unverified", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication, anyRealm);
    expect(app).toMatchObject({ verified: false, bnetCharacterId: null, battletag: null, characterName: "Joanofarc" });

    // Linked, but choosing manual entry is still allowed and still unverified.
    const linked = await createVisitor(db, guild.guild.id);
    await link(linked);
    const manual = await submitApplication(db, linked, { ...validApplication, characterName: "Hildegard" }, anyRealm);
    expect(manual.verified).toBe(false);
  });

  it("accepting a verified application creates a verified character", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const marshal = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);
    const brenna = (await link(visitor)).byName("Brenna");
    const app = await submitApplication(
      db,
      visitor,
      { ...validApplication, bnetCharacterId: brenna.id, characterSurname: "Stonehearth", spec: "Holy", role: "healer" },
      anyRealm,
    );
    await reviewApplication(db, marshal, { applicationId: app.id, decision: "accepted" });

    const member = await reloadActor(db, visitor);
    const [char] = await db.select().from(characters).where(eq(characters.membershipId, member.membershipId!));
    expect(char).toMatchObject({
      name: "Brenna",
      surname: "Stonehearth",
      wowClass: "priest",
      level: 42,
      verified: true,
      bnetCharacterId: brenna.id,
      realmSlug: "crusaders-reach",
      isMain: true,
    });
    expect(char!.syncedAt).toBeInstanceOf(Date);
  });

  it("accepting a manual application creates an unverified character", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const marshal = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication, anyRealm);
    await reviewApplication(db, marshal, { applicationId: app.id, decision: "trial" });
    const member = await reloadActor(db, visitor);
    const [char] = await db.select().from(characters).where(eq(characters.membershipId, member.membershipId!));
    expect(char).toMatchObject({ verified: false, bnetCharacterId: null });
  });
});

describe("member import", () => {
  it("offers a TBC Anniversary guild only its realm's Anniversary characters, and confirms in-game members on import", async () => {
    const guild = await createGuild(db, { name: "Mirkwood", faction: "horde", gameVersion: "anniversary", realmSlug: "dreamscythe" });
    const member = await createMember(db, guild, "Miembro");
    const { eligible, byName } = await link(member, `${member.userId}.ann-member`);
    expect(eligible.map((c) => [c.name, c.gameVersion])).toEqual([["Mattaeis", "anniversary"]]);

    const imported = await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: byName("Mattaeis").id, spec: "Beast Mastery", role: "ranged" },
      anyRealm,
      deps.client,
    );
    expect(imported.character).toMatchObject({ name: "Mattaeis", verified: true, realmSlug: "dreamscythe", region: "us" });
    expect(imported.character.inGuildConfirmedAt).toBeInstanceOf(Date);

    // A guild of the same name on another realm doesn't confirm anyone.
    const elsewhere = await createGuild(db, { name: "Mirkwood", faction: "horde", gameVersion: "anniversary", realmSlug: "nightslayer", ruleset: "pvp" });
    const other = await createMember(db, elsewhere, "Miembro");
    const { eligible: offered } = await link(other, `${other.userId}.ann-member`);
    expect(offered).toEqual([]);
  });

  it("imports new verified characters, upgrades a matching manual one, and leaves other manual characters unverified", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const member = await createMember(db, guild, "Squire");
    const manual = { faction: "", wowClass: "druid", spec: "Feral", role: "tank", level: "20", professions: [] };
    const corwinManual = await createCharacter(db, member, { ...manual, name: "Corwin", surname: "Oakheart" });
    await createCharacter(db, member, { ...manual, name: "Wystan", surname: "Moor" });
    const { byName } = await link(member);

    const imported = await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: byName("Brenna").id, surname: "Stonehearth", spec: "Discipline", role: "healer" },
      anyRealm,
    );
    expect(imported.created).toBe(true);
    expect(imported.character).toMatchObject({ name: "Brenna", level: 42, wowClass: "priest", verified: true, isMain: false, region: "us" });

    const upgraded = await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: byName("Corwin").id, surname: "Oakheart", spec: "Balance", role: "ranged" },
      anyRealm,
    );
    expect(upgraded.created).toBe(false);
    expect(upgraded.character).toMatchObject({ id: corwinManual!.id, level: 27, verified: true, realmSlug: "silverpine" });

    const mine = await db.select().from(characters).where(eq(characters.membershipId, member.membershipId!));
    expect(mine).toHaveLength(3);
    expect(mine.find((c) => c.name === "Wystan")).toMatchObject({ verified: false, bnetCharacterId: null, region: null });

    // Importing again updates in place rather than duplicating.
    await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: byName("Brenna").id, surname: "Stonehearth", spec: "Holy", role: "healer" },
      anyRealm,
    );
    expect(await db.select().from(characters).where(eq(characters.membershipId, member.membershipId!))).toHaveLength(3);
    expect(await auditActions(guild.guild.id)).toContain("character.import");
  });

  it("refuses characters from someone else's account and locks verified fields on edit", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const member = await createMember(db, guild, "Squire");
    const stranger = await createVisitor(db, guild.guild.id);
    const strangersAldric = (await link(stranger)).byName("Aldric");
    const { byName } = await link(member);
    await expect(
      importBattlenetCharacter(db, member, { bnetCharacterId: strangersAldric.id, surname: "Ash", spec: "Holy", role: "healer" }, anyRealm),
    ).rejects.toThrow(/no está en tu cuenta de Battle.net vinculada/);

    const { character } = await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: byName("Aldric").id, surname: "Lightward", spec: "Holy", role: "healer" },
      anyRealm,
    );
    await updateCharacter(db, member, character.id, {
      name: "Renamed",
      surname: "Brightwater",
      faction: "",
      wowClass: "paladin",
      spec: "Retribution",
      role: "melee",
      level: "7",
      professions: [],
    });
    const [after] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(after).toMatchObject({ name: "Aldric", level: 60, surname: "Brightwater", spec: "Retribution", verified: true });
  });

  it("hands a character to the account's new owner once the first member unlinks", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const first = await createMember(db, guild, "Squire");
    const second = await createMember(db, guild, "Squire");
    const { byName } = await link(first);
    const aldric = byName("Aldric");
    const { character: original } = await importBattlenetCharacter(
      db,
      first,
      { bnetCharacterId: aldric.id, surname: "Lightward", spec: "Holy", role: "healer" },
      anyRealm,
    );
    // The account moves to another Discord user after the first unlinks; the first keeps an unverified character.
    await unlinkBattlenet(db, first);
    await link(second, first.userId);
    const { character: claimed } = await importBattlenetCharacter(
      db,
      second,
      { bnetCharacterId: aldric.id, surname: "Other", spec: "Holy", role: "healer" },
      anyRealm,
    );
    expect(claimed).toMatchObject({ membershipId: second.membershipId, verified: true, bnetCharacterId: aldric.id });
    const [kept] = await db.select().from(characters).where(eq(characters.id, original.id));
    expect(kept).toMatchObject({ membershipId: first.membershipId, verified: false, bnetCharacterId: null });
  });
});

describe("level sync", () => {
  it("updates levels of verified characters, records lastSyncedAt and audits, without touching other guilds", async () => {
    const guildB = await createGuild(db, { faction: "alliance" });
    const memberB = await createMember(db, guildB, "Squire");
    const brennaB = (await link(memberB)).byName("Brenna");
    await importBattlenetCharacter(db, memberB, { bnetCharacterId: brennaB.id, surname: "Otherfield", spec: "Holy", role: "healer" }, anyRealm);

    const guildA = await createGuild(db, { faction: "alliance" });
    const officerA = await createMember(db, guildA, "Marshal");
    const memberA = await createMember(db, guildA, "Squire");
    const brennaA = (await link(memberA)).byName("Brenna");
    const { character } = await importBattlenetCharacter(
      db,
      memberA,
      { bnetCharacterId: brennaA.id, surname: "Stonehearth", spec: "Holy", role: "healer" },
      anyRealm,
    );
    await createCharacter(db, memberA, {
      name: "Manualone",
      surname: "Unsynced",
      faction: "",
      wowClass: "mage",
      spec: "Frost",
      role: "ranged",
      level: "30",
      professions: [],
    });
    expect(character.level).toBe(42);
    const before = new Date();

    const summary = await syncGuildCharacters(db, officerA, deps.client);
    expect(summary).toMatchObject({ checked: 1, updated: 1, missing: 0 });
    expect(summary.changes[0]).toMatchObject({ characterName: "Brenna Stonehearth", level: [42, 44] });

    const [synced] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(synced!.level).toBe(44);
    expect(synced!.syncedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    const [other] = await db
      .select()
      .from(characters)
      .where(and(eq(characters.guildId, guildB.guild.id), eq(characters.bnetCharacterId, brennaB.id)));
    expect(other!.level).toBe(42);

    const [entry] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.guildId, guildA.guild.id), eq(auditLog.action, "battlenet.sync")));
    expect(entry).toMatchObject({ actorUserId: officerA.userId, targetType: "guild" });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.guildId, guildB.guild.id), eq(auditLog.action, "battlenet.sync")))).toHaveLength(0);
  });

  it("counts a character whose Blizzard ID no longer matches as missing and leaves it alone", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const officer = await createMember(db, guild, "Marshal");
    const member = await createMember(db, guild, "Squire");
    const aldric = (await link(member)).byName("Aldric");
    const { character } = await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: aldric.id, surname: "Lightward", spec: "Holy", role: "healer" },
      anyRealm,
    );
    await db.update(characters).set({ bnetCharacterId: "999", level: 50 }).where(eq(characters.id, character.id));
    const summary = await syncGuildCharacters(db, officer, deps.client);
    expect(summary).toMatchObject({ checked: 1, updated: 0, missing: 1 });
    const [row] = await db.select().from(characters).where(eq(characters.id, character.id));
    expect(row!.level).toBe(50);
  });

  it("is officer-only", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const raider = await createMember(db, guild, "Knight");
    await expect(syncGuildCharacters(db, raider, deps.client)).rejects.toBeInstanceOf(AuthorizationError);
  });
});
