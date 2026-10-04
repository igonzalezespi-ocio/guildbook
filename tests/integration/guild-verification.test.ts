import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, battlenetLinks, type BattlenetCharacterSnapshot, guilds, memberships, ranks } from "@/db/schema";
import type { Db } from "@/db/types";
import type { Faction, Region } from "@/lib/game";
import { DomainError } from "@/server/errors";
import {
  claimGuildName,
  claimGuildSlug,
  getSlugClaim,
  guildMasterHandover,
  promoteVerifiedGuildMaster,
  recheckAdminStanding,
  recheckVerifiedGuilds,
  recordFounderStanding,
  verifyGuild,
} from "@/server/services/guild-verification";
import { updateGuildSettings } from "@/server/services/ranks";
import { createGuild, createMember, createTestDb } from "../support/db";
import { type FakeCharacter, FakeBattlenet } from "../support/fake-battlenet";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const AFTER_LAUNCH = new Date("2026-12-01T12:00:00Z");
const PRE_LAUNCH = new Date("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let seq = 1000;

/** A guild whose Grand Master has linked Battle.net with `characters` in their snapshot. */
async function setup(
  opts: { name?: string; region?: Region; faction?: Faction; ruleset?: "normal" | "pvp" | "rp"; characters?: FakeCharacter[] } = {},
) {
  const guild = await createGuild(db, {
    name: opts.name ?? `Guild ${++seq}`,
    region: opts.region ?? "us",
    faction: opts.faction ?? "alliance",
    ruleset: opts.ruleset ?? "normal",
  });
  const gm = await createMember(db, guild, "Grand Master");
  if (opts.characters) await link(gm.userId, opts.characters);
  return { guild: guild.guild, gm };
}

async function link(userId: string, characters: FakeCharacter[]) {
  const snapshot: BattlenetCharacterSnapshot[] = characters.map((c) => ({
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
    ...(c.region ? { region: c.region } : {}),
    ...(c.version ? { gameVersion: c.version } : {}),
  }));
  await db.insert(battlenetLinks).values({ userId, battlenetId: `bnet-${++seq}`, battletag: `Tester#${seq}`, region: "us", characters: snapshot });
}

async function row(id: string) {
  const [g] = await db.select().from(guilds).where(eq(guilds.id, id));
  return g!;
}

async function actions(guildId: string) {
  return (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, guildId))).map((r) => r.action);
}

/** A Guild Master character (rank 0) of `guildName` on a Normal realm. */
function guildMaster(
  bnet: FakeBattlenet,
  guildName: string,
  opts: { faction?: Faction; realm?: string; rank?: number; region?: Region; version?: "anniversary" } = {},
) {
  const realm = opts.realm ?? "forever-normal";
  const faction = opts.faction ?? "alliance";
  bnet.realmTypes.set(realm, bnet.realmTypes.get(realm) ?? "NORMAL");
  const c = bnet.character({
    id: ++seq,
    name: `Leader${seq}`,
    realm,
    faction,
    region: opts.region,
    version: opts.version,
    guild: { name: guildName, realm, faction },
  });
  bnet.roster(realm, guildName, [[c.id, opts.rank ?? 0]]);
  return c;
}

describe("verifying a guild", () => {
  it("verifies when an admin's character is rank 0 of the in-game guild with the same name, faction and ruleset", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Dawn Wardens");
    const { guild, gm } = await setup({ name: "Dawn Wardens", characters: [char] });

    const { state, result } = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(state).toBe("verified");
    expect(result).toMatchObject({ verified: true, characterName: char.name });
    expect(await row(guild.id)).toMatchObject({
      verifiedAt: AFTER_LAUNCH,
      verifiedUserId: gm.userId,
      verifiedCharacterId: String(char.id),
      verifiedCharacterName: char.name,
      verifiedRealmSlug: "forever-normal",
      verifiedVia: "battlenet",
      verificationCheckedAt: AFTER_LAUNCH,
    });
    expect(await actions(guild.id)).toContain("guild.verify");
  });

  it("matches names case- and whitespace-insensitively", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "the  silver  HAND");
    const { gm } = await setup({ name: "The Silver Hand", characters: [char] });
    expect((await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH)).state).toBe("verified");
  });

  it("explains pre-launch: no Forever characters exist yet", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm } = await setup({ characters: [] });
    const { state, result } = await verifyGuild(db, gm, bnet.client(), PRE_LAUNCH);
    expect(state).toBe("unverified");
    expect(result).toMatchObject({ verified: false, reason: "prelaunch" });
    expect(result.message).toMatch(/Forever sale el 4 de noviembre de 2026/);
    expect((await row(guild.id)).verifiedAt).toBeNull();

    expect((await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH)).result.reason).toBe("no_version_characters");
  });

  it("explains when no admin has linked Battle.net", async () => {
    const { gm } = await setup();
    const { result } = await verifyGuild(db, gm, new FakeBattlenet().client(), AFTER_LAUNCH);
    expect(result).toMatchObject({ reason: "no_link" });
  });

  it("refuses a character that isn't rank 0", async () => {
    const bnet = new FakeBattlenet();
    const officer = guildMaster(bnet, "Oathsworn", { rank: 1 });
    const { guild, gm } = await setup({ name: "Oathsworn", characters: [officer] });
    const { state, result } = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(state).toBe("unverified");
    expect(result).toMatchObject({ reason: "not_guild_master", conclusive: true });
    expect(result.message).toMatch(/no es su maestro de la hermandad \(rango 1\)/);
    expect((await row(guild.id)).verifiedAt).toBeNull();
  });

  it("refuses a faction or ruleset mismatch", async () => {
    const bnet = new FakeBattlenet();
    const horde = guildMaster(bnet, "Red Banner", { faction: "horde", realm: "forever-normal-h" });
    const { gm } = await setup({ name: "Red Banner", faction: "alliance", characters: [horde] });
    expect((await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH)).result.reason).toBe("faction_mismatch");

    bnet.realmTypes.set("forever-pvp", "PVP");
    const pvp = guildMaster(bnet, "Grey Watch", { realm: "forever-pvp" });
    const other = await setup({ name: "Grey Watch", ruleset: "normal", characters: [pvp] });
    const { result } = await verifyGuild(db, other.gm, bnet.client(), AFTER_LAUNCH);
    expect(result.reason).toBe("ruleset_mismatch");
    expect(result.message).toMatch(/en el tipo de reino JcJ, pero esta hermandad es Normal/);
  });

  it("checks an EU guild against the EU API with its EU characters", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Nordwacht", { region: "eu" });
    const { guild, gm } = await setup({ name: "Nordwacht", region: "eu", characters: [char] });
    const { state, result } = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(state).toBe("verified");
    expect(result.message).toMatch(/\(Europa, Alianza, Normal\)/);
    expect(bnet.profileRegions).toEqual(["eu"]);
    expect((await row(guild.id)).verifiedCharacterName).toBe(char.name);

    // The daily re-check runs in the guild's region too.
    bnet.profileRegions = [];
    await recheckVerifiedGuilds(db, bnet.client(), new Date(AFTER_LAUNCH.getTime() + DAY));
    expect(bnet.profileRegions).toContain("eu");
    expect(await row(guild.id)).toMatchObject({ verificationFailingSince: null, verificationResult: expect.objectContaining({ verified: true }) });
  });

  it("only counts characters in the guild's region", async () => {
    const bnet = new FakeBattlenet();
    // Guild Master of a same-named guild, but in Europe: never checked for an Americas guild.
    const euLeader = guildMaster(bnet, "Twin Crowns", { region: "eu" });
    const { guild, gm } = await setup({ name: "Twin Crowns", region: "us", characters: [euLeader] });
    const { state, result } = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(state).toBe("unverified");
    expect(result).toMatchObject({ verified: false, reason: "region_mismatch", conclusive: true });
    expect(result.message).toMatch(/esta hermandad está en la región de América/);
    expect(bnet.profileRegions).toEqual([]);
    expect((await row(guild.id)).verifiedAt).toBeNull();

    // And the other way round: a Europe guild whose admin only has Americas characters.
    const usLinked = await setup({ name: "Twin Crowns West", region: "eu", characters: [{ ...euLeader, region: "us" }] });
    expect((await verifyGuild(db, usLinked.gm, bnet.client(), AFTER_LAUNCH)).result.reason).toBe("region_mismatch");
  });

  it("treats a hidden roster or Blizzard outage as inconclusive", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Quiet Ones");
    bnet.roster("forever-normal", "Quiet Ones", 403);
    const { gm } = await setup({ name: "Quiet Ones", characters: [char] });
    expect((await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH)).result).toMatchObject({ reason: "roster_unavailable", conclusive: false });

    bnet.down = true;
    expect((await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH)).result).toMatchObject({ reason: "blizzard_error", conclusive: false });
  });

  it("only lets admins verify", async () => {
    const bnet = new FakeBattlenet();
    const created = await createGuild(db);
    const knight = await createMember(db, created, "Knight");
    await expect(verifyGuild(db, knight, bnet.client(), AFTER_LAUNCH)).rejects.toThrow();
  });
});

describe("claiming a guild name", () => {
  it("renames the unverified holder and verifies the claimant", async () => {
    const bnet = new FakeBattlenet();
    const holder = await createGuild(db, { name: "Knights of Dawn" });
    const char = guildMaster(bnet, "Knights of Dawn");
    const { guild, gm } = await setup({ name: "Knights of Dawn Temp", characters: [char] });

    const check = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(check.result).toMatchObject({ reason: "name_mismatch", claim: { name: "Knights of Dawn", holderName: "Knights of Dawn", holderVerified: false } });

    const claimed = await claimGuildName(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(claimed).toEqual({ renamedHolder: "Knights of Dawn (sin verificar)", name: "Knights of Dawn" });
    expect(await row(guild.id)).toMatchObject({ name: "Knights of Dawn", verifiedAt: AFTER_LAUNCH, verifiedCharacterName: char.name });

    const renamed = await row(holder.guild.id);
    expect(renamed.name).toBe("Knights of Dawn (sin verificar)");
    expect(renamed.slug).toBe(holder.guild.slug);
    expect(renamed.adminNotice).toMatch(/Una hermandad verificada reclamó el nombre «Knights of Dawn»/);
    expect(await actions(holder.guild.id)).toContain("guild.name_claimed");
    expect(await actions(guild.id)).toEqual(expect.arrayContaining(["guild.claim_name", "guild.verify"]));
  });

  it("numbers the unverified name when it's taken", async () => {
    const bnet = new FakeBattlenet();
    await createGuild(db, { name: "Lions Pride (sin verificar)" });
    const holder = await createGuild(db, { name: "Lions Pride" });
    const char = guildMaster(bnet, "Lions Pride");
    const { gm } = await setup({ name: "Lions Pride Placeholder", characters: [char] });
    expect((await claimGuildName(db, gm, bnet.client(), AFTER_LAUNCH)).renamedHolder).toBe("Lions Pride (sin verificar 2)");
    expect((await row(holder.guild.id)).name).toBe("Lions Pride (sin verificar 2)");
  });

  it("never takes the name from a verified guild", async () => {
    const bnet = new FakeBattlenet();
    const holder = await createGuild(db, { name: "Sworn Shield" });
    await db.update(guilds).set({ verifiedAt: new Date(), verifiedVia: "battlenet" }).where(eq(guilds.id, holder.guild.id));
    const char = guildMaster(bnet, "Sworn Shield");
    const { guild, gm } = await setup({ name: "Sworn Shield Two", characters: [char] });

    await expect(claimGuildName(db, gm, bnet.client(), AFTER_LAUNCH)).rejects.toThrow(/El nombre de una hermandad verificada no se puede reclamar/);
    expect((await row(holder.guild.id)).name).toBe("Sworn Shield");
    expect(await row(guild.id)).toMatchObject({ name: "Sworn Shield Two", verifiedAt: null });
  });

  it("only renames a holder in the same region", async () => {
    const bnet = new FakeBattlenet();
    const otherRegion = await createGuild(db, { name: "Vale Guard", region: "eu" });
    const char = guildMaster(bnet, "Vale Guard");
    const { guild, gm } = await setup({ name: "Vale Guard Temp", characters: [char] });
    expect((await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH)).result.claim).toMatchObject({ holderName: null });
    expect(await claimGuildName(db, gm, bnet.client(), AFTER_LAUNCH)).toEqual({ renamedHolder: null, name: "Vale Guard" });
    expect((await row(otherRegion.guild.id)).name).toBe("Vale Guard");
    expect((await row(guild.id)).name).toBe("Vale Guard");
  });

  it("refuses a claim when the admin isn't the in-game Guild Master", async () => {
    const bnet = new FakeBattlenet();
    await createGuild(db, { name: "Iron Pact" });
    const officer = guildMaster(bnet, "Iron Pact", { rank: 2 });
    const { gm } = await setup({ name: "Iron Pact Alt", characters: [officer] });
    await expect(claimGuildName(db, gm, bnet.client(), AFTER_LAUNCH)).rejects.toThrow(DomainError);
  });
});

describe("claiming a subdomain", () => {
  it("moves an unverified holder to a subdomain naming what sets it apart", async () => {
    const holder = await createGuild(db, { slug: "oathbound", name: "Oathbound", faction: "horde", ruleset: "pvp", region: "eu" });
    await createGuild(db, { slug: "oathbound-pvp", name: "Someone On Pvp" });
    const { guild, gm } = await setup({ name: "Oathbound" });
    await db.update(guilds).set({ verifiedAt: new Date(), verifiedVia: "battlenet" }).where(eq(guilds.id, guild.id));

    expect(await getSlugClaim(db, await row(guild.id))).toMatchObject({ slug: "oathbound", holderName: "Oathbound", holderMovesTo: "oathbound-horde" });
    const moved = await claimGuildSlug(db, gm, AFTER_LAUNCH);
    expect(moved).toEqual({ slug: "oathbound", previousSlug: guild.slug, movedHolderTo: "oathbound-horde" });
    expect((await row(holder.guild.id)).slug).toBe("oathbound-horde");
    expect((await row(holder.guild.id)).adminNotice).toMatch(/subdominio de esta hermandad ahora es «oathbound-horde»/);
  });

  it("falls back to a numbered subdomain when nothing sets the holder apart", async () => {
    const holder = await createGuild(db, { slug: "morning-star", name: "Somebody Else" });
    const { guild, gm } = await setup({ name: "Morning Star" });
    await db.update(guilds).set({ verifiedAt: new Date(), verifiedVia: "battlenet" }).where(eq(guilds.id, guild.id));

    const moved = await claimGuildSlug(db, gm, AFTER_LAUNCH);
    expect(moved).toEqual({ slug: "morning-star", previousSlug: guild.slug, movedHolderTo: "morning-star-2" });
    expect((await row(guild.id)).slug).toBe("morning-star");
    expect(await row(holder.guild.id)).toMatchObject({ slug: "morning-star-2", name: "Somebody Else" });
    expect((await row(holder.guild.id)).adminNotice).toMatch(/reclamó el subdominio «morning-star»/);
    expect(await actions(holder.guild.id)).toContain("guild.slug_claimed");
  });

  it("refuses unverified claimants and verified holders", async () => {
    const holder = await createGuild(db, { slug: "evening-star", name: "Held" });
    const { guild, gm } = await setup({ name: "Evening Star" });
    await expect(claimGuildSlug(db, gm, AFTER_LAUNCH)).rejects.toThrow(/Solo las hermandades verificadas/);

    await db.update(guilds).set({ verifiedAt: new Date() }).where(eq(guilds.id, guild.id));
    await db.update(guilds).set({ verifiedAt: new Date() }).where(eq(guilds.id, holder.guild.id));
    await expect(claimGuildSlug(db, gm, AFTER_LAUNCH)).rejects.toThrow(/Una hermandad verificada usa ese subdominio/);
  });
});

describe("daily re-check", () => {
  it("keeps the badge for a 7-day grace period, then removes it, auditing each step", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Grace Keepers");
    const { guild, gm } = await setup({ name: "Grace Keepers", characters: [char] });
    await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);

    // Still Guild Master: stays verified.
    let summary = await recheckVerifiedGuilds(db, bnet.client(), new Date(AFTER_LAUNCH.getTime() + DAY));
    expect(summary.verified).toBeGreaterThanOrEqual(1);
    expect((await row(guild.id)).verificationFailingSince).toBeNull();

    // Handed the guild over in game.
    bnet.roster("forever-normal", "Grace Keepers", [[char.id, 1]]);
    const firstFail = new Date(AFTER_LAUNCH.getTime() + 2 * DAY);
    summary = await recheckVerifiedGuilds(db, bnet.client(), firstFail);
    expect(summary.failing).toBeGreaterThanOrEqual(1);
    expect(await row(guild.id)).toMatchObject({ verificationFailingSince: firstFail, verifiedCharacterName: char.name });
    expect((await row(guild.id)).verifiedAt).not.toBeNull();

    // Blizzard down during the grace period: doesn't count either way.
    bnet.down = true;
    await recheckVerifiedGuilds(db, bnet.client(), new Date(firstFail.getTime() + 3 * DAY));
    expect((await row(guild.id)).verificationFailingSince).toEqual(firstFail);
    bnet.down = false;

    await recheckVerifiedGuilds(db, bnet.client(), new Date(firstFail.getTime() + 6 * DAY));
    expect((await row(guild.id)).verifiedAt).not.toBeNull();

    summary = await recheckVerifiedGuilds(db, bnet.client(), new Date(firstFail.getTime() + 7 * DAY));
    expect(summary.lapsed).toBeGreaterThanOrEqual(1);
    expect(await row(guild.id)).toMatchObject({ verifiedAt: null, verifiedCharacterId: null, verificationFailingSince: null });

    const log = await actions(guild.id);
    expect(log.filter((a) => a === "guild.verification.failing")).toHaveLength(1);
    expect(log).toContain("guild.verification.lapse");
  });

  it("clears the grace period when the check passes again", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Second Wind");
    const { guild, gm } = await setup({ name: "Second Wind", characters: [char] });
    await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);

    bnet.roster("forever-normal", "Second Wind", [[char.id, 3]]);
    await recheckVerifiedGuilds(db, bnet.client(), new Date(AFTER_LAUNCH.getTime() + DAY));
    expect((await row(guild.id)).verificationFailingSince).not.toBeNull();

    bnet.roster("forever-normal", "Second Wind", [[char.id, 0]]);
    await recheckVerifiedGuilds(db, bnet.client(), new Date(AFTER_LAUNCH.getTime() + 2 * DAY));
    expect(await row(guild.id)).toMatchObject({ verificationFailingSince: null, verifiedAt: AFTER_LAUNCH });
  });

  it("starts the grace period when the verifying admin leaves the guild", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Wandering Blade");
    const { guild, gm } = await setup({ name: "Wandering Blade", characters: [char] });
    await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);

    await db.update(memberships).set({ status: "former" }).where(and(eq(memberships.guildId, guild.id), eq(memberships.userId, gm.userId)));
    await recheckVerifiedGuilds(db, bnet.client(), new Date(AFTER_LAUNCH.getTime() + DAY));
    expect(await row(guild.id)).toMatchObject({ verificationResult: expect.objectContaining({ reason: "gm_left" }) });
    expect((await row(guild.id)).verificationFailingSince).not.toBeNull();
  });
});

describe("changing a verified guild's identity", () => {
  it("removes the verification", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Steadfast");
    const { guild, gm } = await setup({ name: "Steadfast", characters: [char] });
    await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);

    const settings = { name: "Steadfast", timezone: "America/New_York", region: "us", faction: "alliance", ruleset: "normal", motto: "Hold" };
    expect(await updateGuildSettings(db, gm, settings)).toMatchObject({ unverified: false });
    expect((await row(guild.id)).verifiedAt).not.toBeNull();

    expect(await updateGuildSettings(db, gm, { ...settings, ruleset: "pvp" })).toMatchObject({ unverified: true });
    expect((await row(guild.id)).verifiedAt).toBeNull();
    expect(await actions(guild.id)).toContain("guild.verification.remove");
  });

  it("removes the verification when the region changes", async () => {
    const bnet = new FakeBattlenet();
    const char = guildMaster(bnet, "Far Shore");
    const { guild, gm } = await setup({ name: "Far Shore", characters: [char] });
    await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect((await row(guild.id)).verifiedAt).not.toBeNull();

    const settings = { name: "Far Shore", timezone: "Europe/Berlin", region: "eu", faction: "alliance", ruleset: "normal" };
    expect(await updateGuildSettings(db, gm, settings)).toMatchObject({ unverified: true });
    expect(await row(guild.id)).toMatchObject({ region: "eu", verifiedAt: null, verifiedCharacterId: null });
    expect(await actions(guild.id)).toContain("guild.verification.remove");
  });
});

describe("TBC Anniversary guilds", () => {
  async function annGuild(opts: { name?: string; realmSlug?: string } = {}) {
    const guild = await createGuild(db, {
      name: opts.name ?? `Mirkwood ${++seq}`,
      faction: "horde",
      gameVersion: "anniversary",
      realmSlug: opts.realmSlug ?? "dreamscythe",
    });
    const gm = await createMember(db, guild, "Líder");
    return { guild, gm };
  }

  it("verifies the Guild Master of the in-game guild on the guild's realm, in the Anniversary namespace", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm } = await annGuild({ name: "Mirkwood" });
    const char = guildMaster(bnet, "Mirkwood", { realm: "dreamscythe", faction: "horde", version: "anniversary" });
    await link(gm.userId, [char]);

    const { state, result } = await verifyGuild(db, gm, bnet.client(), PRE_LAUNCH);
    expect(state).toBe("verified");
    expect(result).toMatchObject({ verified: true, characterName: char.name });
    expect(await row(guild.guild.id)).toMatchObject({ verifiedRealmSlug: "dreamscythe", verifiedCharacterId: String(char.id) });
    expect(bnet.profileNamespaces.every((n) => n === "profile-classicann-us")).toBe(true);
    expect(bnet.profileNamespaces.length).toBeGreaterThan(0);
  });

  it("refuses the Guild Master of a same-named guild on another realm", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm } = await annGuild({ realmSlug: "dreamscythe" });
    const char = guildMaster(bnet, guild.guild.name, { realm: "nightslayer", faction: "horde", version: "anniversary" });
    await link(gm.userId, [char]);

    const { state, result } = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(state).toBe("unverified");
    expect(result).toMatchObject({ verified: false, reason: "realm_mismatch", conclusive: true });
    expect(result.message).toMatch(/Nightslayer/);
    expect(result.message).toMatch(/Dreamscythe/);
  });

  it("explains a version mismatch when an admin only has characters in another version", async () => {
    const bnet = new FakeBattlenet();
    const { gm } = await annGuild();
    await link(gm.userId, [guildMaster(bnet, "Somewhere Else")]);
    const { result } = await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    expect(result).toMatchObject({ verified: false, reason: "version_mismatch" });
    expect(result.message).toMatch(/TBC Anniversary/);

    // And the other way round: a Forever guild whose admin only plays TBC Anniversary.
    const annOnly = guildMaster(bnet, "Forever Folk", { realm: "dreamscythe", faction: "alliance", version: "anniversary" });
    const forever = await setup({ name: "Forever Folk", characters: [annOnly] });
    expect((await verifyGuild(db, forever.gm, bnet.client(), AFTER_LAUNCH)).result.reason).toBe("version_mismatch");
  });

  it("re-checks Anniversary guilds daily, keeping a Guild Master who still holds rank 0", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm } = await annGuild();
    const char = guildMaster(bnet, guild.guild.name, { realm: "dreamscythe", faction: "horde", version: "anniversary" });
    await link(gm.userId, [char]);
    await verifyGuild(db, gm, bnet.client(), AFTER_LAUNCH);
    const later = new Date(AFTER_LAUNCH.getTime() + 2 * DAY);
    await recheckVerifiedGuilds(db, bnet.client(), later);
    expect(await row(guild.guild.id)).toMatchObject({ verifiedAt: AFTER_LAUNCH, verificationCheckedAt: later });
  });

  it("records a founder who is a member but not the Guild Master, and hands the top rank over once the Guild Master verifies", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm: founder } = await annGuild();
    const name = guild.guild.name;
    bnet.realmTypes.set("dreamscythe", "NORMAL");
    const mine = bnet.character({ id: ++seq, name: `Member${seq}`, realm: "dreamscythe", faction: "horde", version: "anniversary", guild: { name, realm: "dreamscythe", faction: "horde" } });
    const leader = bnet.character({ id: ++seq, name: `Leader${seq}`, realm: "dreamscythe", faction: "horde", version: "anniversary", guild: { name, realm: "dreamscythe", faction: "horde" } });
    bnet.roster("dreamscythe", name, [
      [leader.id, 0],
      [mine.id, 3],
    ]);
    await link(founder.userId, [mine]);

    expect(await recordFounderStanding(db, guild.guild.id, founder.userId, bnet.client(), AFTER_LAUNCH)).toMatchObject({
      status: "member",
      characterName: mine.name,
      rank: 3,
    });
    const recorded = await row(guild.guild.id);
    expect(recorded.setup.founderNotGm).toMatchObject({ characterName: mine.name, rank: 3 });
    expect(recorded.setup.inviteCode).toBeTruthy();

    // The founder can't verify: their character isn't rank 0.
    expect((await verifyGuild(db, founder, bnet.client(), AFTER_LAUNCH)).result.reason).toBe("not_guild_master");

    // The in-game Guild Master joins on an admin rank below the top one, links Battle.net and verifies.
    const [coLeader] = await db
      .insert(ranks)
      .values({ guildId: guild.guild.id, name: "Co-Leader", sortOrder: 999, tier: "admin" })
      .returning();
    const gm = await createMember(db, guild, "Oficial");
    await db.update(memberships).set({ rankId: coLeader!.id }).where(eq(memberships.id, gm.membershipId!));
    await link(gm.userId, [leader]);
    expect((await verifyGuild(db, founder, bnet.client(), AFTER_LAUNCH)).state).toBe("verified");
    const verified = await row(guild.guild.id);
    expect(verified.verifiedUserId).toBe(gm.userId);
    expect(verified.setup.founderNotGm).toBeUndefined();

    const handover = await guildMasterHandover(db, verified);
    expect(handover).toMatchObject({ membershipId: gm.membershipId, topRank: { name: "Líder" }, characterName: leader.name });
    expect(await promoteVerifiedGuildMaster(db, founder)).toMatchObject({ rankName: "Líder", characterName: leader.name });
    expect(await guildMasterHandover(db, verified)).toBeNull();
    expect(await actions(guild.guild.id)).toContain("member.assignRank");
    await expect(promoteVerifiedGuildMaster(db, founder)).rejects.toThrow(DomainError);
  });

  it("records the founder's standing when their own check finds them a member but not the Guild Master", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm: founder } = await annGuild();
    await link(founder.userId, [guildMaster(bnet, guild.guild.name, { realm: "dreamscythe", faction: "horde", version: "anniversary", rank: 2 })]);
    expect((await verifyGuild(db, founder, bnet.client(), AFTER_LAUNCH)).result.reason).toBe("not_guild_master");
    const recorded = await row(guild.guild.id);
    expect(recorded.setup.founderNotGm).toMatchObject({ rank: 2 });
    expect(recorded.setup.inviteCode).toBeTruthy();
  });

  it("re-checks an admin who links Battle.net after founding the guild, and skips non-admins", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm: founder } = await annGuild();
    const name = guild.guild.name;
    expect((await recordFounderStanding(db, guild.guild.id, founder.userId, bnet.client(), AFTER_LAUNCH)).status).toBe("unknown");

    bnet.realmTypes.set("dreamscythe", "NORMAL");
    const mine = bnet.character({ id: ++seq, name: `Member${seq}`, realm: "dreamscythe", faction: "horde", version: "anniversary", guild: { name, realm: "dreamscythe", faction: "horde" } });
    bnet.roster("dreamscythe", name, [[mine.id, 4]]);
    await link(founder.userId, [mine]);

    const raider = await createMember(db, guild, "Oficial");
    expect((await recheckAdminStanding(db, { ...raider, tier: "officer" }, bnet.client(), AFTER_LAUNCH)).status).toBe("unknown");
    expect((await row(guild.guild.id)).setup.founderNotGm).toBeUndefined();

    expect(await recheckAdminStanding(db, founder, bnet.client(), AFTER_LAUNCH)).toMatchObject({ status: "member", rank: 4 });
    expect((await row(guild.guild.id)).setup.founderNotGm).toMatchObject({ characterName: mine.name, rank: 4 });
  });

  it("records nothing for a founder who is the in-game Guild Master", async () => {
    const bnet = new FakeBattlenet();
    const { guild, gm } = await annGuild();
    await link(gm.userId, [guildMaster(bnet, guild.guild.name, { realm: "dreamscythe", faction: "horde", version: "anniversary" })]);
    expect((await recordFounderStanding(db, guild.guild.id, gm.userId, bnet.client(), AFTER_LAUNCH)).status).toBe("guild_master");
    expect((await row(guild.guild.id)).setup.founderNotGm).toBeUndefined();
  });
});
