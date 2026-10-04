import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CHARTER_CONTENT } from "@/db/order";
import * as schema from "@/db/schema";
import { auditLog, contentPages, contentRevisions, guilds, memberships, ranks, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { AuthorizationError, resolveTier } from "@/lib/authz/policy";
import { LORE_MD } from "@/lib/lore";
import { RANK_PRESETS } from "@/lib/rank-presets";
import { DomainError } from "@/server/errors";
import { DRAFT_APPLICATIONS_CLOSED, submitApplication } from "@/server/services/applications";
import { updateContentPage } from "@/server/services/content";
import {
  applyNeutralDefaults,
  applyRankPreset,
  confirmRanks,
  ensureDraftInvite,
  getGuildSetup,
  publishGuild,
  setSetupDismissed,
  setSetupStepSkipped,
  unpublishGuild,
} from "@/server/services/guild-setup";
import { DEFAULT_RANKS } from "@/server/services/guilds";
import { createGuildForUser, listDirectoryGuilds, listUserGuilds } from "@/server/services/platform";
import { createRank, listRanks, updateRank } from "@/server/services/ranks";
import { updateGuildTabard } from "@/server/services/tabard";
import { createGuild, createMember, createTestDb, createVisitor, validApplication } from "../support/db";

let db: Db;
let close: () => Promise<void>;
let n = 0;

const limits = { perUser: 50, perDay: 50 };
const tabardForm = { background: "25", border: "14", borderStyle: "studded", emblemId: "193", emblemColor: "15", themeBase: "parchment" };
const ORDER_WORDS = /Order|Saint|Michael|Catholic|prayer|Pax|Deus|Chaplain|Postulant|Seneschal|Knight|Squire|Novice/;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

/** Founds a guild on the apex and returns it with an Actor for its Guild Master. */
async function found(extra: Record<string, string> = {}) {
  const i = ++n;
  const [user] = await db.insert(users).values({ name: `Founder ${i}`, discordId: `setup-founder-${i}` }).returning();
  const { guild } = await createGuildForUser(
    db,
    user!.id,
    { name: `Oathbound ${i}`, slug: `oathbound-${i}`, region: "us", faction: "horde", ruleset: "pvp", timezone: "America/New_York", motto: "", directoryListed: "on", ...extra },
    limits,
  );
  const [m] = await db.select().from(memberships).where(eq(memberships.guildId, guild.id));
  const actor = { guildId: guild.id, userId: user!.id, membershipId: m!.id, tier: "admin" as const };
  return { guild, actor };
}

/** An actor for a new user who is not in the guild yet. */
async function outsider(guildId: string) {
  return createVisitor(db, guildId);
}

const readGuild = async (id: string) => (await db.select().from(guilds).where(eq(guilds.id, id)))[0]!;

async function finishMinimumSteps(actor: Parameters<typeof publishGuild>[1]) {
  await updateGuildTabard(db, actor, tabardForm);
  await confirmRanks(db, actor);
  await updateContentPage(db, actor, { slug: "charter", title: "Guild Charter", bodyMd: "We raid twice a week and keep chat friendly." });
}

describe("new guilds", () => {
  it("start as unlisted drafts with neutral defaults and nothing of the Order", async () => {
    const { guild, actor } = await found();
    expect(guild.publishedAt).toBeNull();
    expect(guild.preset).toBe("standard");
    expect(guild.themeBase).not.toBe("order");

    const rankRows = await listRanks(db, guild.id);
    expect(rankRows.map((r) => r.name)).toEqual(RANK_PRESETS.raiding.ranks.map((r) => r.name));
    const orderNames = new Set(DEFAULT_RANKS.map((r) => r.name));
    for (const r of rankRows) {
      expect(orderNames.has(r.name)).toBe(false);
      expect(`${r.name} ${r.description}`).not.toMatch(ORDER_WORDS);
    }

    const pages = await db.select().from(contentPages).where(eq(contentPages.guildId, guild.id));
    expect(pages.map((p) => p.slug).sort()).toEqual(["charter", "loot-policy", "lore"]);
    for (const p of pages) expect(`${p.title} ${p.bodyMd}`).not.toMatch(ORDER_WORDS);
    expect(pages.find((p) => p.slug === "charter")!.bodyMd).toMatch(/reglamento de ejemplo/);

    const { summary, facts } = await getGuildSetup(db, actor);
    expect(facts).toMatchObject({ order: false, published: false, ranksMatchOrder: false, contentMatchesOrder: false, charterEdited: false });
    expect(summary.offerNeutralDefaults).toBe(false);
    expect(summary.canPublish).toBe(false);
  });

  it("stay out of the directory until published, but show in the founder's own guilds", async () => {
    const { guild, actor } = await found();
    const listed = async () => (await listDirectoryGuilds(db)).some((g) => g.slug === guild.slug);
    expect(await listed()).toBe(false);
    expect((await listUserGuilds(db, actor.userId)).find((g) => g.slug === guild.slug)?.publishedAt).toBeNull();

    await finishMinimumSteps(actor);
    await publishGuild(db, actor);
    expect(await listed()).toBe(true);

    await unpublishGuild(db, actor);
    expect(await listed()).toBe(false);
  });

  it("start from the rank preset chosen on the create form, falling back to Raiding", async () => {
    for (const key of ["social", "roleplay"] as const) {
      const { guild } = await found({ rankPreset: key });
      const names = (await listRanks(db, guild.id)).map((r) => r.name);
      expect(names).toEqual(RANK_PRESETS[key].ranks.map((r) => r.name));
      const applicant = (await listRanks(db, guild.id)).find((r) => r.id === guild.applicantRankId);
      expect(applicant?.name).toBe(RANK_PRESETS[key].applicantRank);
    }
    const { guild } = await found({ rankPreset: "order" });
    expect((await listRanks(db, guild.id)).map((r) => r.name)).toEqual(RANK_PRESETS.raiding.ranks.map((r) => r.name));
  });

  it("still hold their name for uniqueness while drafts", async () => {
    const { guild } = await found();
    const [other] = await db.insert(users).values({ name: "Copycat", discordId: `copycat-${++n}` }).returning();
    await expect(
      createGuildForUser(db, other!.id, { name: guild.name, slug: `copy-${n}`, region: "us", faction: "horde", ruleset: "pvp", timezone: "America/New_York" }, limits),
    ).rejects.toThrow(/Ya hay en Guildbook/);
  });
});

describe("applications to drafts", () => {
  it("are refused until the guild is published", async () => {
    const { guild, actor } = await found();
    const visitor = await outsider(guild.id);
    await expect(submitApplication(db, visitor, { ...validApplication, faction: "horde" })).rejects.toThrow(DRAFT_APPLICATIONS_CLOSED);

    await finishMinimumSteps(actor);
    await publishGuild(db, actor);
    await expect(submitApplication(db, visitor, { ...validApplication, faction: "horde" })).resolves.toMatchObject({ status: "pending" });
  });

  it("are accepted through the private invite link while a draft", async () => {
    const { guild, actor } = await found();
    const code = await ensureDraftInvite(db, actor);
    expect(await ensureDraftInvite(db, actor)).toBe(code);
    const visitor = await outsider(guild.id);
    await expect(submitApplication(db, visitor, { ...validApplication, faction: "horde", invite: "wrong" })).rejects.toThrow(DomainError);
    await expect(submitApplication(db, visitor, { ...validApplication, faction: "horde", invite: code })).resolves.toMatchObject({ status: "pending" });
  });
});

describe("publishing", () => {
  it("requires the tabard, reviewed ranks and an edited charter, and says what is missing", async () => {
    const { guild, actor } = await found();
    await expect(publishGuild(db, actor)).rejects.toThrow(/tabardo[\s\S]*rangos[\s\S]*reglamento/);

    await updateGuildTabard(db, actor, tabardForm);
    await expect(publishGuild(db, actor)).rejects.toThrow(/rangos/);
    await confirmRanks(db, actor);
    await expect(publishGuild(db, actor)).rejects.toThrow(/reglamento/);

    // Saving the starter text unchanged doesn't count as editing it.
    const [charter] = await db.select().from(contentPages).where(and(eq(contentPages.guildId, guild.id), eq(contentPages.slug, "charter")));
    await updateContentPage(db, actor, { slug: "charter", title: charter!.title, bodyMd: charter!.bodyMd });
    await expect(publishGuild(db, actor)).rejects.toThrow(/reglamento/);

    await updateContentPage(db, actor, { slug: "charter", title: "Guild Charter", bodyMd: "Our own rules." });
    await publishGuild(db, actor);
    expect((await readGuild(guild.id)).publishedAt).toBeInstanceOf(Date);

    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, guild.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["guild.publish", "rank.confirm"]));
  });

  it("counts an edited rank ladder as reviewed", async () => {
    const { actor } = await found();
    await createRank(db, actor, { name: "Oathseeker", tier: "member", inGame: "on" });
    const { summary } = await getGuildSetup(db, actor);
    expect(summary.steps.find((s) => s.key === "ranks")!.status).toBe("done");
  });

  it("lets admins return the guild to draft, audited, and only admins publish", async () => {
    const { guild, actor } = await found();
    await finishMinimumSteps(actor);
    await publishGuild(db, actor);
    const g = { guild, ranks: await listRanks(db, guild.id) };
    const officer = await createMember(db, g as never, "Oficial");
    await expect(unpublishGuild(db, officer)).rejects.toBeInstanceOf(AuthorizationError);

    await unpublishGuild(db, actor);
    expect((await readGuild(guild.id)).publishedAt).toBeNull();
    const [entry] = await db.select().from(auditLog).where(and(eq(auditLog.guildId, guild.id), eq(auditLog.action, "guild.unpublish")));
    expect(entry?.before).toMatchObject({ publishedAt: expect.any(String) });
  });
});

describe("setup checklist state", () => {
  it("skips steps, undoes skips, dismisses and reopens", async () => {
    const { guild, actor } = await found();
    await setSetupStepSkipped(db, actor, "lore", true);
    await setSetupStepSkipped(db, actor, "vigil", true);
    await setSetupStepSkipped(db, actor, "vigil", false);
    await expect(setSetupStepSkipped(db, actor, "publish", true)).rejects.toThrow(DomainError);
    await expect(setSetupStepSkipped(db, actor, "nonsense", true)).rejects.toThrow(DomainError);
    let { summary } = await getGuildSetup(db, actor);
    expect(summary.steps.find((s) => s.key === "lore")!.status).toBe("skipped");
    expect(summary.steps.find((s) => s.key === "vigil")!.status).toBe("todo");

    await setSetupDismissed(db, actor, true);
    ({ summary } = await getGuildSetup(db, actor));
    expect(summary.dismissed).toBe(true);
    await setSetupDismissed(db, actor, false);
    expect((await readGuild(guild.id)).setup.dismissedAt).toBeUndefined();
  });
});

describe("rank presets", () => {
  it("renames the ladder in place so members keep their rank row and tier", async () => {
    const { guild, actor } = await found();
    const g = { guild, ranks: await listRanks(db, guild.id) };
    const raider = await createMember(db, g as never, "Raider");
    const trial = await createMember(db, g as never, "A prueba");

    await applyRankPreset(db, actor, "roleplay");
    const after = await listRanks(db, guild.id);
    expect(after.map((r) => r.name)).toEqual(RANK_PRESETS.roleplay.ranks.map((r) => r.name));

    const tierOf = async (userId: string) => {
      const [row] = await db
        .select({ tier: ranks.tier, name: ranks.name })
        .from(memberships)
        .innerJoin(ranks, eq(ranks.id, memberships.rankId))
        .where(and(eq(memberships.guildId, guild.id), eq(memberships.userId, userId)));
      return row;
    };
    expect(await tierOf(raider.userId)).toEqual({ tier: "raider", name: "Veterano" });
    expect(await tierOf(trial.userId)).toEqual({ tier: "member", name: "Recluta" });
    expect(await tierOf(actor.userId)).toEqual({ tier: "admin", name: "Comandante" });
    const saved = await readGuild(guild.id);
    const nameOf = (id: string | null) => after.find((r) => r.id === id)?.name;
    expect([nameOf(saved.applicantRankId), nameOf(saved.acceptRankId), nameOf(saved.trialRankId)]).toEqual(["Peticionario", "Juramentado", "Recluta"]);
  });

  it("supports a custom seven-rank ladder like Oathbound's, up to the in-game limit", async () => {
    const { guild, actor } = await found();
    const custom = [
      ["Oathgiver", "admin"],
      ["Oathkeeper", "officer"],
      ["Warbringer", "officer"],
      ["Bloodsworn", "raider"],
      ["Sworn", "member"],
      ["Oathseeker", "member"],
      ["Kinbound", "member"],
    ] as const;
    // Rename the five starter in-game ranks, add the other two, then fill up to WoW's limit of ten.
    const starter = (await listRanks(db, guild.id)).filter((r) => r.inGame);
    for (const [i, [name, tier]] of custom.slice(0, starter.length).entries()) {
      await updateRank(db, actor, starter[i]!.id, { name, tier, inGame: "on" });
    }
    for (const [name, tier] of custom.slice(starter.length)) await createRank(db, actor, { name, tier, inGame: "on" });
    expect((await listRanks(db, guild.id)).filter((r) => r.inGame).map((r) => r.name)).toEqual(custom.map(([name]) => name));

    for (const name of ["Fifteen chars ok", "Ninth", "Tenth"].map((x) => x.slice(0, 15))) {
      await createRank(db, actor, { name, tier: "member", inGame: "on" });
    }
    await expect(createRank(db, actor, { name: "Eleventh", tier: "member", inGame: "on" })).rejects.toThrow(/como máximo 10/);
  });

  it("refuses to touch the Order", async () => {
    const order = await createGuild(db);
    const gm = await createMember(db, order, "Grand Master");
    await expect(applyRankPreset(db, gm, "raiding")).rejects.toThrow(/Order of Saint Michael/);
    await expect(applyNeutralDefaults(db, gm, "raiding")).rejects.toThrow(/Order of Saint Michael/);
    expect((await listRanks(db, order.guild.id)).map((r) => r.name)).toEqual(DEFAULT_RANKS.map((r) => r.name));
  });
});

/** A guild created before neutral defaults: the Order's ranks and pages on a standard guild. */
async function leakedGuild() {
  const g = await createGuild(db, { slug: `leaked-${++n}`, name: `Leaked ${n}` });
  await db.update(guilds).set({ preset: "standard", themeBase: "tome", tabardEmblemId: 128, publishedAt: new Date() }).where(eq(guilds.id, g.guild.id));
  for (const [slug, bodyMd] of Object.entries(CHARTER_CONTENT)) {
    await db.update(contentPages).set({ bodyMd }).where(and(eq(contentPages.guildId, g.guild.id), eq(contentPages.slug, slug)));
  }
  return g;
}

describe("neutral defaults for guilds that got the Order's preset", () => {
  it("detects the Order's ranks and pages and offers the reset", async () => {
    const g = await leakedGuild();
    const gm = await createMember(db, g, "Grand Master");
    const { facts, summary } = await getGuildSetup(db, gm);
    expect(facts).toMatchObject({ ranksMatchOrder: true, contentMatchesOrder: true });
    expect(summary.offerNeutralDefaults).toBe(true);
    await expect(confirmRanks(db, gm)).rejects.toThrow(/Order of Saint Michael/);
  });

  it("remaps every member by tier, never drops anyone, keeps edited pages and audits it", async () => {
    const g = await leakedGuild();
    const gm = await createMember(db, g, "Grand Master");
    const people = await Promise.all(
      ["Seneschal", "Marshal", "Chaplain", "Knight", "Sergeant", "Squire", "Novice"].map((rank) => createMember(db, g, rank)),
    );
    const applicant = await createMember(db, g, "Postulant", "applicant");
    await updateContentPage(db, gm, { slug: "loot-policy", title: "Loot Policy", bodyMd: "Our own loot rules." });
    const tiersBefore = new Map(
      (await db.select({ userId: memberships.userId, tier: ranks.tier }).from(memberships).innerJoin(ranks, eq(ranks.id, memberships.rankId)).where(eq(memberships.guildId, g.guild.id))).map((r) => [r.userId, r.tier]),
    );

    const result = await applyNeutralDefaults(db, gm, "social");
    expect(result).toMatchObject({ ranksReplaced: true, movedMembers: 3 });

    const rankRows = await listRanks(db, g.guild.id);
    expect(rankRows.map((r) => r.name)).toEqual(RANK_PRESETS.social.ranks.map((r) => r.name));

    const rows = await db
      .select({ userId: memberships.userId, status: memberships.status, tier: ranks.tier, rank: ranks.name })
      .from(memberships)
      .innerJoin(ranks, eq(ranks.id, memberships.rankId))
      .where(eq(memberships.guildId, g.guild.id));
    expect(rows).toHaveLength(people.length + 2);
    for (const r of rows) expect(r.tier).toBe(tiersBefore.get(r.userId));
    const rankOf = (userId: string) => rows.find((r) => r.userId === userId)!.rank;
    expect(rankOf(gm.userId)).toBe("Líder");
    expect(rankOf(people[0]!.userId)).toBe("Líder");
    expect(rankOf(people[2]!.userId)).toBe("Oficial");
    expect(rankOf(people[4]!.userId)).toBe("Veterano");
    expect(rankOf(people[6]!.userId)).toBe("Iniciado");
    expect(rankOf(applicant.userId)).toBe("Aspirante");
    expect(resolveTier({ status: "active", rankTier: rows.find((r) => r.userId === gm.userId)!.tier })).toBe("admin");

    const pages = await db.select().from(contentPages).where(eq(contentPages.guildId, g.guild.id)).orderBy(asc(contentPages.sortOrder));
    expect(pages.map((p) => p.slug).sort()).toEqual(["charter", "loot-policy", "lore"]);
    for (const p of pages.filter((p) => p.slug !== "loot-policy")) expect(`${p.title} ${p.bodyMd}`).not.toMatch(ORDER_WORDS);
    expect(pages.find((p) => p.slug === "loot-policy")!.bodyMd).toBe("Our own loot rules.");
    const revisions = await db.select({ bodyMd: contentRevisions.bodyMd }).from(contentRevisions).where(eq(contentRevisions.guildId, g.guild.id));
    expect(revisions.map((r) => r.bodyMd)).toEqual(expect.arrayContaining([CHARTER_CONTENT.charter, LORE_MD]));

    const actions = (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, g.guild.id))).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["guild.neutralDefaults", "rank.preset"]));

    const { summary } = await getGuildSetup(db, gm);
    expect(summary.offerNeutralDefaults).toBe(false);
    await expect(applyNeutralDefaults(db, gm, "social")).rejects.toThrow(/ya no tiene/);
  });

  it("leaves ranks alone once the guild has changed them, still replacing the Order's pages", async () => {
    const g = await leakedGuild();
    const gm = await createMember(db, g, "Grand Master");
    await db.update(ranks).set({ name: "Chieftain" }).where(and(eq(ranks.guildId, g.guild.id), eq(ranks.name, "Grand Master")));
    const result = await applyNeutralDefaults(db, gm, "raiding");
    expect(result.ranksReplaced).toBe(false);
    expect((await listRanks(db, g.guild.id))[0]!.name).toBe("Chieftain");
    expect(result.pagesReplaced).toBeGreaterThan(0);
  });

  it("is for admins only", async () => {
    const g = await leakedGuild();
    const officer = await createMember(db, g, "Marshal");
    await expect(applyNeutralDefaults(db, officer, "raiding")).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("migration 0016", () => {
  it("grandfathers existing guilds as published and hides the checklist for the Order", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "guildbook-migrations-"));
    try {
      cpSync("drizzle", dir, { recursive: true });
      const journalPath = path.join(dir, "meta", "_journal.json");
      const journal = JSON.parse(readFileSync(journalPath, "utf8"));
      const full = structuredClone(journal);
      journal.entries = journal.entries.slice(0, journal.entries.findIndex((e: { tag: string }) => e.tag === "0016_guild_onboarding"));
      writeFileSync(journalPath, JSON.stringify(journal));

      const client = new PGlite();
      const old = drizzle(client, { schema });
      await migrate(old, { migrationsFolder: dir });
      await old.execute(sql`insert into guilds (slug, name, faction, ruleset, preset) values ('old-standard', 'Old Standard', 'horde', 'normal', 'standard')`);
      await old.execute(sql`insert into guilds (slug, name, faction, ruleset, preset, theme_base) values ('old-order', 'Old Order', 'alliance', 'normal', 'order', 'order')`);

      writeFileSync(journalPath, JSON.stringify(full));
      await migrate(old, { migrationsFolder: dir });
      const rows = await old.select({ slug: guilds.slug, publishedAt: guilds.publishedAt, createdAt: guilds.createdAt, setup: guilds.setup }).from(guilds);
      const bySlug = Object.fromEntries(rows.map((r) => [r.slug, r]));
      expect(bySlug["old-standard"]!.publishedAt).toEqual(bySlug["old-standard"]!.createdAt);
      expect(bySlug["old-standard"]!.setup).toEqual({});
      expect(bySlug["old-order"]!.publishedAt).toBeInstanceOf(Date);
      expect(bySlug["old-order"]!.setup.dismissedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      await client.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
