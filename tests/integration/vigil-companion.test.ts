import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { guildDomains, memberships, vigilCompanionDevices, vigilCompanionPairings, vigilReports } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Actor } from "@/lib/authz/policy";
import { analyzeText } from "@/lib/vigil/analyze";
import { createCharacter } from "@/server/services/characters";
import { getVigilReport, listOwnVigilReports, setVigilDefaultVisibility } from "@/server/services/vigil";
import {
  authenticateDevice,
  createPairingCode,
  exchangePairingCode,
  hashSecret,
  listCompanionDevices,
  revokeCompanionDevice,
  takeUploadQuota,
  UPLOADS_PER_MINUTE,
} from "@/server/services/vigil-companion";
import { handlePair, handleProfile, handleUpload } from "@/server/vigil-companion-api";
import { PALADIN, paladinLog } from "../support/combatlog";
import { createGuild, createMember, createTestDb, createVisitor } from "../support/db";

let db: Db;
let close: () => Promise<void>;
const [report] = analyzeText(paladinLog(), PALADIN.guid, "paladin-leveling", "Tor");
let ipCounter = 0;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

async function pair(actor: Actor, deviceName = "Desk PC") {
  const { code } = await createPairingCode(db, actor);
  return exchangePairingCode(db, { code, deviceName });
}

function post(path: string, body: unknown, token?: string, ip = `10.0.0.${++ipCounter}`) {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const upload = (token: string, body: Record<string, unknown> = {}) =>
  handleUpload(db, post("/api/vigil/companion/reports", { report, ...body }, token));

describe("companion pairing", () => {
  it("trades a one-time code for a device token and stores only hashes", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const { code, expiresAt } = await createPairingCode(db, member);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(9 * 60_000);

    const [stored] = await db.select().from(vigilCompanionPairings).where(eq(vigilCompanionPairings.membershipId, member.membershipId!));
    expect(stored!.codeHash).toBe(hashSecret(code.replace("-", "")));
    expect(JSON.stringify(stored)).not.toContain(code);

    // Lowercase with spaces still works: people retype codes.
    const result = await exchangePairingCode(db, { code: code.toLowerCase().replace("-", " "), deviceName: "Desk PC" });
    expect(result.token).toMatch(/^osmv_[\w-]{43}$/);
    expect(result).toMatchObject({ device: { name: "Desk PC" }, guild: { slug: guild.guild.slug } });
    const [device] = await db.select().from(vigilCompanionDevices).where(eq(vigilCompanionDevices.id, result.device.id));
    expect(device!.tokenHash).toBe(hashSecret(result.token));
    expect(JSON.stringify(device)).not.toContain(result.token);
    expect(device!.tokenHint).toBe(result.token.slice(-4));

    await expect(exchangePairingCode(db, { code, deviceName: "Again" })).rejects.toThrow("not valid or has expired");
  });

  it("rejects expired and superseded codes, and codes from members who lost access", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const first = await createPairingCode(db, member);
    const second = await createPairingCode(db, member);
    await expect(exchangePairingCode(db, { code: first.code })).rejects.toThrow("not valid");

    await db.update(vigilCompanionPairings).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(vigilCompanionPairings.membershipId, member.membershipId!));
    await expect(exchangePairingCode(db, { code: second.code })).rejects.toThrow("not valid");

    const leaving = await createMember(db, guild, "Squire");
    const { code } = await createPairingCode(db, leaving);
    await db.update(memberships).set({ status: "former" }).where(eq(memberships.id, leaving.membershipId!));
    await expect(exchangePairingCode(db, { code })).rejects.toThrow("not valid");
  });

  it("is for members only", async () => {
    const guild = await createGuild(db);
    const applicant = await createMember(db, guild, "Squire", "applicant");
    const visitor = await createVisitor(db, guild.guild.id);
    await expect(createPairingCode(db, applicant)).rejects.toThrow("Requires member");
    await expect(createPairingCode(db, visitor)).rejects.toThrow("Requires member");
  });

  it("serves the pairing exchange over HTTP with a per-address rate limit", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const { code } = await createPairingCode(db, member);
    const ok = await handlePair(db, post("/api/vigil/companion/pair", { code, deviceName: "Laptop" }));
    expect(ok.status).toBe(201);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = await ok.json();
    expect(body).toMatchObject({ token: expect.stringMatching(/^osmv_/), device: { name: "Laptop" }, siteUrl: `http://${guild.guild.slug}.localhost:3000` });
    expect(body).not.toHaveProperty("guildId");

    const bad = await handlePair(db, post("/api/vigil/companion/pair", { code: "ZZZZ-ZZZZ" }));
    expect(bad.status).toBe(400);
    expect((await handlePair(db, post("/api/vigil/companion/pair", { nope: 1 }))).status).toBe(400);

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await handlePair(db, post("/api/vigil/companion/pair", { code: "ZZZZ-ZZZZ" }, undefined, "192.0.2.9"))).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("companion site address", () => {
  it("names the guild's verified custom domain when the companion pairs through the apex", async () => {
    vi.stubEnv("ROOT_DOMAIN", "guildbook.io");
    try {
      const guild = await createGuild(db);
      const member = await createMember(db, guild, "Squire");
      const apex = (path: string, body: unknown, token?: string) =>
        new Request(`https://guildbook.io${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${++ipCounter}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(body),
        });

      const first = await createPairingCode(db, member);
      const plain = await (await handlePair(db, apex("/api/vigil/companion/pair", { code: first.code }))).json();
      expect(plain.siteUrl).toBe(`https://${guild.guild.slug}.guildbook.io`);

      const domain = `${guild.guild.slug}.example`;
      await db.insert(guildDomains).values({ guildId: guild.guild.id, domain, status: "verified", verificationToken: "t", verifiedAt: new Date() });
      const second = await createPairingCode(db, member);
      const custom = await (await handlePair(db, apex("/api/vigil/companion/pair", { code: second.code }))).json();
      expect(custom.siteUrl).toBe(`https://${domain}`);

      const res = await handleUpload(db, apex("/api/vigil/companion/reports", { report }, custom.token));
      expect((await res.json()).url).toMatch(new RegExp(`^https://${domain.replace(".", "\\.")}/vigil/reports/`));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("device tokens", () => {
  it("authenticate the member, can be listed and revoked, and stop working when revoked", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const other = await createMember(db, guild, "Knight");
    const { token, device } = await pair(member);

    const auth = await authenticateDevice(db, token);
    expect(auth.actor).toMatchObject({ userId: member.userId, membershipId: member.membershipId, guildId: guild.guild.id });
    expect((await listCompanionDevices(db, member)).map((d) => d.id)).toEqual([device.id]);
    expect(await listCompanionDevices(db, other)).toEqual([]);

    await expect(revokeCompanionDevice(db, other, device.id)).rejects.toThrow("No se ha encontrado el dispositivo");
    await revokeCompanionDevice(db, member, device.id);
    expect(await listCompanionDevices(db, member)).toEqual([]);
    await expect(authenticateDevice(db, token)).rejects.toMatchObject({ code: "unauthenticated" });

    const res = await upload(token);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/revoked/);
    await expect(authenticateDevice(db, "nope")).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(authenticateDevice(db, `${token}x`)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("lose upload rights the moment the member leaves", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const { token } = await pair(member);
    await db.update(memberships).set({ status: "former" }).where(eq(memberships.id, member.membershipId!));
    const res = await upload(token);
    expect(res.status).toBe(403);
  });
});

describe("companion upload API", () => {
  it("stores a report with the member's default visibility, private unless they changed it", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const officer = await createMember(db, guild, "Marshal");
    const { token } = await pair(member);

    const res = await upload(token);
    expect(res.status).toBe(201);
    const { id, url } = await res.json();
    expect(url).toBe(`http://${guild.guild.slug}.localhost:3000/vigil/reports/${id}`);
    expect(await getVigilReport(db, member, id)).toMatchObject({ visibility: "private", fightLabel: "Rockhide Boar" });
    await expect(getVigilReport(db, officer, id)).rejects.toThrow("No se ha encontrado el informe");

    await setVigilDefaultVisibility(db, member, "guild");
    const shared = await (await upload(token)).json();
    expect(await getVigilReport(db, officer, shared.id)).toMatchObject({ visibility: "guild" });

    const override = await (await upload(token, { visibility: "private" })).json();
    expect(await getVigilReport(db, member, override.id)).toMatchObject({ visibility: "private" });
    await expect(getVigilReport(db, officer, override.id)).rejects.toThrow("No se ha encontrado el informe");
  });

  it("attaches the member's character by name and reports who the token belongs to", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    await createCharacter(db, member, {
      name: "Tor",
      surname: "Whitecross",
      faction: "alliance",
      wowClass: "paladin",
      spec: "Holy",
      role: "melee",
      level: "8",
      professions: [],
    });
    const { token } = await pair(member);
    const { id } = await (await upload(token)).json();
    expect(await getVigilReport(db, member, id)).toMatchObject({ characterName: "Tor", characterClass: "paladin" });

    const profile = await handleProfile(db, new Request("http://localhost:3000/api/vigil/companion/me", { headers: { authorization: `Bearer ${token}` } }));
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      guild: { slug: guild.guild.slug, gameVersion: "forever" },
      defaultVisibility: "private",
      characters: [{ name: "Tor", wowClass: "paladin", level: 8 }],
    });
  });

  it("keeps each token inside its own guild", async () => {
    const a = await createGuild(db);
    const b = await createGuild(db);
    const member = await createMember(db, a, "Squire");
    const [membershipInB] = await db
      .insert(memberships)
      .values({ guildId: b.guild.id, userId: member.userId, rankId: b.ranks.find((r) => r.name === "Squire")!.id, status: "active" })
      .returning();
    const memberInB: Actor = { ...member, guildId: b.guild.id, membershipId: membershipInB!.id };
    const officerB = await createMember(db, b, "Marshal");
    const { token } = await pair(member);

    const wrongGuild = await upload(token, { guild: b.guild.slug, visibility: "guild" });
    expect(wrongGuild.status).toBe(403);
    expect((await wrongGuild.json()).error).toMatch(/different guild/);

    const ok = await upload(token, { guild: a.guild.slug, visibility: "guild" });
    const { id } = await ok.json();
    const [row] = await db.select().from(vigilReports).where(eq(vigilReports.id, id));
    expect(row!.guildId).toBe(a.guild.id);
    expect(await listOwnVigilReports(db, memberInB)).toEqual([]);
    await expect(getVigilReport(db, officerB, id)).rejects.toThrow("No se ha encontrado el informe");
    await expect(getVigilReport(db, memberInB, id)).rejects.toThrow("No se ha encontrado el informe");
  });

  it("validates reports with the upload schema and rate-limits each device", async () => {
    const guild = await createGuild(db);
    const member = await createMember(db, guild, "Squire");
    const { token, device } = await pair(member);

    const malformed = await upload(token, { report: { ...report, version: 99 } });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toMatch(/format/);
    expect((await upload(token, { visibility: "everyone" })).status).toBe(400);
    const huge = await upload(token, { report: { ...report, notes: ["x".repeat(1_000_000)] } });
    expect(huge.status).toBe(413);

    for (let i = 0; i < UPLOADS_PER_MINUTE; i++) await takeUploadQuota(db, device.id);
    const limited = await upload(token);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    await db
      .update(vigilCompanionDevices)
      .set({ rateWindowStart: new Date(Date.now() - 61_000) })
      .where(and(eq(vigilCompanionDevices.id, device.id)));
    expect((await upload(token)).status).toBe(201);
  });
});

describe("companion uploads from another game", () => {
  const tbc = { ...report!, gameVersion: "anniversary" as const, log: { ...report!.log, build: "2.5.6", projectId: 5, flavor: "_anniversary_" } };

  it("keeps a mismatched log with a warning before WoW: Forever launches, and refuses it with a 409 after", async () => {
    const guild = await createGuild(db, { name: "Order Test" });
    const member = await createMember(db, guild, "Squire");
    const { token } = await pair(member);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
      const kept = await upload(token, { report: tbc });
      expect(kept.status).toBe(201);
      const body = await kept.json();
      expect(body).toMatchObject({ gameVersion: "anniversary", versionMismatch: true });
      expect(body.warning).toMatch(/This log is from TBC Anniversary; Order Test is a WoW: Forever guild/);

      vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
      const refused = await upload(token, { report: tbc });
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        code: "version_mismatch",
        error: "This log is from TBC Anniversary; Order Test is a WoW: Forever guild. Pair Vigil with your TBC Anniversary guild.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts Anniversary logs in an Anniversary guild and tells the companion the guild's version", async () => {
    const guild = await createGuild(db, { gameVersion: "anniversary", realmSlug: "dreamscythe", faction: "horde" });
    const member = await createMember(db, guild, "Member");
    const { token } = await pair(member);
    const res = await upload(token, { report: tbc });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ gameVersion: "anniversary", versionMismatch: false, warning: null });
    const profile = await handleProfile(db, new Request("http://localhost:3000/api/vigil/companion/me", { headers: { authorization: `Bearer ${token}` } }));
    expect(await profile.json()).toMatchObject({ guild: { gameVersion: "anniversary" } });
  });
});
