import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { applications, type BattlenetCharacterSnapshot, characters, guilds, memberships, ranks } from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { type RankTier, TIER_LABELS, tierAtLeast } from "@/lib/authz/tiers";
import { CLASS_INFO, fullName, isValidSpec, specLabel } from "@/lib/game";
import { hasSurnames, isSupportedVersion } from "@/lib/game-versions";
import { sameGuildName } from "@/lib/guild-identity";
import { confirmedJoinInputFor, confirmedJoinSettingsInput } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import type { BlizzardClient } from "@/server/blizzard/client";
import { battlenetEnabled } from "@/server/blizzard/config";
import { snapshotRegion } from "@/server/blizzard/filter";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError, NotFoundError } from "@/server/errors";
import { DRAFT_APPLICATIONS_CLOSED, validDraftInvite } from "@/server/services/applications";
import { defaultEligibility, type Eligibility, getEligibleCharacters } from "@/server/services/battlenet";
import { checkGuildMembership, identityOf } from "@/server/services/guild-verification";

/** Linked characters checked against Blizzard per offer, to bound API calls. */
const MAX_CHARACTERS_CHECKED = 3;
/** How long the apply page reuses a check for the same user, guild and snapshot. Joining always checks again. */
const OFFER_CACHE_MS = 10 * 60 * 1000;

/** Rank tiers a confirmed member may join at: never applicant, and never admin without an admin's own review. */
export const CONFIRMED_JOIN_TIERS: readonly RankTier[] = ["member", "raider", "officer"];

export type ConfirmedJoinUnavailable =
  | "unverified"
  | "setting_off"
  | "battlenet_disabled"
  | "no_rank"
  | "no_link"
  | "not_confirmed"
  | "roster_unavailable"
  | "blizzard_error";

export interface ConfirmedJoinOffer {
  character: BattlenetCharacterSnapshot;
  /** The in-game guild's name as Battle.net spells it. */
  inGameGuildName: string;
  /** The character's roster rank index (0 is the Guild Master). */
  rosterRank: number;
  rank: { id: string; name: string; tier: RankTier };
}

export type ConfirmedJoinCheck = { ok: true; offer: ConfirmedJoinOffer } | { ok: false; reason: ConfirmedJoinUnavailable };

type GuildRow = typeof guilds.$inferSelect;

async function loadGuild(db: Db, guildId: string) {
  const [guild] = await db.select().from(guilds).where(eq(guilds.id, guildId));
  if (!guild) throw new NotFoundError("Guild");
  return guild;
}

/** The rank confirmed members join at: the configured one, else the accepted-applicant rank. Null when neither suits. */
export async function confirmedJoinRank(db: Db, guild: Pick<GuildRow, "id" | "autoApproveRankId" | "acceptRankId">) {
  const rankId = guild.autoApproveRankId ?? guild.acceptRankId;
  if (!rankId) return null;
  const [rank] = await db
    .select({ id: ranks.id, name: ranks.name, tier: ranks.tier })
    .from(ranks)
    .where(and(eq(ranks.guildId, guild.id), eq(ranks.id, rankId)));
  return rank && CONFIRMED_JOIN_TIERS.includes(rank.tier) ? rank : null;
}

const offerCache: Map<string, { at: number; check: ConfirmedJoinCheck }> = ((globalThis as { __confirmedJoinCache?: Map<string, { at: number; check: ConfirmedJoinCheck }> })
  .__confirmedJoinCache ??= new Map());

/**
 * Whether the viewer can join without review: the guild is verified and allows it, and Battle.net confirms one of the
 * viewer's linked characters for this guild (its version, region, realm, faction and ruleset) in the in-game guild,
 * both on its profile and on the guild roster. A roster Blizzard doesn't serve, or an outage, means no offer: the
 * viewer applies as usual. `cached` reuses a recent answer for the apply page; joining never does.
 */
export async function findConfirmedJoin(
  db: Db,
  actor: Actor,
  client: BlizzardClient,
  opts: { eligibility?: Eligibility; cached?: boolean; now?: Date } = {},
): Promise<ConfirmedJoinCheck> {
  assertCan(actor, "application.submit");
  const guild = await loadGuild(db, actor.guildId);
  if (!guild.verifiedAt) return { ok: false, reason: "unverified" };
  if (!guild.autoApproveInGuild) return { ok: false, reason: "setting_off" };
  if (!isSupportedVersion(guild.gameVersion) || !battlenetEnabled(client.config)) return { ok: false, reason: "battlenet_disabled" };
  const rank = await confirmedJoinRank(db, guild);
  if (!rank) return { ok: false, reason: "no_rank" };
  const { link, characters: eligible } = await getEligibleCharacters(db, actor, opts.eligibility ?? defaultEligibility());
  if (!link) return { ok: false, reason: "no_link" };

  const now = (opts.now ?? new Date()).getTime();
  const key = `${guild.id}:${actor.userId}:${link.snapshotAt.getTime()}:${guild.verifiedAt.getTime()}:${rank.id}`;
  const hit = opts.cached ? offerCache.get(key) : undefined;
  if (hit && now - hit.at < OFFER_CACHE_MS) return hit.check;

  const check = await checkLinkedCharacters(client, guild, eligible, rank);
  if (offerCache.size > 5000) offerCache.clear();
  offerCache.set(key, { at: now, check });
  return check;
}

async function checkLinkedCharacters(
  client: BlizzardClient,
  guild: GuildRow,
  eligible: BattlenetCharacterSnapshot[],
  rank: ConfirmedJoinOffer["rank"],
): Promise<ConfirmedJoinCheck> {
  const identity = identityOf(guild);
  const named = (c: BattlenetCharacterSnapshot) => (c.guildName && sameGuildName(c.guildName, guild.name) ? 0 : 1);
  let reason: ConfirmedJoinUnavailable = "not_confirmed";
  for (const c of [...eligible].sort((a, b) => named(a) - named(b)).slice(0, MAX_CHARACTERS_CHECKED)) {
    const check = await checkGuildMembership(client, identity, { id: c.id, name: c.name, realmSlug: c.realmSlug, userId: null });
    if (check.status === "not_member") {
      if (!check.conclusive && reason === "not_confirmed") reason = "blizzard_error";
      continue;
    }
    if (!check.rosterAvailable) {
      reason = "roster_unavailable";
      continue;
    }
    if (check.rank === null) continue;
    return { ok: true, offer: { character: c, inGameGuildName: check.inGame.name, rosterRank: check.rank, rank } };
  }
  return { ok: false, reason };
}

/** Records the join for the guild's admins in their notice banner, newest first. */
function joinNotice(existing: string | null, text: string): string {
  return existing ? `${text}\n\n${existing}` : text;
}

/**
 * Joins the guild without application review as a member Battle.net confirms in the in-game guild (see
 * `findConfirmedJoin`, which runs again here). The membership starts at the confirmed-join rank, the character is
 * linked as verified and in the guild, a pending application is closed as accepted, and the join is audited and
 * noted for the guild's admins.
 */
export async function joinAsConfirmedMember(
  db: Db,
  actor: Actor,
  raw: unknown,
  client: BlizzardClient,
  opts: { eligibility?: Eligibility; invite?: string | null; now?: Date } = {},
) {
  assertCan(actor, "application.submit");
  if (tierAtLeast(actor.tier, "member")) throw new DomainError("Ya eres miembro de la hermandad.");
  const guild = await loadGuild(db, actor.guildId);
  if (!guild.publishedAt && !validDraftInvite(guild, opts.invite)) throw new DomainError(DRAFT_APPLICATIONS_CLOSED);
  const input = confirmedJoinInputFor(guild).parse(raw);

  const check = await findConfirmedJoin(db, actor, client, { eligibility: opts.eligibility, now: opts.now });
  if (!check.ok || check.offer.character.id !== input.bnetCharacterId) {
    throw new DomainError("Battle.net ya no muestra a ese personaje en la hermandad del juego. Envía una solicitud.");
  }
  const { character: bnet, rank, inGameGuildName, rosterRank } = check.offer;
  const surname = hasSurnames(guild.gameVersion) ? (bnet.surname ?? input.surname ?? "") : "";
  if (hasSurnames(guild.gameVersion) && !surname) throw new DomainError("Escribe el apellido de tu personaje.", { field: "surname" });
  if (!isValidSpec(bnet.wowClass, input.spec)) throw new DomainError(`${specLabel(input.spec)} no es una especialización de ${CLASS_INFO[bnet.wowClass].label}.`, { field: "spec" });
  const now = opts.now ?? new Date();
  const name = fullName(bnet.name, surname);

  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: memberships.id, status: memberships.status })
        .from(memberships)
        .where(and(eq(memberships.guildId, guild.id), eq(memberships.userId, actor.userId!)))
        .for("update");
      if (current?.status === "active") throw new DomainError("Ya eres miembro de la hermandad.");
      const [membership] = await tx
        .insert(memberships)
        .values({ guildId: guild.id, userId: actor.userId!, rankId: rank.id, status: "active", joinedAt: now })
        .onConflictDoUpdate({
          target: [memberships.guildId, memberships.userId],
          set: { rankId: rank.id, status: "active", joinedAt: sql`coalesce(${memberships.joinedAt}, now())`, leftAt: null, updatedAt: sql`now()` },
        })
        .returning({ id: memberships.id });
      if (!membership) throw new Error("Membership upsert failed");

      const closed = await tx
        .update(applications)
        .set({ status: "accepted", reviewedAt: now, decisionNote: "Entró sin revisión: Battle.net confirmó al personaje en la hermandad del juego." })
        .where(and(eq(applications.guildId, guild.id), eq(applications.userId, actor.userId!), eq(applications.status, "pending")))
        .returning({ id: applications.id });

      const [existing] = await tx
        .select({ id: characters.id, membershipId: characters.membershipId })
        .from(characters)
        .where(
          and(
            eq(characters.guildId, guild.id),
            isNull(characters.archivedAt),
            or(
              eq(characters.bnetCharacterId, bnet.id),
              and(
                eq(characters.membershipId, membership.id),
                isNull(characters.bnetCharacterId),
                sql`lower(${characters.name}) = lower(${bnet.name})`,
                sql`lower(${characters.surname}) = lower(${surname})`,
              ),
            ),
          ),
        )
        .orderBy(sql`${characters.bnetCharacterId} is null`)
        .limit(1);
      if (existing && existing.membershipId !== membership.id) throw new DomainError(`Otro miembro ya ha registrado a ${name}.`);
      const [main] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(and(eq(characters.membershipId, membership.id), eq(characters.isMain, true), isNull(characters.archivedAt)));
      const data = {
        name: bnet.name,
        surname,
        faction: bnet.faction,
        wowClass: bnet.wowClass,
        level: bnet.level,
        spec: input.spec,
        role: input.role,
        verified: true,
        bnetCharacterId: bnet.id,
        region: snapshotRegion(bnet),
        realmSlug: bnet.realmSlug,
        realmName: bnet.realmName,
        inGuildConfirmedAt: now,
        inGuildLostAt: null,
        isMain: !main || main.id === existing?.id,
      };
      const [saved] = existing
        ? await tx.update(characters).set({ ...data, updatedAt: sql`now()` }).where(eq(characters.id, existing.id)).returning({ id: characters.id })
        : await tx.insert(characters).values({ guildId: guild.id, membershipId: membership.id, ...data }).returning({ id: characters.id });

      await recordAudit(tx, { ...actor, membershipId: membership.id }, {
        action: "member.join_confirmed",
        targetType: "membership",
        targetId: membership.id,
        before: current ? { status: current.status } : undefined,
        after: {
          characterName: name,
          characterId: saved?.id,
          rankId: rank.id,
          rankName: rank.name,
          inGameGuild: inGameGuildName,
          rosterRank,
          realm: bnet.realmSlug,
          closedApplication: closed[0]?.id ?? null,
        },
      });
      const date = now.toISOString().slice(0, 10);
      const notice = `${name} joined as ${rank.name} on ${date} without application review: Battle.net shows them in ${inGameGuildName} in game. You can change their rank under Members, or turn automatic approval off under Guild Settings.`;
      await tx.update(guilds).set({ adminNotice: joinNotice(guild.adminNotice, notice) }).where(eq(guilds.id, guild.id));
      return { characterName: name, rankName: rank.name };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError(`Ya hay registrado un personaje llamado ${name}.`);
    throw err;
  }
}

/** Admin: turn automatic approval of confirmed in-game members on or off, and choose the rank they join at. */
export async function updateConfirmedJoinSettings(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "guild.settings");
  const input = confirmedJoinSettingsInput.parse(raw);
  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    if (input.autoApproveRankId) {
      const [rank] = await tx
        .select({ tier: ranks.tier })
        .from(ranks)
        .where(and(eq(ranks.guildId, guild.id), eq(ranks.id, input.autoApproveRankId)));
      if (!rank) throw new NotFoundError("Rank");
      if (!CONFIRMED_JOIN_TIERS.includes(rank.tier)) {
        throw new DomainError(`Los miembros confirmados no pueden entrar en un rango de nivel ${TIER_LABELS[rank.tier]}.`, { field: "autoApproveRankId" });
      }
    }
    await tx.update(guilds).set(input).where(eq(guilds.id, guild.id));
    await recordAudit(tx, actor, {
      action: "guild.confirmed_join",
      targetType: "guild",
      targetId: guild.id,
      before: { autoApproveInGuild: guild.autoApproveInGuild, autoApproveRankId: guild.autoApproveRankId },
      after: input,
    });
    return input;
  });
}
