import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import * as schema from "@/db/schema";
import type { Db } from "@/db/types";
import { AuthorizationError } from "@/lib/authz/policy";
import type { Region } from "@/lib/game";
import { DEFAULT_TABARD, ORDER_TABARD } from "@/lib/tabard/config";
import { BlizzardClient } from "@/server/blizzard/client";
import { blizzardConfigFromEnv } from "@/server/blizzard/config";
import { DomainError } from "@/server/errors";
import { createGuildWithDefaults } from "@/server/services/guilds";
import { importInGameTabard, updateGuildTabard } from "@/server/services/tabard";
import { createGuild, createMember, createTestDb, reloadActor } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

let n = 0;
const standardGuild = (region: Region = "us") =>
  createGuildWithDefaults(db, { slug: `banner-${++n}`, name: `Banner ${n}`, region, faction: "alliance", ruleset: "normal", preset: "standard" });
const readGuild = async (id: string) => (await db.select().from(schema.guilds).where(eq(schema.guilds.id, id)))[0]!;

const form = {
  background: "25",
  border: "14",
  borderStyle: "studded",
  emblemId: "193",
  emblemColor: "15",
  themeBase: "parchment",
  overridePrimary: "",
  overrideTrim: "#7A1020",
  overrideHighlight: "",
};

describe("guild tabard defaults", () => {
  it("gives new guilds the default tabard on the dark tome base", async () => {
    const { guild } = await standardGuild();
    expect(guild).toMatchObject({
      tabardBackground: DEFAULT_TABARD.background,
      tabardBorder: DEFAULT_TABARD.border,
      tabardEmblemId: 128,
      tabardBorderId: null,
      themeBase: "tome",
      themeOverrides: {},
    });
  });

  it("gives the Order preset its locked crest and theme", async () => {
    const { guild } = await createGuild(db);
    expect(guild).toMatchObject({
      themeBase: "order",
      tabardBackground: ORDER_TABARD.background,
      tabardEmblem: "cross-pattee",
      tabardEmblemColor: 14,
      tabardEmblemId: null,
      tabardBorderId: null,
    });
  });
});

describe("saving the tabard", () => {
  it("lets an admin save the tabard, base style and overrides, and audits it", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await updateGuildTabard(db, admin, form);
    const saved = await readGuild(g.guild.id);
    expect(saved).toMatchObject({
      tabardBackground: 25,
      tabardBorder: 14,
      tabardBorderStyle: "studded",
      tabardEmblemId: 193,
      tabardEmblemColor: 15,
      themeBase: "parchment",
      themeOverrides: { trim: "#7a1020" },
    });
    const [entry] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "guild.tabard"));
    expect(entry).toMatchObject({ guildId: g.guild.id, actorUserId: admin.userId });
    expect(entry!.after).toMatchObject({ emblemId: 193, themeBase: "parchment" });
  });

  it("requires a Blizzard emblem, and leaves the imported border id alone", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await db.execute(sql`update guilds set tabard_border_id = 5 where id = ${g.guild.id}`);
    await updateGuildTabard(db, admin, { ...form, emblemId: "21", borderId: "2" });
    expect(await readGuild(g.guild.id)).toMatchObject({ tabardEmblemId: 21, tabardBorderId: 5 });
    for (const emblemId of ["", "999", undefined]) {
      await expect(updateGuildTabard(db, admin, { ...form, emblemId })).rejects.toBeInstanceOf(ZodError);
    }
    expect((await readGuild(g.guild.id)).tabardEmblemId).toBe(21);
  });

  it("is refused by the database without an emblem, except on the Order preset", async () => {
    const g = await standardGuild();
    await expect(db.execute(sql`update guilds set tabard_emblem_id = null where id = ${g.guild.id}`)).rejects.toThrow();
    await expect(
      db.insert(schema.guilds).values({ slug: `blank-${++n}`, name: `Blank ${n}`, gameVersion: "forever", region: "us", faction: "alliance", ruleset: "normal", preset: "standard" }),
    ).rejects.toThrow();
    const order = await createGuild(db);
    expect((await readGuild(order.guild.id)).tabardEmblemId).toBeNull();
  });

  it("clears overrides left blank", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await updateGuildTabard(db, admin, form);
    await updateGuildTabard(db, admin, { ...form, overrideTrim: "" });
    expect((await readGuild(g.guild.id)).themeOverrides).toEqual({});
  });

  it("refuses officers, members and visitors", async () => {
    const g = await standardGuild();
    for (const rank of ["Oficial", "Raider", "Miembro"]) {
      const actor = await createMember(db, g, rank);
      await expect(updateGuildTabard(db, actor, form)).rejects.toBeInstanceOf(AuthorizationError);
    }
    await expect(updateGuildTabard(db, { guildId: g.guild.id, userId: null, membershipId: null, tier: "public" }, form)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect((await readGuild(g.guild.id)).tabardEmblemId).toBe(DEFAULT_TABARD.emblemId);
  });

  it("only changes the admin's own guild", async () => {
    const mine = await standardGuild();
    const theirs = await standardGuild();
    const admin = await createMember(db, mine, "Líder");
    await updateGuildTabard(db, admin, form);
    expect((await readGuild(mine.guild.id)).tabardEmblemId).toBe(193);
    expect(await readGuild(theirs.guild.id)).toMatchObject({ tabardEmblemId: DEFAULT_TABARD.emblemId, themeBase: "tome" });
    // An admin of another guild has no tier here: the app resolves the actor per guild from the database.
    const otherAdmin = await createMember(db, theirs, "Líder");
    const here = await reloadActor(db, { ...otherAdmin, guildId: mine.guild.id });
    expect(here.tier).toBe("public");
    await expect(updateGuildTabard(db, here, { ...form, emblemId: "24" })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await readGuild(mine.guild.id)).tabardEmblemId).toBe(193);
  });

  it("rejects unknown emblems, out-of-range colours and malformed overrides", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await expect(updateGuildTabard(db, admin, { ...form, emblemId: "rubber-duck" })).rejects.toBeInstanceOf(ZodError);
    await expect(updateGuildTabard(db, admin, { ...form, background: "51" })).rejects.toBeInstanceOf(ZodError);
    await expect(updateGuildTabard(db, admin, { ...form, borderStyle: "lace" })).rejects.toBeInstanceOf(ZodError);
    await expect(updateGuildTabard(db, admin, { ...form, overridePrimary: "red; } body { display: none" })).rejects.toBeInstanceOf(ZodError);
  });
});

describe("the Order's theme is exclusive", () => {
  it("can't be chosen by another guild through the form", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await expect(updateGuildTabard(db, admin, { ...form, themeBase: "order" })).rejects.toBeInstanceOf(ZodError);
    expect((await readGuild(g.guild.id)).themeBase).toBe("tome");
  });

  it("is refused by the database for any guild without the Order preset", async () => {
    const g = await standardGuild();
    await expect(db.execute(sql`update guilds set theme_base = 'order' where id = ${g.guild.id}`)).rejects.toThrow();
    await expect(
      db.insert(schema.guilds).values({ slug: `copycat-${++n}`, name: "Copycat", gameVersion: "forever", region: "us", faction: "alliance", ruleset: "normal", preset: "standard", themeBase: "order" }),
    ).rejects.toThrow();
  });

  it("stays locked for the Order itself", async () => {
    const order = await createGuild(db);
    const admin = await createMember(db, order, "Grand Master");
    await expect(updateGuildTabard(db, admin, form)).rejects.toBeInstanceOf(DomainError);
    expect(await readGuild(order.guild.id)).toMatchObject({ themeBase: "order", tabardEmblem: "cross-pattee" });
  });

  it("keeps the Order's crest hand-drawn: the database refuses Blizzard ids on it", async () => {
    const order = await createGuild(db);
    await expect(db.execute(sql`update guilds set tabard_emblem_id = 97 where id = ${order.guild.id}`)).rejects.toThrow();
    await expect(db.execute(sql`update guilds set tabard_border_id = 0 where id = ${order.guild.id}`)).rejects.toThrow();
    const g = await standardGuild();
    await expect(db.execute(sql`update guilds set tabard_emblem_id = -1 where id = ${g.guild.id}`)).rejects.toThrow();
  });

  it("still lets other guilds use crimson and gold tabard colours on a generic base", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await updateGuildTabard(db, admin, { ...form, background: "2", border: "3", emblemId: "97", emblemColor: "14", themeBase: "tome", overrideTrim: "" });
    expect(await readGuild(g.guild.id)).toMatchObject({ tabardBackground: 2, tabardBorder: 3, themeBase: "tome" });
  });
});

const PRE_LAUNCH = new Date("2026-10-01T12:00:00Z");
const AFTER_LAUNCH = new Date("2026-12-01T12:00:00Z");
const CREST = {
  emblem: { id: 193, media: { id: 193 }, color: { id: 14, rgba: { r: 177, g: 184, b: 177, a: 1 } } },
  border: { id: 5, media: { id: 5 }, color: { id: 3, rgba: { r: 103, g: 86, b: 0, a: 1 } } },
  background: { color: { id: 40, rgba: { r: 2, g: 2, b: 2, a: 1 } } },
};

/** Battle.net with one character on `realm` in the in-game guild `guildName` (in `region`), whose crest is `crest`. */
function fakeBattlenet(opts: { region?: Region; guildName: string; crest?: unknown; guildStatus?: number }) {
  const hosts: string[] = [];
  const fetch = async (url: string): Promise<Response> => {
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    const u = new URL(url);
    if (u.pathname === "/token") return json({ access_token: "app", expires_in: 86400 });
    hosts.push(u.hostname);
    if (!u.hostname.startsWith(`${opts.region ?? "us"}.`)) return json({}, 404);
    const slug = opts.guildName.toLowerCase().replace(/\s+/g, "-");
    if (u.pathname === "/profile/wow/character/forever-normal/leader") {
      return json({
        id: 1,
        name: "Leader",
        level: 60,
        realm: { slug: "forever-normal" },
        faction: { type: "ALLIANCE" },
        character_class: { id: 2 },
        guild: { name: opts.guildName, realm: { slug: "forever-normal" }, faction: { type: "ALLIANCE" } },
      });
    }
    if (u.pathname === `/data/wow/guild/forever-normal/${slug}`) {
      if (opts.guildStatus) return json({}, opts.guildStatus);
      return json({ name: opts.guildName, ...(opts.crest ? { crest: opts.crest } : {}) });
    }
    return json({}, 404);
  };
  const config = { ...blizzardConfigFromEnv({ BATTLENET_CLIENT_ID: "id", BATTLENET_CLIENT_SECRET: "secret" }), mock: false };
  return { client: new BlizzardClient(config, fetch), hosts };
}

async function linkBattlenet(userId: string, characters: { name: string; region?: Region; guildName?: string }[]) {
  await db.insert(schema.battlenetLinks).values({
    userId,
    battlenetId: `bnet-${++n}`,
    battletag: `Tester#${n}`,
    region: "us",
    characters: characters.map((c, i) => ({
      id: String(100 + i),
      name: c.name,
      surname: null,
      realmSlug: "forever-normal",
      realmName: "Forever",
      level: 60,
      wowClass: "paladin",
      race: "human",
      faction: "alliance",
      guildName: c.guildName ?? null,
      ...(c.region ? { region: c.region } : {}),
    })),
  });
}

describe("importing the in-game tabard", () => {
  it("copies the guild's emblem and colours from Blizzard, stores the border shape, keeps the theme and audits it", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await updateGuildTabard(db, admin, form);
    await linkBattlenet(admin.userId, [{ name: "Leader", guildName: g.guild.name }]);
    const bnet = fakeBattlenet({ guildName: g.guild.name, crest: CREST });

    const { inGameName } = await importInGameTabard(db, admin, bnet.client, AFTER_LAUNCH);
    expect(inGameName).toBe(g.guild.name);
    expect(await readGuild(g.guild.id)).toMatchObject({
      tabardBackground: 40,
      tabardBorder: 3,
      tabardEmblemColor: 14,
      tabardEmblemId: 193,
      tabardBorderId: 5,
      tabardBorderStyle: "studded",
      themeBase: "parchment",
      themeOverrides: { trim: "#7a1020" },
    });
    const entries = await db.select().from(schema.auditLog).where(eq(schema.auditLog.guildId, g.guild.id));
    expect(entries.at(-1)).toMatchObject({ action: "guild.tabard", after: { emblemId: 193, importedFrom: { name: g.guild.name, region: "us" } } });
  });

  it("imports any border shape, since it is never drawn", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await linkBattlenet(admin.userId, [{ name: "Leader", guildName: g.guild.name }]);
    const crest = { ...CREST, border: { ...CREST.border, id: 12 } };
    const { look } = await importInGameTabard(db, admin, fakeBattlenet({ guildName: g.guild.name, crest }).client, AFTER_LAUNCH);
    expect(look.tabard).toMatchObject({ emblemId: 193, borderId: 12, borderStyle: "plain" });
    expect((await readGuild(g.guild.id)).tabardBorderId).toBe(12);
  });

  it("reads Europe guilds from the EU API", async () => {
    const g = await standardGuild("eu");
    const admin = await createMember(db, g, "Líder");
    await linkBattlenet(admin.userId, [{ name: "Leader", region: "eu", guildName: g.guild.name }]);
    const bnet = fakeBattlenet({ region: "eu", guildName: g.guild.name, crest: CREST });
    await importInGameTabard(db, admin, bnet.client, AFTER_LAUNCH);
    expect(new Set(bnet.hosts)).toEqual(new Set(["eu.api.blizzard.com"]));
    expect((await readGuild(g.guild.id)).tabardEmblemId).toBe(193);
  });

  it("explains before launch that there are no Forever characters to read yet", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    await linkBattlenet(admin.userId, []);
    const { client } = fakeBattlenet({ guildName: g.guild.name, crest: CREST });
    await expect(importInGameTabard(db, admin, client, PRE_LAUNCH)).rejects.toThrow(/La importación se abre cuando existan personajes de WoW: Forever/);
    await expect(importInGameTabard(db, admin, client, AFTER_LAUNCH)).rejects.toThrow(/No se han encontrado personajes de WoW: Forever en la región de América/);
  });

  it("explains a missing link, a region mismatch, a guild with no tabard and an outage", async () => {
    const g = await standardGuild();
    const admin = await createMember(db, g, "Líder");
    const { client } = fakeBattlenet({ guildName: g.guild.name, crest: CREST });
    await expect(importInGameTabard(db, admin, client, AFTER_LAUNCH)).rejects.toThrow(/Ningún administrador de esta hermandad ha vinculado Battle.net/);

    await linkBattlenet(admin.userId, [{ name: "Leader", region: "eu", guildName: g.guild.name }]);
    await expect(importInGameTabard(db, admin, client, AFTER_LAUNCH)).rejects.toThrow(/en otra región/);

    const g2 = await standardGuild();
    const admin2 = await createMember(db, g2, "Líder");
    await linkBattlenet(admin2.userId, [{ name: "Leader", guildName: g2.guild.name }]);
    await expect(importInGameTabard(db, admin2, fakeBattlenet({ guildName: g2.guild.name }).client, AFTER_LAUNCH)).rejects.toThrow(/no ha diseñado uno en el juego/);
    await expect(importInGameTabard(db, admin2, fakeBattlenet({ guildName: g2.guild.name, guildStatus: 503 }).client, AFTER_LAUNCH)).rejects.toThrow(/no ha respondido/);
    await expect(
      importInGameTabard(db, admin2, fakeBattlenet({ guildName: g2.guild.name, crest: { ...CREST, emblem: { ...CREST.emblem, id: 400 } } }).client, AFTER_LAUNCH),
    ).rejects.toThrow(/\(número 400\) aún no está en el catálogo de Guildbook/);
    await expect(importInGameTabard(db, admin2, fakeBattlenet({ guildName: "Someone Else", crest: CREST }).client, AFTER_LAUNCH)).rejects.toThrow(
      /Ninguno de los personajes de WoW: Forever de los administradores está en una hermandad del juego llamada/,
    );
    expect((await readGuild(g2.guild.id)).tabardEmblemId).toBe(128);
  });

  it("is for admins only, and never touches the Order", async () => {
    const g = await standardGuild();
    const officer = await createMember(db, g, "Oficial");
    const { client } = fakeBattlenet({ guildName: g.guild.name, crest: CREST });
    await expect(importInGameTabard(db, officer, client, AFTER_LAUNCH)).rejects.toBeInstanceOf(AuthorizationError);

    const order = await createGuild(db, { name: "Order of Saint Michael" });
    const gm = await createMember(db, order, "Grand Master");
    await linkBattlenet(gm.userId, [{ name: "Leader", guildName: "Order of Saint Michael" }]);
    await expect(importInGameTabard(db, gm, fakeBattlenet({ guildName: "Order of Saint Michael", crest: CREST }).client, AFTER_LAUNCH)).rejects.toThrow(/bloqueados/);
    expect(await readGuild(order.guild.id)).toMatchObject({ tabardEmblem: "cross-pattee", tabardEmblemId: null, tabardBorderId: null });
  });
});
