import { and, asc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { characters, groupEvents, groupSignups, memberships, ranks, users } from "@/db/schema";
import { type Actor, AuthorizationError, assertCan, can, resolveTier } from "@/lib/authz/policy";
import { fullName } from "@/lib/game";
import { ACTIVE_GROUP_STATUSES, buildRoster, canPlayRole, GROUP_ROLE_LABELS, type GroupRole, type GroupStatus } from "@/lib/groups";
import { groupCreateInput, groupSignupInput, groupTargetInput, groupUpdateInput } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";

/**
 * Raids, dungeon runs and quick calls organised from Discord. The bot acts for the Discord user who pressed the
 * button: the site finds that person (users.discord_id), reads their tier from the database and applies its own
 * rules, so who may do what stays decided here. The bot itself (no person behind it) may only record the Discord
 * message, mark a reminder as sent and finish a group that is over.
 */

/** How long after starting a scheduled group counts as over. */
export const FINISH_AFTER_MS = 5 * 3_600_000;

export type DiscordActor = Actor & { userId: string; discordId: string };

/** The site user and membership behind a Discord account, or an error the bot can show as is. */
export async function actorForDiscord(db: Db, guildId: string, discordId: string): Promise<DiscordActor> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, discordId));
  if (!user) {
    throw new AuthorizationError("Primero entra en la web de la hermandad con tu cuenta de Discord y añade tus personajes.", "unauthenticated");
  }
  const [row] = await db
    .select({ id: memberships.id, status: memberships.status, rankTier: ranks.tier })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(and(eq(memberships.guildId, guildId), eq(memberships.userId, user.id)));
  const tier = resolveTier(row ? { status: row.status, rankTier: row.rankTier } : null);
  return { guildId, userId: user.id, discordId, membershipId: row?.status === "active" ? row.id : null, tier };
}

export interface GroupSignupView {
  userId: string;
  discordId: string | null;
  characterId: string;
  characterName: string;
  wowClass: (typeof characters.$inferSelect)["wowClass"];
  level: number;
  role: GroupRole;
  bench: boolean;
  queuedAt: Date;
}

export type GroupView = typeof groupEvents.$inferSelect & {
  leader: { userId: string; discordId: string | null; name: string | null } | null;
  signups: GroupSignupView[];
};

async function loadViews(db: Db, events: (typeof groupEvents.$inferSelect)[]): Promise<GroupView[]> {
  if (events.length === 0) return [];
  const ids = events.map((e) => e.id);
  const signupRows = await db
    .select({
      eventId: groupSignups.eventId,
      userId: groupSignups.userId,
      discordId: users.discordId,
      characterId: groupSignups.characterId,
      name: characters.name,
      surname: characters.surname,
      wowClass: characters.wowClass,
      level: characters.level,
      role: groupSignups.role,
      bench: groupSignups.bench,
      queuedAt: groupSignups.queuedAt,
    })
    .from(groupSignups)
    .innerJoin(characters, eq(characters.id, groupSignups.characterId))
    .innerJoin(users, eq(users.id, groupSignups.userId))
    .where(inArray(groupSignups.eventId, ids))
    .orderBy(asc(groupSignups.queuedAt));
  const leaderIds = [...new Set(events.map((e) => e.leaderUserId).filter((id): id is string => Boolean(id)))];
  const leaders = leaderIds.length
    ? await db.select({ id: users.id, discordId: users.discordId, name: users.name }).from(users).where(inArray(users.id, leaderIds))
    : [];
  return events.map((event) => {
    const leader = leaders.find((l) => l.id === event.leaderUserId);
    return {
      ...event,
      leader: leader ? { userId: leader.id, discordId: leader.discordId, name: leader.name } : null,
      signups: signupRows
        .filter((s) => s.eventId === event.id)
        .map(({ eventId: _eventId, name, surname, ...s }) => ({ ...s, characterName: fullName(name, surname) })),
    };
  });
}

async function loadEvent(db: Db, guildId: string, id: string) {
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Group");
  const [event] = await db.select().from(groupEvents).where(and(eq(groupEvents.guildId, guildId), eq(groupEvents.id, id)));
  if (!event) throw new NotFoundError("Group");
  return event;
}

export async function getGroup(db: Db, guildId: string, id: string): Promise<GroupView> {
  const [view] = await loadViews(db, [await loadEvent(db, guildId, id)]);
  return view!;
}

/** Groups still coming up (or a quick call still running), soonest first. */
export async function listActiveGroups(db: Db, guildId: string, now: Date = new Date()): Promise<GroupView[]> {
  const events = await db
    .select()
    .from(groupEvents)
    .where(
      and(
        eq(groupEvents.guildId, guildId),
        inArray(groupEvents.status, [...ACTIVE_GROUP_STATUSES]),
        or(gt(groupEvents.startsAt, new Date(now.getTime() - FINISH_AFTER_MS)), gt(groupEvents.expiresAt, now)),
      ),
    )
    .orderBy(asc(groupEvents.startsAt));
  return loadViews(db, events);
}

/** For the members area. */
export async function listUpcomingGroups(db: Db, actor: Actor, now: Date = new Date()) {
  assertCan(actor, "member.area");
  return listActiveGroups(db, actor.guildId, now);
}

export function rosterOf(view: GroupView) {
  return buildRoster(view.signups, { tank: view.tanks, healer: view.healers, dps: view.dps });
}

const isManager = (actor: Actor, event: typeof groupEvents.$inferSelect) => actor.userId === event.leaderUserId || can(actor, "group.manage");

export async function createGroup(db: Db, actor: DiscordActor, raw: unknown): Promise<GroupView> {
  assertCan(actor, "group.create");
  const input = groupCreateInput.parse(raw);
  const [event] = await db
    .insert(groupEvents)
    .values({
      guildId: actor.guildId,
      kind: input.kind,
      instanceKey: input.instanceKey,
      instanceName: input.instanceName,
      startsAt: input.startsAt,
      expiresAt: input.expiresAt ?? null,
      leaderUserId: actor.userId,
      tanks: input.tanks,
      healers: input.healers,
      dps: input.dps,
      notes: input.notes,
    })
    .returning();
  return (await loadViews(db, [event!]))[0]!;
}

/**
 * Changes a group. With an actor (someone pressed a button) the status needs the leader or an officer. Without one
 * (the bot on its own) only the Discord message, the reminder mark and finishing are allowed.
 */
export async function updateGroup(db: Db, guildId: string, actor: DiscordActor | null, id: string, raw: unknown): Promise<GroupView> {
  const input = groupUpdateInput.parse(raw);
  return db.transaction(async (tx) => {
    const event = await loadEvent(tx, guildId, id);
    const set: Partial<typeof groupEvents.$inferInsert> = { updatedAt: new Date() };
    if (input.status && input.status !== event.status) {
      const systemFinish = !actor && input.status === "finished";
      if (!systemFinish && !(actor && isManager(actor, event))) {
        throw new AuthorizationError("Solo el líder del grupo o un oficial pueden hacer eso.");
      }
      set.status = input.status;
      if (actor && actor.userId !== event.leaderUserId && (input.status === "cancelled" || input.status === "closed")) {
        await recordAudit(tx, actor, { action: `group.${input.status}`, targetType: "group_event", targetId: event.id, before: { status: event.status } });
      }
    }
    if (input.discordChannelId !== undefined) set.discordChannelId = input.discordChannelId;
    if (input.discordMessageId !== undefined) set.discordMessageId = input.discordMessageId;
    if (input.reminded) set.remindedAt = new Date();
    const [updated] = await tx.update(groupEvents).set(set).where(eq(groupEvents.id, event.id)).returning();
    return (await loadViews(tx, [updated!]))[0]!;
  });
}

function requireOpen(status: GroupStatus) {
  if (status !== "open") throw new DomainError("Las inscripciones de este grupo no están abiertas.");
}

/** Signs the actor up with one of their characters, or changes their character, role or bench. */
export async function signUp(db: Db, actor: DiscordActor, id: string, raw: unknown): Promise<GroupView> {
  assertCan(actor, "group.join");
  const input = groupSignupInput.parse(raw);
  return db.transaction(async (tx) => {
    const event = await loadEvent(tx, actor.guildId, id);
    requireOpen(event.status);
    const [character] = await tx
      .select({ id: characters.id, wowClass: characters.wowClass })
      .from(characters)
      .where(
        and(
          eq(characters.guildId, actor.guildId),
          eq(characters.id, input.characterId),
          eq(characters.membershipId, actor.membershipId!),
          isNull(characters.archivedAt),
        ),
      );
    if (!character) throw new DomainError("Ese personaje no es tuyo.");
    if (!canPlayRole(character.wowClass, input.role)) {
      throw new DomainError(`Ese personaje no puede ir de ${GROUP_ROLE_LABELS[input.role].toLowerCase()}.`);
    }
    const [current] = await tx
      .select()
      .from(groupSignups)
      .where(and(eq(groupSignups.eventId, event.id), eq(groupSignups.userId, actor.userId)));
    if (!current) {
      await tx.insert(groupSignups).values({ guildId: actor.guildId, eventId: event.id, characterId: character.id, userId: actor.userId, role: input.role, bench: input.bench });
    } else {
      // Changing role or character puts you at the end of the queue.
      const moved = current.role !== input.role || current.characterId !== character.id;
      await tx
        .update(groupSignups)
        .set({ characterId: character.id, role: input.role, bench: input.bench, ...(moved ? { queuedAt: new Date() } : {}) })
        .where(eq(groupSignups.id, current.id));
    }
    return (await loadViews(tx, [event]))[0]!;
  });
}

async function targetSignup(tx: Db, actor: DiscordActor, event: typeof groupEvents.$inferSelect, targetDiscordId: string | null | undefined) {
  const self = !targetDiscordId || targetDiscordId === actor.discordId;
  if (!self && !isManager(actor, event)) throw new AuthorizationError("Solo el líder del grupo o un oficial pueden hacer eso.");
  const [row] = await tx
    .select({ id: groupSignups.id, bench: groupSignups.bench, userId: groupSignups.userId })
    .from(groupSignups)
    .innerJoin(users, eq(users.id, groupSignups.userId))
    .where(and(eq(groupSignups.eventId, event.id), self ? eq(groupSignups.userId, actor.userId) : eq(users.discordId, targetDiscordId!)));
  if (!row) throw new DomainError(self ? "No estás apuntado a este grupo." : "Esa persona no está apuntada.");
  return { row, self };
}

/** Puts someone on the bench or takes them off it: yourself, or anyone if you lead the group or are an officer. */
export async function setBench(db: Db, actor: DiscordActor, id: string, raw: unknown): Promise<GroupView> {
  assertCan(actor, "group.join");
  const input = groupTargetInput.parse(raw);
  return db.transaction(async (tx) => {
    const event = await loadEvent(tx, actor.guildId, id);
    const { row, self } = await targetSignup(tx, actor, event, input.targetDiscordId);
    if (self) requireOpen(event.status);
    await tx.update(groupSignups).set({ bench: input.bench ?? !row.bench }).where(eq(groupSignups.id, row.id));
    return (await loadViews(tx, [event]))[0]!;
  });
}

/** Leaves a group, or removes someone from it (leader or officer). */
export async function removeSignup(db: Db, actor: DiscordActor, id: string, raw: unknown): Promise<GroupView> {
  assertCan(actor, "group.join");
  const input = groupTargetInput.parse(raw);
  return db.transaction(async (tx) => {
    const event = await loadEvent(tx, actor.guildId, id);
    const { row, self } = await targetSignup(tx, actor, event, input.targetDiscordId);
    if (self) requireOpen(event.status);
    await tx.delete(groupSignups).where(eq(groupSignups.id, row.id));
    if (!self && actor.userId !== event.leaderUserId) {
      await recordAudit(tx, actor, { action: "group.remove_signup", targetType: "group_event", targetId: event.id, before: { userId: row.userId } });
    }
    return (await loadViews(tx, [event]))[0]!;
  });
}
