import { and, asc, desc, eq, isNull, max, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db/types";
import {
  addons,
  applications,
  auditLog,
  bosses,
  bossKills,
  characters,
  contentPages,
  contentRevisions,
  guilds,
  instances,
  memberships,
  raidScheduleSlots,
  recruitmentNeeds,
  users,
} from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { fullName } from "@/lib/game";
import {
  addonInput,
  bossInput,
  bossKillInputFor,
  contentPageInput,
  instanceInput,
  recruitmentNeedInput,
  scheduleSlotInput,
} from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError, NotFoundError } from "@/server/errors";
import { resolveFaction, resolveOptionalFaction } from "@/server/faction";

// --- Charter / content pages ----------------------------------------------

export async function listContentPages(db: Db, guildId: string) {
  return db
    .select()
    .from(contentPages)
    .where(eq(contentPages.guildId, guildId))
    .orderBy(asc(contentPages.sortOrder));
}

export async function getContentPage(db: Db, guildId: string, slug: string) {
  const [page] = await db
    .select()
    .from(contentPages)
    .where(and(eq(contentPages.guildId, guildId), eq(contentPages.slug, slug)));
  return page ?? null;
}

export async function updateContentPage(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "content.edit");
  const input = contentPageInput.parse(raw);
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(contentPages)
      .where(and(eq(contentPages.guildId, actor.guildId), eq(contentPages.slug, input.slug)));
    if (!before) throw new NotFoundError("Page");
    await tx
      .update(contentPages)
      .set({ title: input.title, bodyMd: input.bodyMd, updatedByUserId: actor.userId, updatedAt: new Date() })
      .where(eq(contentPages.id, before.id));
    await tx.insert(contentRevisions).values({
      guildId: actor.guildId,
      pageId: before.id,
      title: before.title,
      bodyMd: before.bodyMd,
      editedByUserId: actor.userId,
    });
    await recordAudit(tx, actor, {
      action: "content.edit",
      targetType: "content_page",
      targetId: before.id,
      before: { title: before.title, length: before.bodyMd.length },
      after: { title: input.title, length: input.bodyMd.length },
    });
  });
  return { title: input.title };
}

// --- Raid schedule ---------------------------------------------------------

export async function listScheduleSlots(db: Db, guildId: string) {
  return db
    .select()
    .from(raidScheduleSlots)
    .where(eq(raidScheduleSlots.guildId, guildId))
    .orderBy(asc(raidScheduleSlots.dayOfWeek), asc(raidScheduleSlots.startTime));
}

export async function saveScheduleSlot(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "schedule.edit");
  const { id, ...parsed } = scheduleSlotInput.parse(raw);
  await db.transaction(async (tx) => {
    const input = { ...parsed, faction: await resolveOptionalFaction(tx, actor.guildId, parsed.faction) };
    if (id) {
      const [row] = await tx
        .update(raidScheduleSlots)
        .set(input)
        .where(and(eq(raidScheduleSlots.guildId, actor.guildId), eq(raidScheduleSlots.id, id)))
        .returning({ id: raidScheduleSlots.id });
      if (!row) throw new NotFoundError("Schedule slot");
    } else {
      await tx.insert(raidScheduleSlots).values({ guildId: actor.guildId, ...input });
    }
    await recordAudit(tx, actor, { action: "schedule.save", targetType: "schedule_slot", targetId: id, after: input });
  });
  return { label: parsed.label, dayOfWeek: parsed.dayOfWeek, created: !id };
}

export async function deleteScheduleSlot(db: Db, actor: Actor, id: string) {
  assertCan(actor, "schedule.edit");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(raidScheduleSlots)
      .where(and(eq(raidScheduleSlots.guildId, actor.guildId), eq(raidScheduleSlots.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Schedule slot");
    await recordAudit(tx, actor, { action: "schedule.delete", targetType: "schedule_slot", targetId: id, before: row });
  });
}

// --- Recruitment -----------------------------------------------------------

export async function listRecruitmentNeeds(db: Db, guildId: string) {
  return db.select().from(recruitmentNeeds).where(eq(recruitmentNeeds.guildId, guildId));
}

export async function setRecruitmentNeed(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "recruitment.edit");
  const parsed = recruitmentNeedInput.parse(raw);
  await db.transaction(async (tx) => {
    const input = { ...parsed, faction: await resolveOptionalFaction(tx, actor.guildId, parsed.faction) };
    await tx
      .insert(recruitmentNeeds)
      .values({ guildId: actor.guildId, ...input })
      .onConflictDoUpdate({
        target: [recruitmentNeeds.guildId, recruitmentNeeds.wowClass, recruitmentNeeds.role, recruitmentNeeds.faction],
        set: { priority: input.priority, note: input.note },
      });
    await recordAudit(tx, actor, { action: "recruitment.set", targetType: "recruitment_need", after: input });
  });
  return parsed;
}

// --- Progression -----------------------------------------------------------

export async function getProgression(db: Db, guildId: string) {
  const [instanceRows, bossRows, killRows] = await Promise.all([
    db.select().from(instances).where(eq(instances.guildId, guildId)).orderBy(asc(instances.sortOrder)),
    db.select().from(bosses).where(eq(bosses.guildId, guildId)).orderBy(asc(bosses.sortOrder)),
    db.select().from(bossKills).where(eq(bossKills.guildId, guildId)).orderBy(asc(bossKills.killedAt)),
  ]);
  return instanceRows.map((instance) => ({
    ...instance,
    bosses: bossRows
      .filter((b) => b.instanceId === instance.id)
      .map((boss) => ({ ...boss, kills: killRows.filter((k) => k.bossId === boss.id) })),
  }));
}

export async function createInstance(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "progression.edit");
  const input = instanceInput.parse(raw);
  try {
    await db.transaction(async (tx) => {
      const [agg] = await tx
        .select({ m: max(instances.sortOrder) })
        .from(instances)
        .where(eq(instances.guildId, actor.guildId));
      const [row] = await tx
        .insert(instances)
        .values({ guildId: actor.guildId, ...input, sortOrder: (agg?.m ?? 0) + 1 })
        .returning();
      await recordAudit(tx, actor, { action: "instance.create", targetType: "instance", targetId: row?.id, after: input });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("Ya existe una instancia con ese nombre.");
    throw err;
  }
}

export async function createBoss(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "progression.edit");
  const input = bossInput.parse(raw);
  await db.transaction(async (tx) => {
    const [agg] = await tx
      .select({ m: max(bosses.sortOrder) })
      .from(bosses)
      .where(and(eq(bosses.guildId, actor.guildId), eq(bosses.instanceId, input.instanceId)));
    // The composite FK rejects an instance from another guild.
    const [row] = await tx
      .insert(bosses)
      .values({ guildId: actor.guildId, ...input, sortOrder: (agg?.m ?? 0) + 1 })
      .returning();
    await recordAudit(tx, actor, { action: "boss.create", targetType: "boss", targetId: row?.id, after: input });
  });
}

export async function recordBossKill(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "progression.edit");
  const [guild] = await db.select({ gameVersion: guilds.gameVersion }).from(guilds).where(eq(guilds.id, actor.guildId));
  const input = bossKillInputFor(guild?.gameVersion ?? "forever").parse(raw);
  return db.transaction(async (tx) => {
    const faction = await resolveFaction(tx, actor.guildId, input.faction);
    const [row] = await tx
      .insert(bossKills)
      .values({
        guildId: actor.guildId,
        bossId: input.bossId,
        faction,
        killedAt: new Date(`${input.killedOn}T12:00:00Z`),
        note: input.note,
        recordedByUserId: actor.userId,
      })
      .returning();
    await recordAudit(tx, actor, { action: "bossKill.record", targetType: "boss_kill", targetId: row?.id, after: input });
    const [boss] = await tx
      .select({ name: bosses.name })
      .from(bosses)
      .where(and(eq(bosses.guildId, actor.guildId), eq(bosses.id, input.bossId)));
    return { bossName: boss?.name ?? null };
  });
}

export async function deleteBossKill(db: Db, actor: Actor, id: string) {
  assertCan(actor, "progression.edit");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(bossKills)
      .where(and(eq(bossKills.guildId, actor.guildId), eq(bossKills.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Kill");
    await recordAudit(tx, actor, { action: "bossKill.delete", targetType: "boss_kill", targetId: id, before: row });
  });
}

// --- Addons ----------------------------------------------------------------

export async function listAddons(db: Db, guildId: string) {
  return db.select().from(addons).where(eq(addons.guildId, guildId)).orderBy(asc(addons.sortOrder), asc(addons.name));
}

export async function saveAddon(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "addons.edit");
  const { id, ...input } = addonInput.parse(raw);
  try {
    await db.transaction(async (tx) => {
      if (id) {
        const [row] = await tx
          .update(addons)
          .set({ ...input, updatedAt: new Date() })
          .where(and(eq(addons.guildId, actor.guildId), eq(addons.id, id)))
          .returning({ id: addons.id });
        if (!row) throw new NotFoundError("Addon");
      } else {
        await tx.insert(addons).values({ guildId: actor.guildId, ...input });
      }
      await recordAudit(tx, actor, { action: "addon.save", targetType: "addon", targetId: id, after: input });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("Ya existe un addon con ese identificador.");
    throw err;
  }
  return { name: input.name, created: !id };
}

export async function deleteAddon(db: Db, actor: Actor, id: string) {
  assertCan(actor, "addons.edit");
  await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(addons)
      .where(and(eq(addons.guildId, actor.guildId), eq(addons.id, id)))
      .returning();
    if (!row) throw new NotFoundError("Addon");
    await recordAudit(tx, actor, { action: "addon.delete", targetType: "addon", targetId: id, before: row });
  });
}

// --- Audit log -------------------------------------------------------------

const actorMembership = alias(memberships, "actor_membership");
const actorMain = alias(characters, "actor_main");
const targetCharacter = alias(characters, "target_character");
const targetMembership = alias(memberships, "target_membership");
const targetMemberMain = alias(characters, "target_member_main");
const targetMemberUser = alias(users, "target_member_user");

function joinName(name: string | null, surname: string | null): string | null {
  return name && surname ? fullName(name, surname) : null;
}

/** Name snapshot writers store in `after` or `before`; older rows may hold only a first name or nothing. */
function storedCharacterName(entry: typeof auditLog.$inferSelect): string | null {
  for (const side of [entry.after, entry.before]) {
    if (side && typeof side === "object" && "characterName" in side && typeof side.characterName === "string") {
      return side.characterName;
    }
  }
  return null;
}

/**
 * Audit entries with character names resolved at read time: the actor's current main (or, for an
 * applicant acting on their own application, the applied character), and the target character's
 * current full name when the target still exists, falling back to the name stored at write time.
 */
export async function listAuditLog(db: Db, actor: Actor, limit = 200) {
  assertCan(actor, "audit.view");
  const rows = await db
    .select({
      entry: auditLog,
      userName: users.name,
      actorDiscord: users.discordUsername,
      actorMainName: actorMain.name,
      actorMainSurname: actorMain.surname,
      charName: targetCharacter.name,
      charSurname: targetCharacter.surname,
      appUserId: applications.userId,
      appName: applications.characterName,
      appSurname: applications.characterSurname,
      memberMainName: targetMemberMain.name,
      memberMainSurname: targetMemberMain.surname,
      memberUserName: targetMemberUser.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .leftJoin(
      actorMembership,
      and(eq(actorMembership.guildId, auditLog.guildId), eq(actorMembership.userId, auditLog.actorUserId)),
    )
    .leftJoin(
      actorMain,
      and(eq(actorMain.membershipId, actorMembership.id), eq(actorMain.isMain, true), isNull(actorMain.archivedAt)),
    )
    .leftJoin(
      targetCharacter,
      and(
        eq(auditLog.targetType, "character"),
        eq(targetCharacter.guildId, auditLog.guildId),
        eq(sql`${targetCharacter.id}::text`, auditLog.targetId),
      ),
    )
    .leftJoin(
      applications,
      and(
        eq(auditLog.targetType, "application"),
        eq(applications.guildId, auditLog.guildId),
        eq(sql`${applications.id}::text`, auditLog.targetId),
      ),
    )
    .leftJoin(
      targetMembership,
      and(
        eq(auditLog.targetType, "membership"),
        eq(targetMembership.guildId, auditLog.guildId),
        eq(sql`${targetMembership.id}::text`, auditLog.targetId),
      ),
    )
    .leftJoin(
      targetMemberMain,
      and(
        eq(targetMemberMain.membershipId, targetMembership.id),
        eq(targetMemberMain.isMain, true),
        isNull(targetMemberMain.archivedAt),
      ),
    )
    .leftJoin(targetMemberUser, eq(targetMemberUser.id, targetMembership.userId))
    .where(eq(auditLog.guildId, actor.guildId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);

  return rows.map((r) => {
    const appFullName = joinName(r.appName, r.appSurname);
    const actorName =
      joinName(r.actorMainName, r.actorMainSurname) ??
      (r.appUserId && r.appUserId === r.entry.actorUserId ? appFullName : null) ??
      r.userName;
    const targetName =
      joinName(r.charName, r.charSurname) ??
      appFullName ??
      joinName(r.memberMainName, r.memberMainSurname) ??
      storedCharacterName(r.entry) ??
      r.memberUserName;
    return { entry: r.entry, actorName, actorDiscord: r.actorDiscord, targetName };
  });
}
