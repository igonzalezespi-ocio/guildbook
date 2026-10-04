import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applications, auditLog, battlenetLinks, type BattlenetCharacterSnapshot, characters, guilds, memberships } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Faction } from "@/lib/game";
import type { GuildVersion } from "@/lib/game-versions";
import { DomainError } from "@/server/errors";
import { submitApplication } from "@/server/services/applications";
import { runGuildCharacterSync } from "@/server/services/battlenet";
import { findConfirmedJoin, joinAsConfirmedMember, updateConfirmedJoinSettings } from "@/server/services/confirmed-members";
import { deleteRank, listMembers } from "@/server/services/ranks";
import { createGuild, createMember, createTestDb, createVisitor, reloadActor, validApplication } from "../support/db";
import { type FakeCharacter, FakeBattlenet } from "../support/fake-battlenet";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const ALL_REALMS = { realmSlugs: [] as string[] };
let seq = 5000;

const VERSIONS: Array<{ version: GuildVersion; realm: string; faction: Faction; realmSlug: string | null; surname?: string }> = [
  { version: "forever", realm: "forever-normal", faction: "alliance", realmSlug: null, surname: "Stormborn" },
  { version: "anniversary", realm: "dreamscythe", faction: "horde", realmSlug: "dreamscythe" },
];

/**
 * A verified guild in `version` whose in-game guild lists a Guild Master and `member` (rank 3), and a visitor who has
 * linked Battle.net with `member` in their snapshot.
 */
async function setup(v: (typeof VERSIONS)[number], opts: { verified?: boolean; rosterStatus?: number } = {}) {
  const name = `Mirkwood ${++seq}`;
  const guild = await createGuild(db, { name, faction: v.faction, gameVersion: v.version, realmSlug: v.realmSlug });
  const gm = await createMember(db, guild, v.version === "forever" ? "Grand Master" : "Líder");
  if (opts.verified !== false) await db.update(guilds).set({ verifiedAt: new Date(), verifiedUserId: gm.userId }).where(eq(guilds.id, guild.guild.id));

  const bnet = new FakeBattlenet();
  bnet.realmTypes.set(v.realm, "NORMAL");
  const inGuild = { name, realm: v.realm, faction: v.faction };
  const leader = bnet.character({ id: ++seq, name: `Leader${seq}`, realm: v.realm, faction: v.faction, version: v.version === "anniversary" ? "anniversary" : undefined, guild: inGuild });
  const member = bnet.character({ id: ++seq, name: `Member${seq}`, realm: v.realm, faction: v.faction, version: v.version === "anniversary" ? "anniversary" : undefined, guild: inGuild });
  bnet.roster(v.realm, name, opts.rosterStatus ?? [[leader.id, 0], [member.id, 3]]);

  const visitor = await createVisitor(db, guild.guild.id);
  await link(visitor.userId, [member]);
  return { guild, gm, bnet, member, visitor };
}

async function link(userId: string, chars: FakeCharacter[]) {
  const snapshot: BattlenetCharacterSnapshot[] = chars.map((c) => ({
    id: String(c.id),
    name: c.name,
    surname: null,
    realmSlug: c.realm,
    realmName: c.realm,
    level: 60,
    wowClass: "paladin",
    race: "human",
    faction: c.faction,
    guildName: c.guild?.name ?? null,
    ...(c.version ? { gameVersion: c.version } : {}),
  }));
  await db.insert(battlenetLinks).values({ userId, battlenetId: `bnet-${++seq}`, battletag: `Tester#${seq}`, region: "us", characters: snapshot });
}

function joinForm(member: FakeCharacter, v: (typeof VERSIONS)[number], extra: Record<string, string> = {}) {
  return { bnetCharacterId: String(member.id), spec: "Holy", role: "healer", respectsFaith: "on", ...(v.surname ? { surname: v.surname } : {}), ...extra };
}

async function actions(guildId: string) {
  return (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, guildId))).map((r) => r.action);
}

describe.each(VERSIONS)("joining as a confirmed in-game member ($version)", (v) => {
  it("joins at the entry rank without review, links the character, audits and notifies admins", async () => {
    const { guild, bnet, member, visitor } = await setup(v);
    const offer = await findConfirmedJoin(db, visitor, bnet.client(), { eligibility: ALL_REALMS });
    expect(offer).toMatchObject({ ok: true, offer: { character: { name: member.name }, rosterRank: 3, rank: { id: guild.guild.acceptRankId } } });

    const joined = await joinAsConfirmedMember(db, visitor, joinForm(member, v), bnet.client(), { eligibility: ALL_REALMS });
    expect(joined.characterName).toContain(member.name);

    const actor = await reloadActor(db, visitor);
    expect(actor.tier).not.toBe("public");
    const [membership] = await db.select().from(memberships).where(eq(memberships.id, actor.membershipId!));
    expect(membership).toMatchObject({ status: "active", rankId: guild.guild.acceptRankId });
    const [character] = await db.select().from(characters).where(eq(characters.membershipId, membership!.id));
    expect(character).toMatchObject({
      name: member.name,
      surname: v.surname ?? "",
      verified: true,
      bnetCharacterId: String(member.id),
      isMain: true,
      spec: "Holy",
      inGuildLostAt: null,
    });
    expect(character!.inGuildConfirmedAt).toBeInstanceOf(Date);
    expect(await actions(guild.guild.id)).toContain("member.join_confirmed");
    const [g] = await db.select({ adminNotice: guilds.adminNotice }).from(guilds).where(eq(guilds.id, guild.guild.id));
    expect(g!.adminNotice).toContain(member.name);
    expect(g!.adminNotice).toContain("without application review");
  });

  it("offers nothing when the admins turned it off, and joining is refused", async () => {
    const { guild, gm, bnet, member, visitor } = await setup(v);
    await updateConfirmedJoinSettings(db, gm, { autoApproveRankId: "" });
    expect(await findConfirmedJoin(db, visitor, bnet.client(), { eligibility: ALL_REALMS })).toEqual({ ok: false, reason: "setting_off" });
    await expect(joinAsConfirmedMember(db, visitor, joinForm(member, v), bnet.client(), { eligibility: ALL_REALMS })).rejects.toThrow(DomainError);
    expect(await actions(guild.guild.id)).toContain("guild.confirmed_join");
    // The normal application still works.
    if (v.version === "forever") {
      const app = await submitApplication(db, visitor, validApplication, ALL_REALMS);
      expect(app.status).toBe("pending");
    }
  });

  it("never auto-approves in an unverified guild", async () => {
    const { bnet, member, visitor } = await setup(v, { verified: false });
    expect(await findConfirmedJoin(db, visitor, bnet.client(), { eligibility: ALL_REALMS })).toEqual({ ok: false, reason: "unverified" });
    await expect(joinAsConfirmedMember(db, visitor, joinForm(member, v), bnet.client(), { eligibility: ALL_REALMS })).rejects.toThrow(DomainError);
    expect((await reloadActor(db, visitor)).tier).toBe("public");
  });

  it("falls back to the application when Blizzard doesn't serve the roster", async () => {
    const { bnet, member, visitor } = await setup(v, { rosterStatus: 403 });
    expect(await findConfirmedJoin(db, visitor, bnet.client(), { eligibility: ALL_REALMS })).toEqual({ ok: false, reason: "roster_unavailable" });
    await expect(joinAsConfirmedMember(db, visitor, joinForm(member, v), bnet.client(), { eligibility: ALL_REALMS })).rejects.toThrow(DomainError);
  });

  it("falls back when Battle.net is down", async () => {
    const { bnet, visitor } = await setup(v);
    bnet.down = true;
    expect(await findConfirmedJoin(db, visitor, bnet.client(), { eligibility: ALL_REALMS })).toEqual({ ok: false, reason: "blizzard_error" });
  });

  it("requires the charter to be accepted", async () => {
    const { bnet, member, visitor } = await setup(v);
    await expect(
      joinAsConfirmedMember(db, visitor, joinForm(member, v, { respectsFaith: "" }), bnet.client(), { eligibility: ALL_REALMS }),
    ).rejects.toThrow(/reglamento/);
    expect((await reloadActor(db, visitor)).tier).toBe("public");
  });
});

describe("confirmed-join details", () => {
  const forever = VERSIONS[0]!;
  const anniversary = VERSIONS[1]!;

  it("doesn't offer a character the roster doesn't list", async () => {
    const { bnet, member, visitor } = await setup(anniversary);
    bnet.roster(anniversary.realm, member.guild!.name, [[member.id - 1, 0]]);
    expect(await findConfirmedJoin(db, visitor, bnet.client(), { eligibility: ALL_REALMS })).toEqual({ ok: false, reason: "not_confirmed" });
  });

  it("joins at the configured rank, and that rank can't be deleted while configured", async () => {
    const { guild, gm, bnet, member, visitor } = await setup(anniversary);
    const raider = guild.ranks.find((r) => r.tier === "raider")!;
    await updateConfirmedJoinSettings(db, gm, { autoApproveInGuild: "on", autoApproveRankId: raider.id });
    await joinAsConfirmedMember(db, visitor, joinForm(member, anniversary), bnet.client(), { eligibility: ALL_REALMS });
    const actor = await reloadActor(db, visitor);
    expect(actor.tier).toBe("raider");
    await db.update(memberships).set({ rankId: guild.guild.acceptRankId! }).where(eq(memberships.id, actor.membershipId!));
    await expect(deleteRank(db, gm, raider.id)).rejects.toThrow(/Cambia primero ese ajuste/);
  });

  it("refuses applicant and admin ranks for confirmed joins", async () => {
    const { guild, gm } = await setup(anniversary);
    for (const tier of ["applicant", "admin"] as const) {
      const rank = guild.ranks.find((r) => r.tier === tier)!;
      await expect(updateConfirmedJoinSettings(db, gm, { autoApproveInGuild: "on", autoApproveRankId: rank.id })).rejects.toThrow(DomainError);
    }
    const other = (await createGuild(db)).ranks.find((r) => r.tier === "member")!;
    await expect(updateConfirmedJoinSettings(db, gm, { autoApproveInGuild: "on", autoApproveRankId: other.id })).rejects.toThrow();
  });

  it("closes a pending application as accepted", async () => {
    const { guild, bnet, member, visitor } = await setup(forever);
    const app = await submitApplication(db, visitor, validApplication, ALL_REALMS);
    await joinAsConfirmedMember(db, visitor, joinForm(member, forever), bnet.client(), { eligibility: ALL_REALMS });
    const [row] = await db.select().from(applications).where(eq(applications.id, app.id));
    expect(row!.status).toBe("accepted");
    const [m] = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.guildId, guild.guild.id), eq(memberships.userId, visitor.userId)));
    expect(m).toMatchObject({ status: "active", rankId: guild.guild.acceptRankId });
  });

  it("asks for the surname Battle.net doesn't provide on Forever", async () => {
    const { bnet, member, visitor } = await setup(forever);
    const form = joinForm(member, forever);
    delete (form as { surname?: string }).surname;
    await expect(joinAsConfirmedMember(db, visitor, form, bnet.client(), { eligibility: ALL_REALMS })).rejects.toThrow(/apellido/);
  });

  it("refuses a character that isn't the confirmed one", async () => {
    const { bnet, member, visitor } = await setup(anniversary);
    await expect(
      joinAsConfirmedMember(db, visitor, joinForm(member, anniversary, { bnetCharacterId: "999999" }), bnet.client(), { eligibility: ALL_REALMS }),
    ).rejects.toThrow(DomainError);
  });
});

describe("daily recheck of confirmed members", () => {
  it("flags a member whose character left the in-game guild, keeps the membership, and clears the flag on return", async () => {
    const v = VERSIONS[1]!;
    const { guild, gm, bnet, member, visitor } = await setup(v);
    await joinAsConfirmedMember(db, visitor, joinForm(member, v), bnet.client(), { eligibility: ALL_REALMS });
    await db.update(guilds).set({ adminNotice: null }).where(eq(guilds.id, guild.guild.id));

    const inGuild = member.guild;
    member.guild = undefined;
    const summary = await runGuildCharacterSync(db, guild.guild.id, null, bnet.client());
    expect(summary.leftGuild).toBe(1);
    const [left] = await db.select().from(characters).where(eq(characters.bnetCharacterId, String(member.id)));
    expect(left!.inGuildConfirmedAt).toBeNull();
    expect(left!.inGuildLostAt).toBeInstanceOf(Date);
    expect((await reloadActor(db, visitor)).membershipId).not.toBeNull();
    const [g] = await db.select({ adminNotice: guilds.adminNotice }).from(guilds).where(eq(guilds.id, guild.guild.id));
    expect(g!.adminNotice).toContain(member.name);
    expect((await listMembers(db, gm)).find((m) => m.mainName === member.name)?.leftInGameGuild).toBe(true);

    // A second sync doesn't notify again.
    await db.update(guilds).set({ adminNotice: null }).where(eq(guilds.id, guild.guild.id));
    expect((await runGuildCharacterSync(db, guild.guild.id, null, bnet.client())).leftGuild).toBe(0);

    member.guild = inGuild;
    await runGuildCharacterSync(db, guild.guild.id, null, bnet.client());
    const [back] = await db.select().from(characters).where(eq(characters.bnetCharacterId, String(member.id)));
    expect(back!.inGuildConfirmedAt).toBeInstanceOf(Date);
    expect(back!.inGuildLostAt).toBeNull();
    expect((await listMembers(db, gm)).find((m) => m.mainName === member.name)?.leftInGameGuild).toBe(false);
  });
});
