import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { CHARTER_CONTENT } from "@/db/order";
import {
  applications,
  auditLog,
  contentPages,
  contentRevisions,
  guilds,
  type GuildSetupState,
  memberships,
  ranks,
  recruitmentNeeds,
  vigilCompanionDevices,
  vigilReports,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { computeSetup, isSetupStepKey, type SetupFacts } from "@/lib/guild-setup";
import { LORE_MD, LORE_SLUG } from "@/lib/lore";
import { isRankPresetKey, RANK_PRESETS, type RankPresetKey } from "@/lib/rank-presets";
import { recordAudit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import {
  DEFAULT_CONTENT_PAGES,
  DEFAULT_RANKS,
  STANDARD_CHARTER_MD,
  STANDARD_CONTENT_PAGES,
  STANDARD_STORY_MD,
  starterBody,
} from "@/server/services/guilds";
import { listRanks } from "@/server/services/ranks";

type GuildRow = typeof guilds.$inferSelect;
type PageRow = typeof contentPages.$inferSelect;

const RANK_EDIT_ACTIONS = ["rank.create", "rank.update", "rank.delete", "rank.reorder", "rank.defaults", "rank.preset"];
const RECRUITING_ACTIONS = ["recruitment.set", "recruitment.toggle"];

/** Whether a rank ladder (in rank order) is the Order of Saint Michael's, name and tier for each rank. */
export function matchesOrderRanks(rows: { name: string; tier: string }[]): boolean {
  return rows.length === DEFAULT_RANKS.length && rows.every((r, i) => r.name === DEFAULT_RANKS[i]!.name && r.tier === DEFAULT_RANKS[i]!.tier);
}

const ORDER_BODIES: Record<string, string> = { ...CHARTER_CONTENT, [LORE_SLUG]: LORE_MD };

/** Pages still exactly as the Order's preset left them: its titles, with its text or never written. */
export function orderLeftoverPages<P extends Pick<PageRow, "slug" | "title" | "bodyMd" | "updatedByUserId">>(pages: P[]): P[] {
  return pages.filter((p) => {
    const template = DEFAULT_CONTENT_PAGES.find((d) => d.slug === p.slug);
    if (!template || template.title !== p.title) return false;
    const body = p.bodyMd.trim();
    return body === (ORDER_BODIES[p.slug] ?? "").trim() || (body === "" && !p.updatedByUserId);
  });
}

function pageEdited(page: PageRow | undefined, starter: string, guildName: string): boolean {
  if (!page?.updatedByUserId) return false;
  const body = page.bodyMd.trim();
  return body !== "" && body !== starterBody(starter, guildName).trim();
}

async function exists(query: Promise<{ n: number }[]>): Promise<boolean> {
  const [row] = await query;
  return (row?.n ?? 0) > 0;
}

export async function loadSetupFacts(db: Db, guild: GuildRow): Promise<SetupFacts> {
  const auditCount = (actions: string[]) =>
    db
      .select({ n: count() })
      .from(auditLog)
      .where(and(eq(auditLog.guildId, guild.id), inArray(auditLog.action, actions)));
  const [rankRows, pages, lookSaved, ranksEdited, recruitingAudited, needs, [active], [pending], devices, reports] = await Promise.all([
    listRanks(db, guild.id),
    db.select().from(contentPages).where(eq(contentPages.guildId, guild.id)),
    exists(auditCount(["guild.tabard"])),
    exists(auditCount(RANK_EDIT_ACTIONS)),
    exists(auditCount(RECRUITING_ACTIONS)),
    exists(db.select({ n: count() }).from(recruitmentNeeds).where(eq(recruitmentNeeds.guildId, guild.id))),
    db.select({ n: count() }).from(memberships).where(and(eq(memberships.guildId, guild.id), eq(memberships.status, "active"))),
    db.select({ n: count() }).from(applications).where(and(eq(applications.guildId, guild.id), eq(applications.status, "pending"))),
    exists(db.select({ n: count() }).from(vigilCompanionDevices).where(eq(vigilCompanionDevices.guildId, guild.id))),
    exists(db.select({ n: count() }).from(vigilReports).where(eq(vigilReports.guildId, guild.id))),
  ]);
  return {
    order: guild.preset === "order",
    published: guild.publishedAt !== null,
    lookSaved,
    ranksEdited,
    ranksMatchOrder: matchesOrderRanks(rankRows),
    contentMatchesOrder: orderLeftoverPages(pages).length > 0,
    charterEdited: pageEdited(pages.find((p) => p.slug === "charter"), STANDARD_CHARTER_MD, guild.name),
    loreEdited: pageEdited(pages.find((p) => p.slug === LORE_SLUG), STANDARD_STORY_MD, guild.name),
    recruitingSet: recruitingAudited || needs,
    activeMembers: active?.n ?? 0,
    pendingApplications: pending?.n ?? 0,
    discordInvite: Boolean(guild.discordInviteUrl),
    verified: guild.verifiedAt !== null,
    vigilUsed: devices || reports,
  };
}

async function loadGuild(db: Db, guildId: string): Promise<GuildRow> {
  const [guild] = await db.select().from(guilds).where(eq(guilds.id, guildId));
  if (!guild) throw new NotFoundError("Guild");
  return guild;
}

export async function getGuildSetup(db: Db, actor: Actor) {
  assertCan(actor, "admin.area");
  const guild = await loadGuild(db, actor.guildId);
  const facts = await loadSetupFacts(db, guild);
  return { guild, facts, summary: computeSetup(facts, guild.setup) };
}

async function saveSetupState(tx: Db, guild: GuildRow, next: GuildSetupState) {
  await tx.update(guilds).set({ setup: next }).where(eq(guilds.id, guild.id));
}

export async function setSetupStepSkipped(db: Db, actor: Actor, step: unknown, skipped: boolean) {
  assertCan(actor, "guild.settings");
  if (!isSetupStepKey(step) || step === "publish") throw new DomainError("Paso de configuración desconocido.");
  await db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    const current = new Set(guild.setup.skipped ?? []);
    if (skipped) current.add(step);
    else current.delete(step);
    await saveSetupState(tx, guild, { ...guild.setup, skipped: [...current] });
  });
}

export async function setSetupDismissed(db: Db, actor: Actor, dismissed: boolean) {
  assertCan(actor, "guild.settings");
  await db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    const { dismissedAt: _dismissedAt, ...rest } = guild.setup;
    await saveSetupState(tx, guild, dismissed ? { ...rest, dismissedAt: new Date().toISOString() } : rest);
  });
}

/** The private invite code for applying while the guild is a draft, created on first use. */
export async function ensureDraftInvite(db: Db, actor: Actor): Promise<string> {
  assertCan(actor, "guild.settings");
  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    if (guild.setup.inviteCode) return guild.setup.inviteCode;
    const inviteCode = randomBytes(9).toString("base64url");
    await saveSetupState(tx, guild, { ...guild.setup, inviteCode });
    await recordAudit(tx, actor, { action: "guild.invite.create", targetType: "guild", targetId: guild.id });
    return inviteCode;
  });
}

/** Marks the current rank ladder as reviewed without changing it. The Order's ladder must be replaced or edited first. */
export async function confirmRanks(db: Db, actor: Actor) {
  assertCan(actor, "rank.manage");
  await db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    if (guild.preset !== "order" && matchesOrderRanks(await listRanks(tx, guild.id))) {
      throw new DomainError("Estos son los rangos de la Order of Saint Michael. Usa los predeterminados neutros o edítalos primero.");
    }
    await saveSetupState(tx, guild, { ...guild.setup, ranksConfirmedAt: new Date().toISOString() });
    await recordAudit(tx, actor, { action: "rank.confirm", targetType: "guild", targetId: guild.id });
  });
}

/**
 * Replaces a guild's rank ladder with a preset without dropping anyone. Existing ranks are matched to the preset's
 * by permission tier, in rank order, and renamed in place, so every member keeps their rank row and their tier.
 * Ranks left over once a tier's preset ranks are used up move their members to the last preset rank of that tier
 * and are deleted. Missing preset ranks are added. Call inside a transaction.
 */
export async function replaceRankLadder(tx: Db, guildId: string, key: RankPresetKey) {
  const preset = RANK_PRESETS[key];
  const existing = await listRanks(tx, guildId);
  const pools = new Map<string, typeof existing>();
  for (const r of existing) pools.set(r.tier, [...(pools.get(r.tier) ?? []), r]);

  const assignments = preset.ranks.map((template, i) => ({ template, sortOrder: i + 1, row: pools.get(template.tier)?.shift() }));
  const leftovers = [...pools.values()].flat();

  // Park every rank on a unique temporary name and slot so the (guild, name) and (guild, sort) keys hold throughout.
  for (const [i, r] of existing.entries()) {
    await tx.update(ranks).set({ name: `~${r.id}`, sortOrder: -(i + 1) }).where(eq(ranks.id, r.id));
  }

  const idByName = new Map<string, string>();
  const lastIdByTier = new Map<string, string>();
  for (const { template, sortOrder, row } of assignments) {
    const values = { name: template.name, description: template.description, insignia: template.insignia, inGame: template.inGame, sortOrder };
    let id: string;
    if (row) {
      await tx.update(ranks).set(values).where(eq(ranks.id, row.id));
      id = row.id;
    } else {
      const [inserted] = await tx.insert(ranks).values({ ...values, guildId, tier: template.tier }).returning({ id: ranks.id });
      id = inserted!.id;
    }
    idByName.set(template.name, id);
    lastIdByTier.set(template.tier, id);
  }

  await tx
    .update(guilds)
    .set({
      applicantRankId: idByName.get(preset.applicantRank)!,
      acceptRankId: idByName.get(preset.acceptRank)!,
      trialRankId: idByName.get(preset.trialRank)!,
    })
    .where(eq(guilds.id, guildId));

  let movedMembers = 0;
  for (const r of leftovers) {
    const target = lastIdByTier.get(r.tier)!;
    const moved = await tx
      .update(memberships)
      .set({ rankId: target, updatedAt: new Date() })
      .where(and(eq(memberships.guildId, guildId), eq(memberships.rankId, r.id)))
      .returning({ id: memberships.id });
    movedMembers += moved.length;
    await tx.delete(ranks).where(eq(ranks.id, r.id));
  }

  return {
    before: existing.map((r) => r.name),
    after: preset.ranks.map((r) => r.name),
    movedMembers,
  };
}

function assertNotOrder(guild: GuildRow) {
  if (guild.preset === "order") throw new DomainError("La Order of Saint Michael conserva sus propios rangos y páginas.");
}

export async function applyRankPreset(db: Db, actor: Actor, key: unknown) {
  assertCan(actor, "rank.manage");
  if (!isRankPresetKey(key)) throw new DomainError("Elige una plantilla de rangos.");
  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    assertNotOrder(guild);
    const result = await replaceRankLadder(tx, guild.id, key);
    await recordAudit(tx, actor, {
      action: "rank.preset",
      targetType: "guild",
      targetId: guild.id,
      before: { ranks: result.before },
      after: { preset: key, ranks: result.after, movedMembers: result.movedMembers },
    });
    return { preset: RANK_PRESETS[key].label, movedMembers: result.movedMembers };
  });
}

/** Swaps the Order's unedited pages for the starter pages. Pages anyone has rewritten are left alone. */
async function replaceOrderPages(tx: Db, actor: Actor, guild: GuildRow) {
  const pages = await tx.select().from(contentPages).where(eq(contentPages.guildId, guild.id));
  const leftovers = orderLeftoverPages(pages);
  const replaced: string[] = [];
  for (const page of leftovers) {
    const starter = STANDARD_CONTENT_PAGES.find((s) => s.slug === page.slug);
    await tx.insert(contentRevisions).values({
      guildId: guild.id,
      pageId: page.id,
      title: page.title,
      bodyMd: page.bodyMd,
      editedByUserId: actor.userId,
    });
    if (starter) {
      await tx
        .update(contentPages)
        .set({ title: starter.title, bodyMd: starterBody(starter.bodyMd, guild.name), sortOrder: starter.sortOrder, updatedByUserId: null, updatedAt: new Date() })
        .where(eq(contentPages.id, page.id));
    } else {
      await tx.delete(contentPages).where(eq(contentPages.id, page.id));
    }
    replaced.push(page.slug);
  }
  const remaining = new Set(pages.map((p) => p.slug));
  const missing = STANDARD_CONTENT_PAGES.filter((s) => !remaining.has(s.slug));
  if (missing.length > 0) {
    await tx.insert(contentPages).values(missing.map((s) => ({ ...s, guildId: guild.id, bodyMd: starterBody(s.bodyMd, guild.name) })));
  }
  return { replaced, added: missing.map((s) => s.slug) };
}

/**
 * For guilds created before neutral defaults that still carry the Order's ranks or pages: replaces the Order's
 * rank ladder with a preset (members keep their permission tier) and its unedited pages with the starter pages.
 */
export async function applyNeutralDefaults(db: Db, actor: Actor, key: unknown) {
  assertCan(actor, "guild.settings");
  assertCan(actor, "rank.manage");
  const presetKey = isRankPresetKey(key) ? key : null;
  if (!presetKey) throw new DomainError("Elige una plantilla de rangos.");
  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    assertNotOrder(guild);
    const rankRows = await listRanks(tx, guild.id);
    const ranksResult = matchesOrderRanks(rankRows) ? await replaceRankLadder(tx, guild.id, presetKey) : null;
    const pagesResult = await replaceOrderPages(tx, actor, guild);
    if (!ranksResult && pagesResult.replaced.length === 0 && pagesResult.added.length === 0) {
      throw new DomainError("Esta hermandad ya no tiene rangos ni páginas de la Orden que sustituir.");
    }
    if (ranksResult) {
      await recordAudit(tx, actor, {
        action: "rank.preset",
        targetType: "guild",
        targetId: guild.id,
        before: { ranks: ranksResult.before },
        after: { preset: presetKey, ranks: ranksResult.after, movedMembers: ranksResult.movedMembers },
      });
    }
    await recordAudit(tx, actor, {
      action: "guild.neutralDefaults",
      targetType: "guild",
      targetId: guild.id,
      before: { ranks: rankRows.map((r) => r.name) },
      after: { preset: ranksResult ? presetKey : null, pagesReplaced: pagesResult.replaced, pagesAdded: pagesResult.added },
    });
    return { ranksReplaced: Boolean(ranksResult), movedMembers: ranksResult?.movedMembers ?? 0, pagesReplaced: pagesResult.replaced.length };
  });
}

export async function publishGuild(db: Db, actor: Actor) {
  assertCan(actor, "guild.settings");
  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    if (guild.publishedAt) return { alreadyPublished: true };
    const summary = computeSetup(await loadSetupFacts(tx, guild), guild.setup);
    if (!summary.canPublish) throw new DomainError(`Aún no se puede publicar. ${summary.publishMissing.join(" ")}`);
    await tx.update(guilds).set({ publishedAt: new Date() }).where(and(eq(guilds.id, guild.id), isNull(guilds.publishedAt)));
    await recordAudit(tx, actor, { action: "guild.publish", targetType: "guild", targetId: guild.id });
    return { alreadyPublished: false };
  });
}

export async function unpublishGuild(db: Db, actor: Actor) {
  assertCan(actor, "guild.settings");
  await db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    if (!guild.publishedAt) return;
    await tx.update(guilds).set({ publishedAt: null }).where(eq(guilds.id, guild.id));
    await recordAudit(tx, actor, {
      action: "guild.unpublish",
      targetType: "guild",
      targetId: guild.id,
      before: { publishedAt: guild.publishedAt.toISOString() },
    });
  });
}
