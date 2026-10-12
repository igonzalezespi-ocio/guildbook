import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addonSyncTokens, auditLog, characterAddonLinks, characterProfessions, memberships } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/authz/policy";
import { handleMe, handleProfessions } from "@/server/addon-sync-api";
import {
  authenticateSyncToken,
  createSyncToken,
  ingestProfessions,
  listSyncReports,
  listSyncTokens,
  MAX_TOKENS,
  revokeSyncToken,
} from "@/server/services/addon-sync";
import { createCharacter } from "@/server/services/characters";
import { hashSecret } from "@/server/services/vigil-companion";
import { createGuild, createMember, createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const T = 1_790_000_000; // a moment in October 2026, in the addon's seconds
const NOW = new Date(T * 1000 + 3_600_000);
const GUID = "Player-1234-0ABCDEF0";

const paladin = {
  name: "Tor",
  surname: "Whitecross",
  faction: "alliance",
  wowClass: "paladin",
  spec: "Holy",
  role: "healer",
  level: "60",
  isMain: "on",
  professions: [{ profession: "mining", skill: 120 }],
};

async function setup() {
  const guild = await createGuild(db, { faction: "alliance" });
  const officer = await createMember(db, guild, "Marshal");
  const member = await createMember(db, guild, "Squire");
  const tor = (await createCharacter(db, member, paladin))!;
  const { token } = await createSyncToken(db, officer, { name: "PC de Tor" });
  const auth = await authenticateSyncToken(db, token);
  return { guild, officer, member, tor, token, auth };
}

const record = (over: Partial<{ guid: string; name: string; t: number; professions: { skillLine: number; rank: number; maxRank: number }[] }> = {}) => ({
  guid: GUID,
  name: "Tor Whitecross",
  t: T,
  professions: [
    { skillLine: 186, rank: 280, maxRank: 300 },
    { skillLine: 164, rank: 250, maxRank: 300 },
  ],
  ...over,
});

async function professionsOf(characterId: string) {
  const rows = await db.select().from(characterProfessions).where(eq(characterProfessions.characterId, characterId));
  return Object.fromEntries(rows.map((r) => [r.profession, r.skill]));
}

function request(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  return new Request(`http://lds.localhost:3000${path}`, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("sync keys", () => {
  it("are for officers, stored as hashes and listed for every officer", async () => {
    const guild = await createGuild(db);
    const officer = await createMember(db, guild, "Marshal");
    const other = await createMember(db, guild, "Marshal");
    const member = await createMember(db, guild, "Squire");
    await expect(createSyncToken(db, member, {})).rejects.toThrow("Oficial");

    const { id, token } = await createSyncToken(db, officer, { name: "Sobremesa" });
    expect(token).toMatch(/^gpra_[\w-]{43}$/);
    const [row] = await db.select().from(addonSyncTokens).where(eq(addonSyncTokens.id, id));
    expect(row!.tokenHash).toBe(hashSecret(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const seen = await listSyncTokens(db, other);
    expect(seen).toMatchObject([{ id, name: "Sobremesa", tokenHint: token.slice(-4), own: false }]);
    // Another officer can revoke a lost key, and it stops working at once.
    await revokeSyncToken(db, other, id);
    await expect(authenticateSyncToken(db, token)).rejects.toThrow("no existe o se anuló");
    const audit = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, guild.guild.id));
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["addon_sync.token_create", "addon_sync.token_revoke"]));
  });

  it("stop working when their officer is demoted or leaves, and are limited per guild", async () => {
    const guild = await createGuild(db);
    const officer = await createMember(db, guild, "Marshal");
    const { token } = await createSyncToken(db, officer, {});
    const squire = guild.ranks.find((r) => r.name === "Squire")!;
    await db.update(memberships).set({ rankId: squire.id }).where(eq(memberships.id, officer.membershipId!));
    await expect(authenticateSyncToken(db, token)).rejects.toThrow("ya no es oficial");

    const boss = await createMember(db, guild, "Grand Master");
    for (let i = 1; i < MAX_TOKENS; i++) await createSyncToken(db, boss, { name: `PC ${i}` });
    await expect(createSyncToken(db, boss, {})).rejects.toThrow(`${MAX_TOKENS} claves activas`);
  });
});

describe("ingestProfessions", () => {
  it("sets a matched character's professions to the addon's and reports who is not on the site", async () => {
    const { tor, auth, officer } = await setup();
    const result = await ingestProfessions(
      db,
      auth,
      {
        addonVersion: "0.5.0",
        characters: [
          record({ professions: [...record().professions, { skillLine: 999, rank: 5, maxRank: 5 }] }),
          record({ guid: "Player-1-AB", name: "Nadie Desconocido" }),
        ],
      },
      NOW,
    );
    expect(result).toEqual({ received: 2, updated: 1, unchanged: 0, skippedOld: 0, unmatched: ["Nadie Desconocido"] });
    // Mining goes from 120 to 280, Blacksmithing is new, the unknown skill line is ignored.
    expect(await professionsOf(tor.id)).toEqual({ mining: 280, blacksmithing: 250 });
    const [link] = await db.select().from(characterAddonLinks).where(eq(characterAddonLinks.characterId, tor.id));
    expect(link).toMatchObject({ guid: GUID, addonTime: T });

    const [report] = await listSyncReports(db, officer);
    expect(report).toMatchObject({ tokenName: "PC de Tor", addonVersion: "0.5.0", received: 2, updated: 1, unmatched: ["Nadie Desconocido"] });
    const audit = await db.select().from(auditLog).where(and(eq(auditLog.guildId, auth.guild.id), eq(auditLog.action, "addon_sync.professions")));
    expect(audit).toHaveLength(1);
  });

  it("never lets an older copy overwrite a newer one, and drops professions the character no longer has", async () => {
    const { tor, auth } = await setup();
    await ingestProfessions(db, auth, { characters: [record({ t: T + 100 })] }, NOW);

    const older = await ingestProfessions(db, auth, { characters: [record({ t: T, professions: [] })] }, NOW);
    expect(older).toMatchObject({ updated: 0, skippedOld: 1 });
    expect(await professionsOf(tor.id)).toEqual({ mining: 280, blacksmithing: 250 });

    const same = await ingestProfessions(db, auth, { characters: [record({ t: T + 100 })] }, NOW);
    expect(same).toMatchObject({ updated: 0, unchanged: 1 });

    const dropped = await ingestProfessions(db, auth, { characters: [record({ t: T + 200, professions: [{ skillLine: 186, rank: 300, maxRank: 300 }] })] }, NOW);
    expect(dropped).toMatchObject({ updated: 1 });
    expect(await professionsOf(tor.id)).toEqual({ mining: 300 });
  });

  it("finds characters by GUID after a rename, by full name in any case, or by a unique first name", async () => {
    const { tor, auth } = await setup();
    await ingestProfessions(db, auth, { characters: [record({ name: "tor  WHITECROSS" })] }, NOW);
    expect(await professionsOf(tor.id)).toMatchObject({ mining: 280 });

    // The GUID link holds even if the addon now shows another name.
    await ingestProfessions(db, auth, { characters: [record({ name: "Otro Nombre", t: T + 10, professions: [] })] }, NOW);
    expect(await professionsOf(tor.id)).toEqual({});

    const fresh = await setup();
    await ingestProfessions(db, fresh.auth, { characters: [record({ guid: "Player-9-FF", name: "Tor" })] }, NOW);
    expect(await professionsOf(fresh.tor.id)).toMatchObject({ mining: 280 });
  });

  it("ignores records dated in the future and only touches its own guild", async () => {
    const { tor, auth } = await setup();
    const elsewhere = await setup(); // another guild with its own Tor Whitecross
    const result = await ingestProfessions(db, auth, { characters: [record({ t: T + 86_400 })] }, NOW);
    expect(result).toMatchObject({ updated: 0, skippedOld: 1 });
    await ingestProfessions(db, auth, { characters: [record()] }, NOW);
    expect(await professionsOf(tor.id)).toMatchObject({ mining: 280 });
    expect(await professionsOf(elsewhere.tor.id)).toEqual({ mining: 120 });
  });

  it("rejects malformed uploads", async () => {
    const { auth } = await setup();
    await expect(ingestProfessions(db, auth, { characters: [record({ guid: "no es un guid" })] }, NOW)).rejects.toThrow();
    await expect(ingestProfessions(db, auth, { characters: [record({ t: 5 })] }, NOW)).rejects.toThrow();
  });
});

describe("/api/addon", () => {
  it("answers with the summary, and refuses missing or unknown keys", async () => {
    const { token, tor } = await setup();
    const me = await handleMe(db, request("/api/addon/me", { method: "GET", token }));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ key: { name: "PC de Tor" } });

    const ok = await handleProfessions(db, request("/api/addon/professions", { token, body: { characters: [record({ t: Math.floor(Date.now() / 1000) })] } }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ received: 1, updated: 1 });
    expect(await professionsOf(tor.id)).toMatchObject({ mining: 280 });

    expect((await handleProfessions(db, request("/api/addon/professions", { body: { characters: [] } }))).status).toBe(401);
    expect((await handleProfessions(db, request("/api/addon/professions", { token: "gpra_nope", body: { characters: [] } }))).status).toBe(401);
    expect((await handleProfessions(db, request("/api/addon/professions", { token, body: { characters: "x" } }))).status).toBe(400);
  });

  it("refuses a key whose officer was demoted, with 403", async () => {
    const { token, guild, officer } = await setup();
    const squire = guild.ranks.find((r) => r.name === "Squire")!;
    await db.update(memberships).set({ rankId: squire.id }).where(eq(memberships.id, (officer as Actor).membershipId!));
    expect((await handleProfessions(db, request("/api/addon/professions", { token, body: { characters: [] } }))).status).toBe(403);
  });
});
