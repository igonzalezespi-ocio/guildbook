import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, contentPages, guilds, memberships, ranks, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { resolveTier } from "@/lib/authz/policy";
import { DomainError } from "@/server/errors";
import { actionError } from "@/server/action-error";
import {
  checkSlugAvailability,
  createGuildForUser,
  creationLimitsFromEnv,
  listDirectoryGuilds,
  listUserGuilds,
} from "@/server/services/platform";
import { deleteGuild } from "@/server/services/account";
import { updateGuildSettings } from "@/server/services/ranks";
import { createGuild, createMember, createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
let n = 0;

const limits = { perUser: 3, perDay: 2 };

async function newUser() {
  const [user] = await db.insert(users).values({ name: `Founder ${++n}`, discordId: `founder-${n}` }).returning();
  return user!;
}

function form(slug: string, extra: Record<string, string> = {}) {
  return { name: `Guild ${slug}`, slug, region: "us", faction: "alliance", ruleset: "normal", timezone: "America/New_York", motto: "", ...extra };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe("createGuildForUser", () => {
  it("creates a standard guild with the creator as its Guild Master", async () => {
    const user = await newUser();
    const { guild } = await createGuildForUser(db, user.id, form("silver-dawn", { faction: "horde", motto: "Steel and patience", directoryListed: "on" }), limits);

    expect(guild).toMatchObject({ slug: "silver-dawn", preset: "standard", faction: "horde", motto: "Steel and patience", directoryListed: true, createdByUserId: user.id, realm: null });

    const [membership] = await db
      .select({ status: memberships.status, rankName: ranks.name, rankTier: ranks.tier })
      .from(memberships)
      .innerJoin(ranks, eq(ranks.id, memberships.rankId))
      .where(and(eq(memberships.guildId, guild.id), eq(memberships.userId, user.id)));
    expect(membership).toEqual({ status: "active", rankName: "Guild Master", rankTier: "admin" });
    expect(resolveTier({ status: membership!.status, rankTier: membership!.rankTier })).toBe("admin");

    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.guildId, guild.id), eq(auditLog.action, "guild.create")));
    expect(audit).toBeTruthy();
  });

  it("gives new guilds neutral defaults and keeps the Order's content for the Order preset", async () => {
    const user = await newUser();
    const { guild } = await createGuildForUser(db, user.id, form("neutral-test"), limits);
    const rankNames = (await db.select({ name: ranks.name }).from(ranks).where(eq(ranks.guildId, guild.id))).map((r) => r.name);
    expect(rankNames).toEqual(expect.arrayContaining(["Guild Master", "Officer", "Raider", "Member", "Trial", "Applicant"]));
    expect(rankNames).not.toContain("Chaplain");

    const pages = await db.select({ slug: contentPages.slug, title: contentPages.title, body: contentPages.bodyMd }).from(contentPages).where(eq(contentPages.guildId, guild.id));
    expect(pages.map((p) => p.slug).sort()).toEqual(["charter", "loot-policy", "lore"]);
    const text = pages.map((p) => `${p.title} ${p.body}`).join(" ");
    expect(text).toContain("Guild neutral-test");
    for (const word of ["Catholic", "Michael", "prayer", "Pax", "Deus"]) expect(text).not.toContain(word);

    const order = await createGuild(db);
    const orderRanks = (await db.select({ name: ranks.name }).from(ranks).where(eq(ranks.guildId, order.guild.id))).map((r) => r.name);
    expect(orderRanks).toContain("Postulant");
    expect(order.guild.preset).toBe("order");
  });

  it("enforces slug rules and uniqueness", async () => {
    const user = await newUser();
    for (const slug of ["ab", "Bad_Slug", "-dash", "a--b", "www", "api", "admin", "platform"]) {
      await expect(createGuildForUser(db, user.id, form(slug), limits), slug).rejects.toThrow();
    }
    await createGuildForUser(db, user.id, form("taken-slug"), limits);
    const other = await newUser();
    await expect(createGuildForUser(db, other.id, form("taken-slug"), limits)).rejects.toThrow(DomainError);
    await expect(createGuildForUser(db, other.id, form("taken-slug"), limits)).rejects.toThrow("That subdomain is taken");

    expect(await checkSlugAvailability(db, "taken-slug")).toEqual({ available: false, reason: "That subdomain is taken", suggestions: ["taken-slug-2"] });
    expect(await checkSlugAvailability(db, "www")).toMatchObject({ available: false });
    expect(await checkSlugAvailability(db, "free-slug")).toEqual({ available: true });
  });

  it("limits how many guilds one user founds, per day and in total", async () => {
    const user = await newUser();
    const day1 = new Date("2026-09-01T12:00:00Z");
    await createGuildForUser(db, user.id, form("limit-a"), limits, day1);
    await createGuildForUser(db, user.id, form("limit-b"), limits, day1);
    await expect(createGuildForUser(db, user.id, form("limit-c"), limits, day1)).rejects.toThrow(/today/);

    // createdAt is set by the database, so the rolling-day check uses the real clock; move past it.
    const later = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    await createGuildForUser(db, user.id, form("limit-c"), limits, later);
    await expect(createGuildForUser(db, user.id, form("limit-d"), limits, new Date(later.getTime() + 2 * 24 * 60 * 60 * 1000))).rejects.toThrow(/up to 3 guilds/);
    expect(await db.select().from(guilds).where(eq(guilds.slug, "limit-d"))).toHaveLength(0);
  });

  it("caps guilds owned per account, explains how to get more, and frees a slot when a guild is deleted", async () => {
    const user = await newUser();
    const cap = { perUser: 2, perDay: 50 };
    const { guild: alpha } = await createGuildForUser(db, user.id, form("cap-a", { name: "Cap Alpha" }), cap);
    await createGuildForUser(db, user.id, form("cap-b", { name: "Cap Beta" }), cap);
    const err = await createGuildForUser(db, user.id, form("cap-c"), cap).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as Error).message).toMatch(/Each account can own up to 2 guilds\. You own Cap Alpha, Cap Beta\./);
    expect((err as Error).message).toMatch(/Delete a guild you no longer need.*email .+@.+ with your Discord username/);

    // Deleting a guild removes it, so the slot is free again.
    const [m] = await db.select({ id: memberships.id }).from(memberships).where(eq(memberships.guildId, alpha.id));
    await deleteGuild(db, { guildId: alpha.id, userId: user.id, membershipId: m!.id, tier: "admin" }, "Cap Alpha");
    await expect(createGuildForUser(db, user.id, form("cap-c"), cap)).resolves.toBeTruthy();
  });

  it("exempts platform admins and honours per-user overrides", async () => {
    const admin = await newUser();
    const raised = await newUser();
    const cap = { perUser: 1, perDay: 50, exemptDiscordIds: new Set([admin.discordId!]), overrides: { [raised.discordId!]: 2 } };
    for (const slug of ["admin-a", "admin-b", "admin-c"]) await createGuildForUser(db, admin.id, form(slug), cap);
    await createGuildForUser(db, raised.id, form("raised-a"), cap);
    await createGuildForUser(db, raised.id, form("raised-b"), cap);
    await expect(createGuildForUser(db, raised.id, form("raised-c"), cap)).rejects.toThrow(/up to 2 guilds/);
  });

  it("reads limits from the environment", () => {
    expect(creationLimitsFromEnv({})).toMatchObject({ perUser: 3, perDay: 2, overrides: {} });
    const env = creationLimitsFromEnv({
      GUILD_CREATE_LIMIT: "5",
      PLATFORM_ADMIN_DISCORD_IDS: " 111, 222 ",
      GUILD_CREATE_LIMIT_OVERRIDES: "333:10, bad, 444:x, 555:0",
    });
    expect(env.perUser).toBe(5);
    expect([...env.exemptDiscordIds!]).toEqual(["111", "222"]);
    expect(env.overrides).toEqual({ "333": 10, "555": 0 });
  });

  it("lists a user's guilds and the opt-in directory", async () => {
    const user = await newUser();
    await createGuildForUser(db, user.id, form("listed-one", { directoryListed: "on" }), limits);
    await createGuildForUser(db, user.id, form("hidden-one"), limits);

    const mine = await listUserGuilds(db, user.id);
    expect(mine.map((g) => g.slug).sort()).toEqual(["hidden-one", "listed-one"]);
    expect(mine[0]).toMatchObject({ rankName: "Guild Master", rankTier: "admin", status: "active", customDomain: null, main: null });

    // New guilds are drafts: out of the directory until published, even when listed.
    expect((await listDirectoryGuilds(db)).map((g) => g.slug)).not.toContain("listed-one");
    await db.update(guilds).set({ publishedAt: new Date() }).where(inArray(guilds.slug, ["listed-one", "hidden-one"]));

    const directory = await listDirectoryGuilds(db);
    const slugs = directory.map((g) => g.slug);
    expect(slugs).toContain("listed-one");
    expect(slugs).not.toContain("hidden-one");
    expect(directory.find((g) => g.slug === "listed-one")?.members).toBe(1);
  });
});

describe("one region, one faction and one ruleset per guild", () => {
  it("requires a region, a faction and a ruleset at creation", async () => {
    const user = await newUser();
    await expect(createGuildForUser(db, user.id, form("no-region", { region: "" }), limits)).rejects.toThrow(/region/);
    await expect(createGuildForUser(db, user.id, form("kr-region", { region: "kr" }), limits)).rejects.toThrow(/region/);
    await expect(createGuildForUser(db, user.id, form("no-faction", { faction: "" }), limits)).rejects.toThrow(/faction/);
    await expect(createGuildForUser(db, user.id, form("both-factions", { faction: "both" }), limits)).rejects.toThrow(/faction/);
    await expect(createGuildForUser(db, user.id, form("no-ruleset", { ruleset: "" }), limits)).rejects.toThrow(/ruleset/);
    const { guild } = await createGuildForUser(db, user.id, form("pvp-guild", { faction: "horde", ruleset: "pvp" }), limits);
    expect(guild).toMatchObject({ region: "us", faction: "horde", ruleset: "pvp" });
    const eu = await createGuildForUser(db, user.id, form("eu-guild", { region: "eu" }), limits);
    expect(eu.guild.region).toBe("eu");
  });
});

describe("guild identity uniqueness", () => {
  it("allows one guild per name, region, faction and ruleset, case-insensitively", async () => {
    const user = await newUser();
    await createGuildForUser(db, user.id, form("iron-oath", { name: "Iron Oath" }), limits);

    const other = await newUser();
    await expect(createGuildForUser(db, other.id, form("iron-oath-2", { name: "iron  OATH " }), limits)).rejects.toThrow(
      "A guild called Iron Oath (Americas, Alliance, Normal) is already on Guildbook",
    );
    expect(await db.select().from(guilds).where(eq(guilds.slug, "iron-oath-2"))).toHaveLength(0);

    const horde = await createGuildForUser(db, other.id, form("iron-oath-horde", { name: "Iron Oath", faction: "horde" }), limits);
    expect(horde.guild.name).toBe("Iron Oath");
    const pvp = await createGuildForUser(db, other.id, form("iron-oath-pvp", { name: "Iron Oath", ruleset: "pvp" }), limits);
    expect(pvp.guild.name).toBe("Iron Oath");
    const third = await newUser();
    const eu = await createGuildForUser(db, third.id, form("iron-oath-eu", { name: "Iron Oath", region: "eu" }), limits);
    expect(eu.guild).toMatchObject({ name: "Iron Oath", region: "eu" });
    await expect(createGuildForUser(db, user.id, form("iron-oath-eu-2", { name: "IRON OATH", region: "eu" }), limits)).rejects.toThrow(
      "A guild called Iron Oath (Europe, Alliance, Normal) is already on Guildbook",
    );
  });

  it("enforces per-region uniqueness in the database too", async () => {
    await createGuild(db, { name: "Twin Keep", region: "us" });
    await createGuild(db, { name: "Twin Keep", region: "eu" });
    await expect(createGuild(db, { name: "twin keep", region: "eu" })).rejects.toThrow();
  });

  it("refuses a rename or identity change onto another guild's identity", async () => {
    const taken = await createGuild(db, { name: "Crimson Vow", faction: "horde", ruleset: "rp" });
    const mover = await createGuild(db, { name: "Crimson Vow", faction: "alliance", ruleset: "rp" });
    const gm = await createMember(db, mover, "Grand Master");
    const settings = { name: "Crimson Vow", timezone: "America/New_York", region: "us", faction: "horde", ruleset: "rp" };
    await expect(updateGuildSettings(db, gm, settings)).rejects.toThrow(/Crimson Vow \(Americas, Horde, Roleplaying\) is already on Guildbook/);
    const [row] = await db.select().from(guilds).where(eq(guilds.id, mover.guild.id));
    expect(row).toMatchObject({ faction: "alliance", ruleset: "rp" });

    await expect(updateGuildSettings(db, gm, { ...settings, name: "CRIMSON VOW", faction: "alliance" })).resolves.toMatchObject({ unverified: false });
    await expect(updateGuildSettings(db, gm, { ...settings, region: "eu" })).resolves.toMatchObject({ unverified: false });
    expect((await db.select().from(guilds).where(eq(guilds.id, mover.guild.id)))[0]).toMatchObject({ region: "eu", faction: "horde" });
    expect(taken.guild.id).not.toBe(mover.guild.id);
  });
});

describe("directory", () => {
  it("filters by region, faction and ruleset and lists verified guilds first", async () => {
    const big = await createGuild(db, { slug: "dir-big", faction: "horde", ruleset: "pvp" });
    const small = await createGuild(db, { slug: "dir-small", faction: "horde", ruleset: "pvp" });
    await db.update(guilds).set({ directoryListed: true }).where(inArray(guilds.id, [big.guild.id, small.guild.id]));
    await createMember(db, big, "Knight");
    await createMember(db, big, "Knight");
    await db.update(guilds).set({ verifiedAt: new Date(), verifiedVia: "battlenet" }).where(eq(guilds.id, small.guild.id));

    const pvpHorde = await listDirectoryGuilds(db, { faction: "horde", ruleset: "pvp" });
    expect(pvpHorde.map((g) => g.slug)).toEqual(["dir-small", "dir-big"]);
    expect(pvpHorde[0]!.verifiedAt).toBeInstanceOf(Date);
    expect((await listDirectoryGuilds(db, { ruleset: "rp" })).map((g) => g.slug)).not.toContain("dir-big");
    expect((await listDirectoryGuilds(db, { faction: "alliance" })).map((g) => g.slug)).not.toContain("dir-small");

    const europe = await createGuild(db, { slug: "dir-europe", region: "eu", faction: "horde", ruleset: "pvp" });
    await db.update(guilds).set({ directoryListed: true }).where(eq(guilds.id, europe.guild.id));
    expect((await listDirectoryGuilds(db, { region: "eu" })).map((g) => g.slug)).toEqual(["dir-europe"]);
    const americas = (await listDirectoryGuilds(db, { region: "us", faction: "horde", ruleset: "pvp" })).map((g) => g.slug);
    expect(americas).toEqual(["dir-small", "dir-big"]);
    expect((await listDirectoryGuilds(db, { faction: "horde", ruleset: "pvp" }))[0]).toHaveProperty("region");
  });
});

describe("subdomain suggestions", () => {
  it("suggests subdomains that name what sets a new guild apart from the holder", async () => {
    const user = await newUser();
    await createGuildForUser(db, user.id, form("oathbound", { name: "Oathbound" }), limits);

    expect(await checkSlugAvailability(db, "oathbound", { region: "eu", faction: "horde", ruleset: "pvp" })).toEqual({
      available: false,
      reason: "That subdomain is taken",
      suggestions: ["oathbound-pvp", "oathbound-horde", "oathbound-eu"],
    });
    expect((await checkSlugAvailability(db, "oathbound", { region: "us", faction: "alliance", ruleset: "hardcore" })).available).toBe(false);
    expect(await checkSlugAvailability(db, "oathbound", { region: "us", faction: "alliance", ruleset: "hardcore" })).toMatchObject({
      suggestions: ["oathbound-hc"],
    });
    expect(await checkSlugAvailability(db, "oathbound", { ruleset: "rp" })).toMatchObject({ suggestions: ["oathbound-rp"] });

    // Taken differentiators are skipped; when all are taken, a numbered slug is the fallback.
    const other = await newUser();
    await createGuildForUser(db, other.id, form("oathbound-rp", { name: "Oathbound RP" }), limits);
    expect(await checkSlugAvailability(db, "oathbound", { ruleset: "rp", faction: "horde" })).toMatchObject({ suggestions: ["oathbound-horde"] });
    expect(await checkSlugAvailability(db, "oathbound", { ruleset: "rp" })).toMatchObject({ suggestions: ["oathbound-2"] });
    // Nothing sets an identical guild apart.
    expect(await checkSlugAvailability(db, "oathbound", { region: "us", faction: "alliance", ruleset: "normal" })).toMatchObject({
      suggestions: ["oathbound-2"],
    });
  });

  it("points a taken subdomain at the slug field with suggestions when creating", async () => {
    const user = await newUser();
    await createGuildForUser(db, user.id, form("dawnguard", { name: "Dawnguard" }), limits);
    const other = await newUser();
    const err = await createGuildForUser(db, other.id, form("dawnguard", { name: "Dawnguard", faction: "horde" }), limits).catch((e: unknown) => e);
    expect(actionError(err)).toEqual({
      ok: false,
      error: "Please fix these fields:",
      fieldErrors: { slug: ["That subdomain is taken"] },
      suggestions: { slug: ["dawnguard-horde"] },
    });
  });

  it("reports validation failures per field, including fields a form might not render", async () => {
    const user = await newUser();
    const err = await createGuildForUser(db, user.id, form("no-region-field", { region: "" }), limits).catch((e: unknown) => e);
    expect(actionError(err)).toMatchObject({ ok: false, error: "Please fix these fields:", fieldErrors: { region: ["Elige la región de tu hermandad"] } });
  });
});

describe("game versions", () => {
  const anniversary = (slug: string, extra: Record<string, string> = {}) =>
    form(slug, { name: "Mirkwood", faction: "horde", gameVersion: "anniversary", realmSlug: "dreamscythe", ruleset: "", ...extra });

  it("creates an unverified TBC Anniversary guild on a realm, with the realm's ruleset", async () => {
    const user = await newUser();
    const { guild } = await createGuildForUser(db, user.id, anniversary("mirkwood"), limits);
    expect(guild).toMatchObject({ gameVersion: "anniversary", realmSlug: "dreamscythe", region: "us", ruleset: "normal", verifiedAt: null });
    const [audit] = await db.select().from(auditLog).where(and(eq(auditLog.guildId, guild.id), eq(auditLog.action, "guild.create")));
    expect(audit?.after).toMatchObject({ gameVersion: "anniversary", realmSlug: "dreamscythe" });
  });

  it("scopes names to the version and realm, and suggests the realm as the subdomain", async () => {
    const forever = await newUser();
    await createGuildForUser(db, forever.id, form("elderwood", { name: "Elderwood", faction: "horde" }), limits);
    const founder = await newUser();
    expect(await checkSlugAvailability(db, "elderwood", { gameVersion: "anniversary", realmSlug: "dreamscythe", region: "us", faction: "horde", ruleset: "normal" })).toMatchObject({
      suggestions: ["elderwood-dreamscythe"],
    });
    const { guild } = await createGuildForUser(db, founder.id, anniversary("elderwood-dreamscythe", { name: "Elderwood" }), limits);
    expect(guild.name).toBe("Elderwood");
    // Another realm is another world; the same realm is taken.
    const other = await newUser();
    await expect(createGuildForUser(db, other.id, anniversary("elderwood-nightslayer", { name: "Elderwood", realmSlug: "nightslayer" }), limits)).resolves.toBeTruthy();
    await expect(createGuildForUser(db, other.id, anniversary("elderwood-again", { name: "ELDERWOOD" }), limits)).rejects.toThrow(
      /Elderwood \(TBC Anniversary, Dreamscythe \(US\), Horde\) is already on Guildbook/,
    );
  });

  it("refuses a realm in another region and versions that can't be chosen", async () => {
    const user = await newUser();
    await expect(createGuildForUser(db, user.id, anniversary("wrong-realm", { realmSlug: "thunderstrike" }), limits)).rejects.toThrow();
    await expect(createGuildForUser(db, user.id, form("era-guild", { gameVersion: "era" }), limits)).rejects.toThrow();
  });

  it("keeps the version and lets the realm change only while unverified", async () => {
    const user = await newUser();
    const { guild } = await createGuildForUser(db, user.id, anniversary("realm-mover", { name: "Realm Mover" }), limits);
    const [membership] = await db.select().from(memberships).where(eq(memberships.guildId, guild.id));
    const gm = { guildId: guild.id, userId: user.id, membershipId: membership!.id, tier: "admin" as const };
    const settings = { name: "Realm Mover", timezone: "America/New_York", region: "us", faction: "horde", gameVersion: "forever", ruleset: "rp" };

    await updateGuildSettings(db, gm, { ...settings, realmSlug: "spineshatter" });
    const [moved] = await db.select().from(guilds).where(eq(guilds.id, guild.id));
    expect(moved).toMatchObject({ gameVersion: "anniversary", realmSlug: "spineshatter", region: "eu", ruleset: "pvp" });

    await db.update(guilds).set({ verifiedAt: new Date(), verifiedVia: "battlenet" }).where(eq(guilds.id, guild.id));
    await expect(updateGuildSettings(db, gm, { ...settings, region: "eu", realmSlug: "thunderstrike" })).rejects.toThrow(/can't move realm/);
    await expect(updateGuildSettings(db, gm, { ...settings, region: "eu", motto: "Still here" })).resolves.toMatchObject({ unverified: false });
    expect((await db.select().from(guilds).where(eq(guilds.id, guild.id)))[0]).toMatchObject({ realmSlug: "spineshatter", motto: "Still here" });
  });

  it("lists WoW: Forever by default and other versions only when asked, filterable by realm", async () => {
    const user = await newUser();
    const tbc = await createGuildForUser(db, user.id, anniversary("dir-tbc", { name: "Dir TBC", realmSlug: "nightslayer", directoryListed: "on" }), limits);
    await db.update(guilds).set({ publishedAt: new Date() }).where(eq(guilds.id, tbc.guild.id));
    expect((await listDirectoryGuilds(db)).map((g) => g.slug)).not.toContain("dir-tbc");
    expect((await listDirectoryGuilds(db, { version: "anniversary" })).map((g) => g.slug)).toEqual(["dir-tbc"]);
    expect((await listDirectoryGuilds(db, { version: "anniversary", realm: "dreamscythe" })).map((g) => g.slug)).toEqual([]);
    expect((await listDirectoryGuilds(db, { version: "anniversary", realm: "nightslayer" }))[0]).toMatchObject({ gameVersion: "anniversary", realmSlug: "nightslayer" });
  });
});
