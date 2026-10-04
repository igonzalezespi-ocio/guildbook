import { and, asc, count, eq, isNull, max, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { characters, guilds, memberships, ranks, users } from "@/db/schema";
import { type Actor, assertCan, AuthorizationError, canAssignRank, resolveTier } from "@/lib/authz/policy";
import { fullName, MAX_IN_GAME_RANKS } from "@/lib/game";
import { sameGuildName } from "@/lib/guild-identity";
import { findRealm, VERSION_INFO } from "@/lib/game-versions";
import { assignRankInput, guildSettingsInput, rankDefaultsInput, rankInput, resolveGuildWorld } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError, NotFoundError } from "@/server/errors";
import { CLEARED_VERIFICATION } from "@/server/services/guild-verification";
import { findGuildByIdentity, IDENTITY_CONSTRAINT, identityTakenMessage } from "@/server/services/platform";

export async function listRanks(db: Db, guildId: string) {
  return db.select().from(ranks).where(eq(ranks.guildId, guildId)).orderBy(asc(ranks.sortOrder));
}

async function loadRank(tx: Db, guildId: string, id: string) {
  const [rank] = await tx
    .select()
    .from(ranks)
    .where(and(eq(ranks.guildId, guildId), eq(ranks.id, id)));
  if (!rank) throw new NotFoundError("Rank");
  return rank;
}

async function assertInGameLimit(tx: Db, guildId: string) {
  const [row] = await tx
    .select({ n: count() })
    .from(ranks)
    .where(and(eq(ranks.guildId, guildId), eq(ranks.inGame, true)));
  if ((row?.n ?? 0) > MAX_IN_GAME_RANKS) {
    throw new DomainError(`WoW permite como máximo ${MAX_IN_GAME_RANKS} rangos en el juego.`);
  }
}

async function countActiveAdmins(tx: Db, guildId: string): Promise<number> {
  const [row] = await tx
    .select({ n: count() })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(and(eq(memberships.guildId, guildId), eq(memberships.status, "active"), eq(ranks.tier, "admin")));
  return row?.n ?? 0;
}

/** Runs `mutate` and rolls it back if it removed the guild's last active admin. */
async function guardLastAdmin<T>(tx: Db, guildId: string, mutate: () => Promise<T>): Promise<T> {
  const before = await countActiveAdmins(tx, guildId);
  const result = await mutate();
  if (before > 0 && (await countActiveAdmins(tx, guildId)) === 0) {
    throw new DomainError("La hermandad debe conservar al menos un miembro activo con permisos de Administrador.");
  }
  return result;
}

function rethrowRankName(err: unknown): never {
  if (isUniqueViolation(err)) throw new DomainError("Ya existe un rango con ese nombre.");
  throw err;
}

export async function createRank(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "rank.manage");
  const input = rankInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [agg] = await tx
        .select({ maxSort: max(ranks.sortOrder) })
        .from(ranks)
        .where(eq(ranks.guildId, actor.guildId));
      const [rank] = await tx
        .insert(ranks)
        .values({ guildId: actor.guildId, ...input, sortOrder: (agg?.maxSort ?? 0) + 1 })
        .returning();
      await assertInGameLimit(tx, actor.guildId);
      await recordAudit(tx, actor, { action: "rank.create", targetType: "rank", targetId: rank?.id, after: input });
      return rank;
    });
  } catch (err) {
    rethrowRankName(err);
  }
}

export async function updateRank(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "rank.manage");
  const input = rankInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const before = await loadRank(tx, actor.guildId, id);
      const [rank] = await guardLastAdmin(tx, actor.guildId, () =>
        tx.update(ranks).set(input).where(eq(ranks.id, id)).returning(),
      );
      await assertInGameLimit(tx, actor.guildId);
      await recordAudit(tx, actor, { action: "rank.update", targetType: "rank", targetId: id, before, after: input });
      return rank;
    });
  } catch (err) {
    rethrowRankName(err);
  }
}

export async function moveRank(db: Db, actor: Actor, id: string, direction: "up" | "down") {
  assertCan(actor, "rank.manage");
  await db.transaction(async (tx) => {
    const all = await listRanks(tx, actor.guildId);
    const index = all.findIndex((r) => r.id === id);
    if (index < 0) throw new NotFoundError("Rank");
    const swapWith = all[direction === "up" ? index - 1 : index + 1];
    const current = all[index]!;
    if (!swapWith) return;
    // Park one row on a temporary slot so the (guild_id, sort_order) unique constraint holds.
    await tx.update(ranks).set({ sortOrder: -1 }).where(eq(ranks.id, current.id));
    await tx.update(ranks).set({ sortOrder: current.sortOrder }).where(eq(ranks.id, swapWith.id));
    await tx.update(ranks).set({ sortOrder: swapWith.sortOrder }).where(eq(ranks.id, current.id));
    await recordAudit(tx, actor, {
      action: "rank.reorder",
      targetType: "rank",
      targetId: id,
      before: { sortOrder: current.sortOrder },
      after: { sortOrder: swapWith.sortOrder },
    });
  });
}

export async function deleteRank(db: Db, actor: Actor, id: string) {
  assertCan(actor, "rank.manage");
  await db.transaction(async (tx) => {
    const rank = await loadRank(tx, actor.guildId, id);
    const [inUse] = await tx.select({ n: count() }).from(memberships).where(eq(memberships.rankId, id));
    if ((inUse?.n ?? 0) > 0) throw new DomainError("Saca a los miembros de este rango antes de borrarlo.");
    const [guild] = await tx.select().from(guilds).where(eq(guilds.id, actor.guildId));
    if (guild && [guild.applicantRankId, guild.acceptRankId, guild.trialRankId, guild.autoApproveRankId].includes(id)) {
      throw new DomainError("Este rango se usa para aspirantes, pruebas o miembros nuevos. Cambia primero ese ajuste.");
    }
    await tx.delete(ranks).where(eq(ranks.id, id));
    await recordAudit(tx, actor, { action: "rank.delete", targetType: "rank", targetId: id, before: rank });
  });
}

export async function setRankDefaults(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "rank.manage");
  const input = rankDefaultsInput.parse(raw);
  await db.transaction(async (tx) => {
    const applicant = await loadRank(tx, actor.guildId, input.applicantRankId);
    const accept = await loadRank(tx, actor.guildId, input.acceptRankId);
    const trial = await loadRank(tx, actor.guildId, input.trialRankId);
    if (applicant.tier !== "applicant") throw new DomainError("El rango de aspirantes debe tener el nivel Aspirante.");
    if (accept.tier === "applicant" || trial.tier === "applicant") {
      throw new DomainError("Los rangos de aceptados y de prueba deben ser rangos de miembro.");
    }
    await tx.update(guilds).set(input).where(eq(guilds.id, actor.guildId));
    await recordAudit(tx, actor, { action: "rank.defaults", targetType: "guild", targetId: actor.guildId, after: input });
  });
}

// --- Members ---------------------------------------------------------------

export async function listMembers(db: Db, actor: Actor) {
  assertCan(actor, "admin.area");
  return db
    .select({
      membershipId: memberships.id,
      status: memberships.status,
      joinedAt: memberships.joinedAt,
      rankId: ranks.id,
      rankName: ranks.name,
      rankSort: ranks.sortOrder,
      rankTier: ranks.tier,
      rankInsignia: ranks.insignia,
      userName: users.name,
      discordUsername: users.discordUsername,
      mainId: characters.id,
      mainName: characters.name,
      mainSurname: characters.surname,
      mainClass: characters.wowClass,
      mainFaction: characters.faction,
      /** A character once confirmed in the in-game guild that Battle.net now shows outside it (see the daily sync). */
      leftInGameGuild: sql<boolean>`exists (select 1 from characters lost where lost.membership_id = ${memberships.id} and lost.archived_at is null and lost.in_guild_lost_at is not null)`,
    })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(
      characters,
      and(
        eq(characters.membershipId, memberships.id),
        eq(characters.isMain, true),
        sql`${characters.archivedAt} is null`,
      ),
    )
    .where(and(eq(memberships.guildId, actor.guildId), eq(memberships.status, "active")))
    .orderBy(asc(ranks.sortOrder), asc(users.name));
}

async function loadMemberWithRank(tx: Db, guildId: string, membershipId: string) {
  const [row] = await tx
    .select({
      membership: memberships,
      rankTier: ranks.tier,
      rankName: ranks.name,
      mainName: characters.name,
      mainSurname: characters.surname,
    })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .leftJoin(
      characters,
      and(eq(characters.membershipId, memberships.id), eq(characters.isMain, true), isNull(characters.archivedAt)),
    )
    .where(and(eq(memberships.guildId, guildId), eq(memberships.id, membershipId)));
  if (!row) throw new NotFoundError("Member");
  const { mainName, mainSurname, ...rest } = row;
  return { ...rest, characterName: mainName && mainSurname ? fullName(mainName, mainSurname) : null };
}

export async function assignRank(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "member.assignRank");
  const { membershipId, rankId } = assignRankInput.parse(raw);
  return db.transaction(async (tx) => {
    const target = await loadMemberWithRank(tx, actor.guildId, membershipId);
    const newRank = await loadRank(tx, actor.guildId, rankId);
    if (target.membership.status !== "active") throw new DomainError("Solo se puede asignar rango a miembros activos.");
    if (newRank.tier === "applicant") throw new DomainError("Para los aspirantes, usa la revisión de solicitudes.");
    const targetTier = resolveTier({ status: target.membership.status, rankTier: target.rankTier });
    if (!canAssignRank(actor, targetTier, newRank.tier)) {
      throw new AuthorizationError("No puedes conceder ese rango ni cambiar el rango de este miembro.");
    }
    await guardLastAdmin(tx, actor.guildId, () =>
      tx
        .update(memberships)
        .set({ rankId, updatedAt: sql`now()` })
        .where(eq(memberships.id, membershipId)),
    );
    await recordAudit(tx, actor, {
      action: "member.assignRank",
      targetType: "membership",
      targetId: membershipId,
      before: { rankId: target.membership.rankId, rankName: target.rankName },
      after: { rankId, rankName: newRank.name, characterName: target.characterName },
    });
    return { characterName: target.characterName, rankName: newRank.name };
  });
}

export async function removeMember(db: Db, actor: Actor, membershipId: string) {
  assertCan(actor, "member.assignRank");
  return db.transaction(async (tx) => {
    const target = await loadMemberWithRank(tx, actor.guildId, membershipId);
    const targetTier = resolveTier({ status: target.membership.status, rankTier: target.rankTier });
    if (!canAssignRank(actor, targetTier, "public")) {
      throw new AuthorizationError("No puedes expulsar a un miembro de tu mismo nivel o superior.");
    }
    await guardLastAdmin(tx, actor.guildId, () =>
      tx
        .update(memberships)
        .set({ status: "former", leftAt: new Date(), updatedAt: sql`now()` })
        .where(eq(memberships.id, membershipId)),
    );
    await recordAudit(tx, actor, {
      action: "member.remove",
      targetType: "membership",
      targetId: membershipId,
      before: { characterName: target.characterName },
    });
    return { characterName: target.characterName };
  });
}

// --- Guild settings --------------------------------------------------------

/**
 * Saves guild settings. Name, region, realm, faction and ruleset are the guild's identity: they must be unique
 * together, and changing any of them on a verified guild removes the verification (the in-game guild no longer
 * matches). The game version never changes, and a guild on a realm can move realm only while unverified.
 */
export async function updateGuildSettings(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "guild.settings");
  const parsed = guildSettingsInput.parse(raw);
  const [current] = await db
    .select({ gameVersion: guilds.gameVersion, realmSlug: guilds.realmSlug, verifiedAt: guilds.verifiedAt })
    .from(guilds)
    .where(eq(guilds.id, actor.guildId));
  if (!current) throw new NotFoundError("Guild");
  const realmSlug = VERSION_INFO[current.gameVersion].realms ? (parsed.realmSlug ?? current.realmSlug) : null;
  // A realm belongs to one region, so on versions with realms the realm decides the region.
  const region = findRealm(current.gameVersion, realmSlug)?.region ?? parsed.region;
  const world = resolveGuildWorld(current.gameVersion, { region, ruleset: parsed.ruleset, realmSlug });
  if (!world.ok) throw new DomainError(world.message, { field: world.field });
  if (current.verifiedAt && current.realmSlug !== world.realmSlug) {
    throw new DomainError("Una hermandad verificada no puede cambiar de reino. El reino debe coincidir con el de la hermandad del juego.", { field: "realmSlug" });
  }
  const input = { ...parsed, gameVersion: current.gameVersion, region, realmSlug: world.realmSlug, ruleset: world.ruleset };
  const holder = await findGuildByIdentity(db, input, actor.guildId);
  if (holder) throw new DomainError(identityTakenMessage({ ...input, name: holder.name }), { field: "name" });
  const { gameVersion: _version, ...values } = input;
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(guilds).where(eq(guilds.id, actor.guildId));
      if (!before) throw new NotFoundError("Guild");
      const identityChanged =
        !sameGuildName(before.name, input.name) ||
        before.region !== input.region ||
        before.realmSlug !== input.realmSlug ||
        before.faction !== input.faction ||
        before.ruleset !== input.ruleset;
      const unverify = Boolean(before.verifiedAt) && identityChanged;
      await tx
        .update(guilds)
        .set({ ...values, ...(unverify ? CLEARED_VERIFICATION : {}) })
        .where(eq(guilds.id, actor.guildId));
      await recordAudit(tx, actor, {
        action: "guild.settings",
        targetType: "guild",
        targetId: actor.guildId,
        before: {
          name: before.name,
          motto: before.motto,
          timezone: before.timezone,
          region: before.region,
          realmSlug: before.realmSlug,
          faction: before.faction,
          ruleset: before.ruleset,
          discordInviteUrl: before.discordInviteUrl,
          recruitmentOpen: before.recruitmentOpen,
          directoryListed: before.directoryListed,
          lootPublic: before.lootPublic,
        },
        after: values,
      });
      if (unverify) {
        await recordAudit(tx, actor, {
          action: "guild.verification.remove",
          targetType: "guild",
          targetId: actor.guildId,
          before: {
            name: before.name,
            region: before.region,
            realmSlug: before.realmSlug,
            faction: before.faction,
            ruleset: before.ruleset,
            character: before.verifiedCharacterName,
          },
          after: { reason: "identity_changed" },
        });
      }
      return { unverified: unverify };
    });
  } catch (err) {
    if (isUniqueViolation(err, IDENTITY_CONSTRAINT)) throw new DomainError(identityTakenMessage(input));
    throw err;
  }
}

export async function setRecruitmentOpen(db: Db, actor: Actor, open: boolean) {
  assertCan(actor, "recruitment.edit");
  await db.transaction(async (tx) => {
    await tx.update(guilds).set({ recruitmentOpen: open }).where(eq(guilds.id, actor.guildId));
    await recordAudit(tx, actor, {
      action: "recruitment.toggle",
      targetType: "guild",
      targetId: actor.guildId,
      after: { recruitmentOpen: open },
    });
  });
}
