import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import {
  accounts,
  applications,
  auditLog,
  battlenetLinks,
  characterProfessions,
  characters,
  guildDomains,
  guilds,
  memberships,
  ranks,
  supportTickets,
  users,
  vigilCompanionDevices,
  vigilPreferences,
  vigilReports,
} from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { fullName } from "@/lib/game";
import { DomainError, NotFoundError } from "@/server/errors";
import { exportLootFor, redactLootFor } from "@/server/services/loot";

/** Stands in for deleted users in audit history, so entries keep their shape but show "Deleted user". */
export const DELETED_USER_ID = "deleted-user";
export const TOMBSTONE = "Deleted user";

/** Payload keys that describe the person an entry is about; redacted on entries tied to a deleted user. */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(["characterName", "battletag", "discordHandle", "note"]);

export function accountDisplayName(user: { name: string | null; discordUsername: string | null }): string {
  return user.name ?? user.discordUsername ?? "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Replaces identity in an audit payload with the tombstone: values under identity keys when the entry is tied to
 * the user, and anywhere a string equals one of their known names (guild sync summaries list characters by name).
 */
export function redactPayload(value: unknown, identifiers: ReadonlySet<string>, linked: boolean, key?: string): unknown {
  if (typeof value === "string") {
    if ((linked && key && IDENTITY_KEYS.has(key)) || identifiers.has(value.trim().toLowerCase())) return TOMBSTONE;
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => redactPayload(v, identifiers, linked));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactPayload(v, identifiers, linked, k)]));
  }
  return value;
}

// --- Guild ownership --------------------------------------------------------------------------------------------

export interface GuildRole {
  guildId: string;
  slug: string;
  name: string;
  otherAdmins: number;
  otherMembers: number;
}

/** Guilds where the user is an active admin, with how many other active admins and members each has. */
async function adminGuilds(db: Db, userId: string): Promise<GuildRole[]> {
  const mine = await db
    .select({ guildId: guilds.id, slug: guilds.slug, name: guilds.name })
    .from(memberships)
    .innerJoin(guilds, eq(guilds.id, memberships.guildId))
    .innerJoin(ranks, and(eq(ranks.guildId, memberships.guildId), eq(ranks.id, memberships.rankId)))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active"), eq(ranks.tier, "admin")));
  if (mine.length === 0) return [];
  const counts = await db
    .select({
      guildId: memberships.guildId,
      admins: sql<number>`count(*) filter (where ${ranks.tier} = 'admin')::int`,
      members: sql<number>`count(*)::int`,
    })
    .from(memberships)
    .innerJoin(ranks, and(eq(ranks.guildId, memberships.guildId), eq(ranks.id, memberships.rankId)))
    .where(
      and(
        inArray(memberships.guildId, mine.map((g) => g.guildId)),
        eq(memberships.status, "active"),
        ne(memberships.userId, userId),
      ),
    )
    .groupBy(memberships.guildId);
  const byGuild = new Map(counts.map((c) => [c.guildId, c]));
  return mine.map((g) => ({
    ...g,
    otherAdmins: byGuild.get(g.guildId)?.admins ?? 0,
    otherMembers: byGuild.get(g.guildId)?.members ?? 0,
  }));
}

export interface DeletionPlan {
  /** Guilds that would be left without an admin; the user must hand over or delete them first. */
  blockers: GuildRole[];
  /** Guilds where the user is the only active member; they're deleted with the account. */
  soloGuilds: GuildRole[];
}

export async function planAccountDeletion(db: Db, userId: string): Promise<DeletionPlan> {
  const roles = await adminGuilds(db, userId);
  return {
    blockers: roles.filter((g) => g.otherAdmins === 0 && g.otherMembers > 0),
    soloGuilds: roles.filter((g) => g.otherMembers === 0),
  };
}

/** The account page: who the user is and the guilds they belong to or have applied to. */
export async function getAccountOverview(db: Db, userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, discordUsername: users.discordUsername, image: users.image, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;
  const [guildRows, [bnet], plan] = await Promise.all([
    db
      .select({ slug: guilds.slug, name: guilds.name, status: memberships.status, rankName: ranks.name, tier: ranks.tier })
      .from(memberships)
      .innerJoin(guilds, eq(guilds.id, memberships.guildId))
      .innerJoin(ranks, and(eq(ranks.guildId, memberships.guildId), eq(ranks.id, memberships.rankId)))
      .where(eq(memberships.userId, userId))
      .orderBy(guilds.name),
    db.select({ battletag: battlenetLinks.battletag }).from(battlenetLinks).where(eq(battlenetLinks.userId, userId)),
    planAccountDeletion(db, userId),
  ]);
  return { user, displayName: accountDisplayName(user), guilds: guildRows, battletag: bnet?.battletag ?? null, plan };
}

// --- Export -----------------------------------------------------------------------------------------------------

/** Everything stored about the user, for "Export my data". Secrets (encrypted tokens, device token hashes) are left out. */
export async function exportUserData(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.id === DELETED_USER_ID) throw new NotFoundError("Account");

  const [linkedAccounts, [bnet], memberRows, applicationRows, auditRows, ticketRows] = await Promise.all([
    db
      .select({ provider: accounts.provider, providerAccountId: accounts.providerAccountId, scope: accounts.scope })
      .from(accounts)
      .where(eq(accounts.userId, userId)),
    db
      .select({
        battletag: battlenetLinks.battletag,
        region: battlenetLinks.region,
        linkedAt: battlenetLinks.linkedAt,
        snapshotAt: battlenetLinks.snapshotAt,
        characters: battlenetLinks.characters,
      })
      .from(battlenetLinks)
      .where(eq(battlenetLinks.userId, userId)),
    db
      .select({ membership: memberships, guildSlug: guilds.slug, guildName: guilds.name, rankName: ranks.name })
      .from(memberships)
      .innerJoin(guilds, eq(guilds.id, memberships.guildId))
      .innerJoin(ranks, and(eq(ranks.guildId, memberships.guildId), eq(ranks.id, memberships.rankId)))
      .where(eq(memberships.userId, userId)),
    db
      .select({ application: applications, guildSlug: guilds.slug })
      .from(applications)
      .innerJoin(guilds, eq(guilds.id, applications.guildId))
      .where(eq(applications.userId, userId)),
    db
      .select({
        guildSlug: guilds.slug,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        before: auditLog.before,
        after: auditLog.after,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .innerJoin(guilds, eq(guilds.id, auditLog.guildId))
      .where(eq(auditLog.actorUserId, userId))
      .orderBy(auditLog.createdAt),
    db.select().from(supportTickets).where(eq(supportTickets.userId, userId)).orderBy(supportTickets.createdAt),
  ]);

  const membershipIds = memberRows.map((m) => m.membership.id);
  const [characterRows, professionRows, reportRows, preferenceRows, deviceRows] = membershipIds.length
    ? await Promise.all([
        db.select().from(characters).where(inArray(characters.membershipId, membershipIds)),
        db
          .select({ characterId: characterProfessions.characterId, profession: characterProfessions.profession, skill: characterProfessions.skill })
          .from(characterProfessions)
          .innerJoin(characters, eq(characters.id, characterProfessions.characterId))
          .where(inArray(characters.membershipId, membershipIds)),
        db.select().from(vigilReports).where(inArray(vigilReports.membershipId, membershipIds)),
        db.select().from(vigilPreferences).where(inArray(vigilPreferences.membershipId, membershipIds)),
        db
          .select({
            id: vigilCompanionDevices.id,
            guildId: vigilCompanionDevices.guildId,
            name: vigilCompanionDevices.name,
            createdAt: vigilCompanionDevices.createdAt,
            lastUsedAt: vigilCompanionDevices.lastUsedAt,
            revokedAt: vigilCompanionDevices.revokedAt,
          })
          .from(vigilCompanionDevices)
          .where(inArray(vigilCompanionDevices.membershipId, membershipIds)),
      ])
    : [[], [], [], [], []];
  const lootRows = await exportLootFor(db, characterRows.map((c) => c.id));

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      discordId: user.discordId,
      discordUsername: user.discordUsername,
      createdAt: user.createdAt,
    },
    linkedAccounts,
    battlenet: bnet ?? null,
    memberships: memberRows.map((m) => ({ ...m.membership, guildSlug: m.guildSlug, guildName: m.guildName, rankName: m.rankName })),
    characters: characterRows.map((c) => ({ ...c, professions: professionRows.filter((p) => p.characterId === c.id) })),
    applications: applicationRows.map((a) => ({ ...a.application, guildSlug: a.guildSlug })),
    vigilReports: reportRows,
    vigilPreferences: preferenceRows,
    companionDevices: deviceRows,
    lootReceived: lootRows,
    auditEntriesByYou: auditRows,
    supportRequests: ticketRows,
  };
}

// --- Deletion ---------------------------------------------------------------------------------------------------

/** Deletes a guild with everything in it, including its audit history (the only path allowed to delete audit rows). */
async function purgeGuild(tx: Db, guildId: string): Promise<string[]> {
  const domains = await tx.select({ domain: guildDomains.domain }).from(guildDomains).where(eq(guildDomains.guildId, guildId));
  await tx.execute(sql`select set_config('guildbook.audit_purge_guild', ${guildId}, true)`);
  // Memberships reference ranks with RESTRICT, so they go before the cascade from the guild row.
  await tx.delete(memberships).where(eq(memberships.guildId, guildId));
  await tx.delete(guilds).where(eq(guilds.id, guildId));
  await tx.execute(sql`select set_config('guildbook.audit_purge_guild', '', true)`);
  return domains.map((d) => d.domain);
}

export interface DeletionResult {
  deletedGuilds: string[];
  /** Custom domains of deleted guilds, to remove from the hosting provider after commit. */
  releasedDomains: string[];
}

/**
 * Deletes the user and everything that is theirs: Discord accounts, Battle.net link and token, memberships,
 * characters, Vigil reports, companion devices, applications and support tickets. Audit entries stay, but their actor and
 * identity fields become "Deleted user". Guilds where they're the only member are deleted too.
 */
export async function deleteUserAccount(db: Db, userId: string, confirmName: string): Promise<DeletionResult> {
  if (userId === DELETED_USER_ID) throw new DomainError("Esta cuenta no se puede borrar.");
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!user) throw new NotFoundError("Account");
    const display = accountDisplayName(user);
    if (!display || !sameName(confirmName, display)) throw new DomainError(`Escribe ${display} exactamente para confirmar.`);

    const plan = await planAccountDeletion(tx, userId);
    if (plan.blockers.length > 0) {
      const names = plan.blockers.map((g) => g.name).join(", ");
      throw new DomainError(
        `Eres el único administrador de ${names}. Asciende a otro miembro a un rango de administrador, o borra la hermandad, antes de borrar tu cuenta.`,
      );
    }

    const releasedDomains: string[] = [];
    for (const g of plan.soloGuilds) releasedDomains.push(...(await purgeGuild(tx, g.guildId)));

    const memberRows = await tx.select({ id: memberships.id, guildId: memberships.guildId }).from(memberships).where(eq(memberships.userId, userId));
    const membershipIds = memberRows.map((m) => m.id);
    const characterRows = membershipIds.length
      ? await tx
          .select({ id: characters.id, name: characters.name, surname: characters.surname })
          .from(characters)
          .where(inArray(characters.membershipId, membershipIds))
      : [];
    const applicationRows = await tx
      .select({
        id: applications.id,
        guildId: applications.guildId,
        name: applications.characterName,
        surname: applications.characterSurname,
        discordHandle: applications.discordHandle,
        battletag: applications.battletag,
      })
      .from(applications)
      .where(eq(applications.userId, userId));
    const [bnet] = await tx.select({ battletag: battlenetLinks.battletag }).from(battlenetLinks).where(eq(battlenetLinks.userId, userId));

    const identifiers = new Set(
      [
        user.name,
        user.discordUsername,
        user.email,
        bnet?.battletag,
        ...characterRows.map((c) => fullName(c.name, c.surname)),
        ...applicationRows.flatMap((a) => [fullName(a.name, a.surname), a.discordHandle, a.battletag]),
      ]
        .filter((v): v is string => typeof v === "string" && v.trim().length >= 3)
        .map((v) => v.trim().toLowerCase()),
    );
    const linkedIds = new Set([userId, ...membershipIds, ...characterRows.map((c) => c.id), ...applicationRows.map((a) => a.id)]);
    const guildIds = [...new Set([...memberRows.map((m) => m.guildId), ...applicationRows.map((a) => a.guildId)])];

    await redactAuditFor(tx, { userId, identifiers, linkedIds, guildIds });
    await redactLootFor(tx, { characterIds: characterRows.map((c) => c.id), identifiers, guildIds });

    // Cascades to accounts, sessions, the Battle.net link, memberships (characters, Vigil reports and preferences,
    // companion pairings and devices) and applications. Other users' references to this user are set to null.
    await tx.delete(users).where(eq(users.id, userId));
    return { deletedGuilds: plan.soloGuilds.map((g) => g.slug), releasedDomains };
  });
}

async function ensureDeletedUser(tx: Db) {
  await tx.insert(users).values({ id: DELETED_USER_ID, name: TOMBSTONE }).onConflictDoNothing();
}

/** Rewrites audit entries tied to a user under the database's redaction guard (see drizzle/0010_privacy.sql). */
export async function redactAuditFor(
  tx: Db,
  target: { userId?: string; identifiers: ReadonlySet<string>; linkedIds: ReadonlySet<string>; guildIds: readonly string[] },
) {
  const { userId, identifiers, linkedIds, guildIds } = target;
  const conditions = [];
  if (userId) conditions.push(eq(auditLog.actorUserId, userId));
  if (linkedIds.size) conditions.push(inArray(auditLog.targetId, [...linkedIds]));
  if (guildIds.length && identifiers.size) conditions.push(inArray(auditLog.guildId, [...guildIds]));
  if (conditions.length === 0) return 0;

  const rows = await tx.select().from(auditLog).where(or(...conditions));
  if (userId) await ensureDeletedUser(tx);
  await tx.execute(sql`select set_config('guildbook.audit_redact', 'on', true)`);
  let changed = 0;
  for (const row of rows) {
    const byUser = Boolean(userId && row.actorUserId === userId);
    const linked = byUser || (row.targetId !== null && linkedIds.has(row.targetId));
    const next = {
      actorUserId: byUser ? DELETED_USER_ID : row.actorUserId,
      targetId: userId && row.targetId === userId ? DELETED_USER_ID : row.targetId,
      before: redactPayload(row.before, identifiers, linked),
      after: redactPayload(row.after, identifiers, linked),
    };
    const same =
      next.actorUserId === row.actorUserId &&
      next.targetId === row.targetId &&
      JSON.stringify(next.before) === JSON.stringify(row.before) &&
      JSON.stringify(next.after) === JSON.stringify(row.after);
    if (same) continue;
    await tx.update(auditLog).set(next).where(eq(auditLog.id, row.id));
    changed++;
  }
  await tx.execute(sql`select set_config('guildbook.audit_redact', '', true)`);
  return changed;
}

// --- Guild deletion ---------------------------------------------------------------------------------------------

/** Whether the actor may delete the guild: an admin, and its creator when the creator is still around. */
export async function canDeleteGuild(db: Db, actor: Actor): Promise<boolean> {
  if (actor.tier !== "admin" || !actor.userId) return false;
  const [guild] = await db.select({ createdBy: guilds.createdByUserId }).from(guilds).where(eq(guilds.id, actor.guildId));
  if (!guild) return false;
  return guild.createdBy === null || guild.createdBy === DELETED_USER_ID || guild.createdBy === actor.userId;
}

export async function deleteGuild(
  db: Db,
  actor: Actor,
  confirmName: string,
  opts: { protectedSlug?: string } = {},
): Promise<{ slug: string; releasedDomains: string[] }> {
  assertCan(actor, "guild.settings");
  if (!(await canDeleteGuild(db, actor))) throw new DomainError("Solo el propietario de la hermandad puede borrarla.");
  return db.transaction(async (tx) => {
    const [guild] = await tx.select().from(guilds).where(eq(guilds.id, actor.guildId)).for("update");
    if (!guild) throw new NotFoundError("Guild");
    if (opts.protectedSlug && guild.slug === opts.protectedSlug) {
      throw new DomainError("Esta es la hermandad predeterminada del sitio y no se puede borrar desde aquí.");
    }
    if (!sameName(confirmName, guild.name)) throw new DomainError(`Escribe ${guild.name} exactamente para confirmar.`);
    const releasedDomains = await purgeGuild(tx, guild.id);
    return { slug: guild.slug, releasedDomains };
  });
}

// --- Retention --------------------------------------------------------------------------------------------------

export function applicationRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const days = Number.parseInt(env.APPLICATION_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(days) && days > 0 ? days : 180;
}

/**
 * Deletes withdrawn and declined applications decided (or, if never reviewed, submitted) more than `days` ago,
 * and redacts the applicant's name from those applications' audit entries.
 */
export async function purgeStaleApplications(db: Db, days = applicationRetentionDays(), now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  return db.transaction(async (tx) => {
    const stale = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          inArray(applications.status, ["withdrawn", "declined"]),
          sql`coalesce(${applications.reviewedAt}, ${applications.createdAt}) < ${cutoff}`,
        ),
      );
    if (stale.length === 0) return { deleted: 0, cutoff };
    await redactAuditFor(tx, {
      identifiers: new Set(),
      linkedIds: new Set(stale.map((a) => a.id)),
      guildIds: [],
    });
    await tx.delete(applications).where(inArray(applications.id, stale.map((a) => a.id)));
    return { deleted: stale.length, cutoff };
  });
}
