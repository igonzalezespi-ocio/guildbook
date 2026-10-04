import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { characterProfessions, characters, guilds, memberships, ranks } from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { fullName, isValidSpec } from "@/lib/game";
import { characterInputFor, type CharacterInput } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError, NotFoundError } from "@/server/errors";
import { resolveFaction } from "@/server/faction";

function requireMembership(actor: Actor): string {
  if (!actor.membershipId) throw new DomainError("Necesitas ser miembro activo para gestionar personajes.");
  return actor.membershipId;
}

async function loadOwnCharacter(tx: Db, actor: Actor, id: string) {
  const membershipId = requireMembership(actor);
  const [row] = await tx
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.guildId, actor.guildId),
        eq(characters.id, id),
        eq(characters.membershipId, membershipId),
        isNull(characters.archivedAt),
      ),
    );
  if (!row) throw new NotFoundError("Character");
  return row;
}

async function clearMain(tx: Db, membershipId: string, exceptId?: string) {
  await tx
    .update(characters)
    .set({ isMain: false })
    .where(
      and(
        eq(characters.membershipId, membershipId),
        eq(characters.isMain, true),
        exceptId ? ne(characters.id, exceptId) : undefined,
      ),
    );
}

async function hasOtherMain(tx: Db, membershipId: string, exceptId?: string) {
  const [row] = await tx
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.membershipId, membershipId),
        eq(characters.isMain, true),
        isNull(characters.archivedAt),
        exceptId ? ne(characters.id, exceptId) : undefined,
      ),
    );
  return Boolean(row);
}

async function replaceProfessions(tx: Db, guildId: string, characterId: string, input: CharacterInput) {
  await tx.delete(characterProfessions).where(eq(characterProfessions.characterId, characterId));
  if (input.professions.length > 0) {
    await tx
      .insert(characterProfessions)
      .values(input.professions.map((p) => ({ guildId, characterId, profession: p.profession, skill: p.skill })));
  }
}

async function guildVersionOf(db: Db, guildId: string) {
  const [row] = await db.select({ gameVersion: guilds.gameVersion }).from(guilds).where(eq(guilds.id, guildId));
  return row?.gameVersion ?? "forever";
}

function rethrowNameConflict(err: unknown, input: CharacterInput): never {
  if (isUniqueViolation(err)) {
    throw new DomainError(`Ya hay registrado un personaje llamado ${fullName(input.name, input.surname)}.`);
  }
  throw err;
}

export async function createCharacter(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "character.manageOwn");
  const membershipId = requireMembership(actor);
  const input = characterInputFor(await guildVersionOf(db, actor.guildId)).parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const faction = await resolveFaction(tx, actor.guildId, input.faction);
      const makeMain = input.isMain || !(await hasOtherMain(tx, membershipId));
      if (makeMain) await clearMain(tx, membershipId);
      const [created] = await tx
        .insert(characters)
        .values({
          guildId: actor.guildId,
          membershipId,
          name: input.name,
          surname: input.surname,
          faction,
          wowClass: input.wowClass,
          spec: input.spec,
          role: input.role,
          level: input.level,
          isMain: makeMain,
        })
        .returning();
      if (!created) throw new Error("Insert failed");
      await replaceProfessions(tx, actor.guildId, created.id, input);
      return created;
    });
  } catch (err) {
    rethrowNameConflict(err, input);
  }
}

export async function updateCharacter(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "character.manageOwn");
  const input = characterInputFor(await guildVersionOf(db, actor.guildId)).parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const current = await loadOwnCharacter(tx, actor, id);
      // Battle.net owns a verified character's name, class, level and faction; the form can't change them.
      const locked = current.verified
        ? { name: current.name, wowClass: current.wowClass, level: current.level, faction: current.faction }
        : null;
      const faction = locked?.faction ?? (await resolveFaction(tx, actor.guildId, input.faction));
      const wowClass = locked?.wowClass ?? input.wowClass;
      if (locked && !isValidSpec(wowClass, input.spec)) throw new DomainError("Esa especialización no es de esa clase.");
      const makeMain = input.isMain || (current.isMain && !(await hasOtherMain(tx, current.membershipId, id)));
      if (makeMain) await clearMain(tx, current.membershipId, id);
      const [updated] = await tx
        .update(characters)
        .set({
          name: locked?.name ?? input.name,
          surname: input.surname,
          faction,
          wowClass,
          spec: input.spec,
          role: input.role,
          level: locked?.level ?? input.level,
          isMain: makeMain,
          updatedAt: sql`now()`,
        })
        .where(eq(characters.id, id))
        .returning();
      await replaceProfessions(tx, actor.guildId, id, input);
      return updated;
    });
  } catch (err) {
    rethrowNameConflict(err, input);
  }
}

export async function setMainCharacter(db: Db, actor: Actor, id: string) {
  assertCan(actor, "character.manageOwn");
  return db.transaction(async (tx) => {
    const current = await loadOwnCharacter(tx, actor, id);
    await clearMain(tx, current.membershipId, id);
    await tx.update(characters).set({ isMain: true, updatedAt: sql`now()` }).where(eq(characters.id, id));
    return { name: current.name, surname: current.surname };
  });
}

/** Archived characters stay referenced by history (signups, loot) but leave the roster. */
export async function archiveCharacter(db: Db, actor: Actor, id: string) {
  assertCan(actor, "character.manageOwn");
  return db.transaction(async (tx) => {
    const current = await loadOwnCharacter(tx, actor, id);
    await tx
      .update(characters)
      .set({ archivedAt: new Date(), isMain: false, updatedAt: sql`now()` })
      .where(eq(characters.id, id));
    if (current.isMain) {
      const [next] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(and(eq(characters.membershipId, current.membershipId), isNull(characters.archivedAt)))
        .orderBy(desc(characters.level), asc(characters.createdAt))
        .limit(1);
      if (next) await tx.update(characters).set({ isMain: true }).where(eq(characters.id, next.id));
    }
    await recordAudit(tx, actor, {
      action: "character.archive",
      targetType: "character",
      targetId: id,
      before: { characterName: fullName(current.name, current.surname) },
    });
    return { name: current.name, surname: current.surname };
  });
}

export type CharacterWithProfessions = typeof characters.$inferSelect & {
  professions: { profession: (typeof characterProfessions.$inferSelect)["profession"]; skill: number | null }[];
};

async function attachProfessions(
  db: Db,
  rows: (typeof characters.$inferSelect)[],
): Promise<CharacterWithProfessions[]> {
  if (rows.length === 0) return [];
  const profs = await db
    .select()
    .from(characterProfessions)
    .where(
      inArray(
        characterProfessions.characterId,
        rows.map((r) => r.id),
      ),
    );
  return rows.map((r) => ({
    ...r,
    professions: profs
      .filter((p) => p.characterId === r.id)
      .map((p) => ({ profession: p.profession, skill: p.skill })),
  }));
}

export async function listOwnCharacters(db: Db, actor: Actor): Promise<CharacterWithProfessions[]> {
  assertCan(actor, "character.manageOwn");
  const membershipId = requireMembership(actor);
  const rows = await db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.guildId, actor.guildId),
        eq(characters.membershipId, membershipId),
        isNull(characters.archivedAt),
      ),
    )
    .orderBy(desc(characters.isMain), asc(characters.name));
  return attachProfessions(db, rows);
}

export async function getOwnCharacter(db: Db, actor: Actor, id: string): Promise<CharacterWithProfessions> {
  assertCan(actor, "character.manageOwn");
  const row = await loadOwnCharacter(db, actor, id);
  const [withProfs] = await attachProfessions(db, [row]);
  return withProfs!;
}

/** Public roster: main characters of active members, each with their alts. */
export async function getRoster(db: Db, guildId: string) {
  const mains = await db
    .select({
      id: characters.id,
      membershipId: characters.membershipId,
      name: characters.name,
      surname: characters.surname,
      faction: characters.faction,
      wowClass: characters.wowClass,
      spec: characters.spec,
      role: characters.role,
      level: characters.level,
      verified: characters.verified,
      inGuildConfirmedAt: characters.inGuildConfirmedAt,
      rankName: ranks.name,
      rankSort: ranks.sortOrder,
      rankTier: ranks.tier,
      rankInsignia: ranks.insignia,
    })
    .from(characters)
    .innerJoin(memberships, eq(memberships.id, characters.membershipId))
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(
      and(
        eq(characters.guildId, guildId),
        eq(characters.isMain, true),
        isNull(characters.archivedAt),
        eq(memberships.status, "active"),
      ),
    )
    .orderBy(asc(ranks.sortOrder), asc(characters.name));
  if (mains.length === 0) return [];
  const alts = await db
    .select({
      id: characters.id,
      membershipId: characters.membershipId,
      name: characters.name,
      surname: characters.surname,
      wowClass: characters.wowClass,
      verified: characters.verified,
    })
    .from(characters)
    .where(
      and(
        eq(characters.guildId, guildId),
        eq(characters.isMain, false),
        isNull(characters.archivedAt),
        inArray(
          characters.membershipId,
          mains.map((m) => m.membershipId),
        ),
      ),
    )
    .orderBy(desc(characters.level), asc(characters.name));
  return mains.map((m) => ({ ...m, alts: alts.filter((a) => a.membershipId === m.membershipId) }));
}

/**
 * Public character sheet. Returns null unless the character is unarchived, belongs to `guildId`
 * and is owned by an active member. Exposes nothing about the owning user beyond rank and join date.
 */
export async function getPublicCharacter(db: Db, guildId: string, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: characters.id,
      membershipId: characters.membershipId,
      name: characters.name,
      surname: characters.surname,
      faction: characters.faction,
      wowClass: characters.wowClass,
      spec: characters.spec,
      role: characters.role,
      level: characters.level,
      isMain: characters.isMain,
      verified: characters.verified,
      inGuildConfirmedAt: characters.inGuildConfirmedAt,
      region: characters.region,
      realmName: characters.realmName,
      syncedAt: characters.syncedAt,
      joinedAt: memberships.joinedAt,
      rankName: ranks.name,
      rankTier: ranks.tier,
      rankInsignia: ranks.insignia,
    })
    .from(characters)
    .innerJoin(memberships, and(eq(memberships.guildId, characters.guildId), eq(memberships.id, characters.membershipId)))
    .innerJoin(ranks, and(eq(ranks.guildId, memberships.guildId), eq(ranks.id, memberships.rankId)))
    .where(
      and(
        eq(characters.guildId, guildId),
        eq(characters.id, id),
        isNull(characters.archivedAt),
        eq(memberships.status, "active"),
      ),
    );
  if (!row) return null;
  const { membershipId, ...character } = row;
  const [otherCharacters, professions] = await Promise.all([
    db
      .select({
        id: characters.id,
        name: characters.name,
        surname: characters.surname,
        wowClass: characters.wowClass,
        spec: characters.spec,
        level: characters.level,
        isMain: characters.isMain,
        verified: characters.verified,
      })
      .from(characters)
      .where(
        and(
          eq(characters.guildId, guildId),
          eq(characters.membershipId, membershipId),
          ne(characters.id, id),
          isNull(characters.archivedAt),
        ),
      )
      .orderBy(desc(characters.isMain), desc(characters.level), asc(characters.name)),
    db
      .select({ profession: characterProfessions.profession, skill: characterProfessions.skill })
      .from(characterProfessions)
      .where(and(eq(characterProfessions.guildId, guildId), eq(characterProfessions.characterId, id)))
      .orderBy(desc(characterProfessions.skill), asc(characterProfessions.profession)),
  ]);
  return { ...character, otherCharacters, professions };
}

export type PublicCharacter = NonNullable<Awaited<ReturnType<typeof getPublicCharacter>>>;
