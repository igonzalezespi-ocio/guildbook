import { randomBytes } from "node:crypto";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { battlenetLinks, type BattlenetCharacterSnapshot, guilds, memberships, ranks, type VerificationResult } from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { FACTION_LABELS, type Faction, REGION_LABELS, type Region, RULESET_INFO, type Ruleset } from "@/lib/game";
import { type GuildVersion, isSupportedVersion, realmLabel, type SupportedGuildVersion, VERSION_INFO } from "@/lib/game-versions";
import {
  cleanGuildName,
  describeIdentity,
  type GuildIdentity,
  sameGuildName,
  unverifiedName,
  VERIFICATION_GRACE_DAYS,
} from "@/lib/guild-identity";
import { slugProblem, suggestSlug } from "@/lib/hosts";
import { recordAudit } from "@/server/audit";
import type { BlizzardClient, CharacterProfile } from "@/server/blizzard/client";
import { battlenetEnabled } from "@/server/blizzard/config";
import { charactersForGuild, snapshotRegion, snapshotVersion } from "@/server/blizzard/filter";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError, NotFoundError } from "@/server/errors";
import { sameIdentity } from "@/server/services/guilds";
import { relocationSlug } from "@/server/services/slug-suggestions";

/** Why a guild isn't verified. */
export type VerificationReason =
  | "battlenet_disabled"
  | "no_link"
  | "prelaunch"
  | "version_unsupported"
  | "no_version_characters"
  /** Stored results from before game versions; read as `no_version_characters`. */
  | "no_forever_characters"
  | "version_mismatch"
  | "region_mismatch"
  | "realm_mismatch"
  | "character_missing"
  | "not_in_guild"
  | "faction_mismatch"
  | "ruleset_mismatch"
  | "ruleset_unknown"
  | "roster_unavailable"
  | "not_guild_master"
  | "name_mismatch"
  | "gm_left"
  | "blizzard_error";

export interface InGameGuild {
  name: string;
  realmSlug: string;
  faction: Faction | null;
  ruleset: Ruleset | null;
}

interface CheckedCharacter {
  id: string;
  name: string;
  realmSlug: string;
  userId: string | null;
}

export type CharacterCheck =
  | { ok: true; character: CheckedCharacter; inGame: InGameGuild }
  | {
      ok: false;
      reason: VerificationReason;
      conclusive: boolean;
      character?: CheckedCharacter;
      inGame?: InGameGuild;
      rank?: number | null;
    };

export const CLEARED_VERIFICATION = {
  verifiedAt: null,
  verifiedUserId: null,
  verifiedCharacterId: null,
  verifiedCharacterName: null,
  verifiedRealmSlug: null,
  verifiedVia: null,
  verificationFailingSince: null,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Characters checked against Blizzard per on-demand verification, to bound API calls. */
const MAX_CHARACTERS_CHECKED = 10;

/** Whether the guild's game hasn't opened yet (WoW: Forever before Nov 4, 2026); versions without a launch date never are. */
export function isPreLaunch(now: Date, version: GuildVersion = "forever"): boolean {
  const launch = VERSION_INFO[version].launchDate;
  return Boolean(launch) && now.toISOString().slice(0, 10) < launch!;
}

/** The guild's version as one Battle.net verification knows; the others never reach a Blizzard lookup. */
function lookupVersion(identity: GuildIdentity): SupportedGuildVersion {
  return isSupportedVersion(identity.gameVersion) ? identity.gameVersion : "forever";
}

export interface InGameMembership {
  guild: InGameGuild;
  /** Roster rank (0 is the Guild Master), or null when the roster was unavailable or doesn't list the character. */
  rank: number | null;
  rosterAvailable: boolean;
}

/**
 * Looks up a character's in-game guild for a guild's identity, in the guild's version namespace and region: the
 * character profile summary for the guild, the realm's ruleset, and the roster for the rank. Fails with the first
 * identity mismatch (faction, realm for versions with realms, ruleset). The name is left to the caller.
 */
async function inGameMembership(
  client: BlizzardClient,
  identity: GuildIdentity,
  character: CheckedCharacter,
): Promise<{ ok: true; membership: InGameMembership } | { ok: false; reason: VerificationReason; conclusive: boolean; inGame?: InGameGuild }> {
  const version = lookupVersion(identity);
  const lookup = await client.lookupCharacterProfile(identity.region, character.realmSlug, character.name, version);
  if (lookup.status === "error") return { ok: false, reason: "blizzard_error", conclusive: false };
  if (lookup.status === "missing" || lookup.profile.id !== character.id) return { ok: false, reason: "character_missing", conclusive: true };
  const guild = lookup.profile.guild;
  if (!guild) return { ok: false, reason: "not_in_guild", conclusive: true };

  const realm = await client.getRealmRuleset(identity.region, guild.realmSlug, version);
  if (realm.status === "error") return { ok: false, reason: "blizzard_error", conclusive: false };
  const inGame: InGameGuild = {
    name: guild.name,
    realmSlug: guild.realmSlug,
    faction: guild.faction ?? lookup.profile.faction,
    ruleset: realm.ruleset,
  };
  if (inGame.faction && inGame.faction !== identity.faction) return { ok: false, reason: "faction_mismatch", conclusive: true, inGame };
  if (VERSION_INFO[identity.gameVersion].realms && identity.realmSlug && guild.realmSlug.toLowerCase() !== identity.realmSlug) {
    return { ok: false, reason: "realm_mismatch", conclusive: true, inGame };
  }
  if (!inGame.ruleset) return { ok: false, reason: "ruleset_unknown", conclusive: false, inGame };
  if (inGame.ruleset !== identity.ruleset) return { ok: false, reason: "ruleset_mismatch", conclusive: true, inGame };

  const roster = await client.lookupGuildRoster(identity.region, guild.realmSlug, guild.nameSlug, version);
  if (roster.status !== "ok") return { ok: true, membership: { guild: inGame, rank: null, rosterAvailable: false } };
  const member = roster.members.find((m) => m.id === character.id);
  return { ok: true, membership: { guild: inGame, rank: member?.rank ?? null, rosterAvailable: true } };
}

/**
 * Checks one character against a guild's identity: its in-game guild (character profile summary), that guild's
 * realm (versions with realms) and ruleset (Game Data realm type), and the character's rank (guild roster, rank 0 =
 * Guild Master). Every lookup is in the guild's game version and region: a character elsewhere can never match. All
 * lookups use the app token; the member's own token isn't needed.
 */
export async function checkCharacter(
  client: BlizzardClient,
  identity: GuildIdentity,
  character: CheckedCharacter,
): Promise<CharacterCheck> {
  const fail = (reason: VerificationReason, conclusive: boolean, extra: Partial<Extract<CharacterCheck, { ok: false }>> = {}) =>
    ({ ok: false, reason, conclusive, character, ...extra }) as const;

  const found = await inGameMembership(client, identity, character);
  if (!found.ok) return fail(found.reason, found.conclusive, found.inGame ? { inGame: found.inGame } : {});
  const { guild: inGame, rank, rosterAvailable } = found.membership;
  if (!rosterAvailable) return fail("roster_unavailable", false, { inGame });
  if (rank !== 0) return fail("not_guild_master", true, { inGame, rank });
  if (!sameGuildName(inGame.name, identity.name)) return fail("name_mismatch", true, { inGame, rank: 0 });
  return { ok: true, character, inGame };
}

/**
 * Whether a character profile shows the character in the guild's in-game guild: same name and faction and, for
 * versions with realms, the guild's realm. Region and version are fixed by where the profile was read.
 */
export function profileInGuild(
  profile: Pick<CharacterProfile, "guild" | "faction">,
  guild: Pick<GuildIdentity, "gameVersion" | "realmSlug" | "name" | "faction">,
): boolean {
  const inGame = profile.guild;
  if (!inGame || !sameGuildName(inGame.name, guild.name)) return false;
  const faction = inGame.faction ?? profile.faction;
  if (faction && faction !== guild.faction) return false;
  if (VERSION_INFO[guild.gameVersion].realms && guild.realmSlug && inGame.realmSlug.toLowerCase() !== guild.realmSlug) return false;
  return true;
}

export type MembershipCheck =
  | { status: "member"; inGame: InGameGuild; rank: number | null; rosterAvailable: boolean }
  | { status: "not_member"; reason: VerificationReason; conclusive: boolean; inGame?: InGameGuild };

/**
 * Whether a character is in the guild's in-game guild: same name, faction, realm (versions with realms), ruleset and
 * region, in the guild's version. The profile summary decides; the roster only adds the rank when Blizzard serves it.
 */
export async function checkGuildMembership(
  client: BlizzardClient,
  identity: GuildIdentity,
  character: CheckedCharacter,
): Promise<MembershipCheck> {
  const found = await inGameMembership(client, identity, character);
  if (!found.ok) return { status: "not_member", reason: found.reason, conclusive: found.conclusive, inGame: found.inGame };
  const { guild: inGame, rank, rosterAvailable } = found.membership;
  if (!sameGuildName(inGame.name, identity.name)) return { status: "not_member", reason: "name_mismatch", conclusive: true, inGame };
  return { status: "member", inGame, rank, rosterAvailable };
}

/** Lower is closer to verified; picks which failure to explain when several characters were checked. */
function relevance(check: CharacterCheck, identity: GuildIdentity): number {
  if (check.ok) return -1;
  const sameName = check.inGame ? sameGuildName(check.inGame.name, identity.name) : false;
  const order: VerificationReason[] = [
    "not_guild_master",
    "roster_unavailable",
    "realm_mismatch",
    "ruleset_mismatch",
    "faction_mismatch",
    "ruleset_unknown",
  ];
  if (sameName && order.includes(check.reason)) return order.indexOf(check.reason);
  const rest: VerificationReason[] = [
    "name_mismatch",
    "not_guild_master",
    "roster_unavailable",
    "ruleset_unknown",
    "realm_mismatch",
    "ruleset_mismatch",
    "faction_mismatch",
    "not_in_guild",
    "character_missing",
    "blizzard_error",
  ];
  return 10 + Math.max(0, rest.indexOf(check.reason));
}

export function pickBestCheck(checks: CharacterCheck[], identity: GuildIdentity): CharacterCheck | null {
  return [...checks].sort((a, b) => relevance(a, identity) - relevance(b, identity))[0] ?? null;
}

/** The user-facing explanation of a check. */
export function describeCheck(
  check: CharacterCheck | { ok: false; reason: VerificationReason; conclusive: boolean },
  identity: GuildIdentity,
): string {
  if (check.ok) {
    return `Verificada: ${check.character.name} es maestro de la hermandad ${check.inGame.name} (${describeIdentity(identity)}).`;
  }
  const who = "character" in check && check.character ? check.character.name : "El personaje";
  const inGame = "inGame" in check ? check.inGame : undefined;
  const guildName = inGame?.name ?? "su hermandad";
  const version = VERSION_INFO[identity.gameVersion].label;
  switch (check.reason) {
    case "battlenet_disabled":
      return "Battle.net aún no está configurado en este sitio, así que no se pueden verificar hermandades.";
    case "no_link":
      return "Ningún administrador de esta hermandad ha vinculado una cuenta de Battle.net. El maestro de la hermandad vincula la suya desde Mis personajes y vuelve a comprobarlo.";
    case "version_unsupported":
      return `La verificación con Battle.net para hermandades de ${VERSION_INFO[identity.gameVersion].label} llegará pronto. Mientras tanto la hermandad funciona con normalidad, sin el sello de verificada.`;
    case "prelaunch":
      return `La verificación se abre cuando existan personajes de WoW: Forever. Forever sale el 4 de noviembre de 2026 y Blizzard aún no publica personajes de Forever. Tras el lanzamiento, funda la hermandad en el juego, actualiza tus personajes de Battle.net en Mis personajes y vuelve a comprobarlo.`;
    case "no_version_characters":
    case "no_forever_characters":
      return `No se han encontrado personajes de ${version} en la región de ${REGION_LABELS[identity.region]} en las cuentas de Battle.net vinculadas de los administradores. Actualiza tus personajes en Mis personajes (o vuelve a conectar Battle.net) y vuelve a comprobarlo.`;
    case "version_mismatch":
      return `Los personajes de Battle.net vinculados de los administradores son de otro juego, pero esta es una hermandad de ${version}. Actualiza tus personajes en Mis personajes para traer tus personajes de ${version} y vuelve a comprobarlo.`;
    case "region_mismatch":
      return `Los personajes de ${version} de los administradores están en otra región, pero esta hermandad está en la región de ${REGION_LABELS[identity.region]}. Las regiones son mundos separados; si la hermandad está en la región equivocada, cámbiala en Ajustes de la hermandad.`;
    case "realm_mismatch":
      return `La hermandad de ${who}, ${guildName}, está en ${realmLabel(identity.gameVersion, inGame?.realmSlug ?? "otro reino")}, pero esta hermandad está en ${identity.realmSlug ? realmLabel(identity.gameVersion, identity.realmSlug, identity.region) : "otro reino"}. Si la hermandad está en el reino equivocado, cámbialo en Ajustes de la hermandad mientras no esté verificada.`;
    case "character_missing":
      return `No se ha encontrado a ${who} en Battle.net (ha cambiado de nombre, se ha borrado, se ha transferido o aún no es visible: los perfiles se actualizan cuando el personaje cierra sesión).`;
    case "not_in_guild":
      return `${who} no está en ninguna hermandad en el juego.`;
    case "faction_mismatch":
      return `La hermandad de ${who}, ${guildName}, es ${inGame?.faction ? `de la ${FACTION_LABELS[inGame.faction]}` : "de otra facción"}, pero esta hermandad es de la ${FACTION_LABELS[identity.faction]}.`;
    case "ruleset_mismatch":
      return `La hermandad de ${who}, ${guildName}, está en el tipo de reino ${inGame?.ruleset ? RULESET_INFO[inGame.ruleset].label : "otro"}, pero esta hermandad es ${RULESET_INFO[identity.ruleset].label}.`;
    case "ruleset_unknown":
      return `Guildbook no ha podido saber a qué tipo de reino pertenece el reino de ${who} (${inGame?.realmSlug ?? "desconocido"}). Inténtalo más tarde o pide al equipo de Guildbook que lo añada.`;
    case "roster_unavailable":
      return `Battle.net no ha devuelto la lista de miembros de ${guildName}, así que no se ha podido confirmar el rango de maestro de la hermandad. Inténtalo más tarde.`;
    case "not_guild_master": {
      const rank = "rank" in check && check.rank != null ? ` (rango ${check.rank})` : "";
      return `${who} está en ${guildName} pero no es su maestro de la hermandad${rank}. Vincula el personaje del maestro de la hermandad y vuelve a comprobarlo.`;
    }
    case "name_mismatch":
      return `${who} es maestro de la hermandad ${guildName}, pero esta hermandad se llama ${identity.name}.`;
    case "gm_left":
      return "El administrador que verificó esta hermandad ya no es uno de sus administradores.";
    case "blizzard_error":
      return "Battle.net no ha respondido. Inténtalo más tarde.";
  }
}

interface Candidate extends CheckedCharacter {
  region: Region;
  faction: Faction;
  gameVersion: GuildVersion;
  snapshotGuildName: string | null;
}

/** Characters of every version, in every region, on the linked Battle.net accounts of the guild's active admin-tier members. */
export async function adminCandidates(db: Db, guildId: string) {
  const rows = await db
    .select({ userId: memberships.userId, characters: battlenetLinks.characters })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .innerJoin(battlenetLinks, eq(battlenetLinks.userId, memberships.userId))
    .where(and(eq(memberships.guildId, guildId), eq(memberships.status, "active"), eq(ranks.tier, "admin")))
    .orderBy(asc(memberships.joinedAt));
  const candidates: Candidate[] = rows.flatMap((r) =>
    (r.characters as BattlenetCharacterSnapshot[]).map((c) => ({
      id: c.id,
      name: c.name,
      realmSlug: c.realmSlug,
      userId: r.userId,
      region: snapshotRegion(c),
      faction: c.faction,
      gameVersion: snapshotVersion(c),
      snapshotGuildName: c.guildName,
    })),
  );
  return { links: rows.length, candidates };
}

function orderCandidates(candidates: Candidate[], identity: GuildIdentity, preferUserId: string | null): Candidate[] {
  const score = (c: Candidate) =>
    (c.snapshotGuildName && sameGuildName(c.snapshotGuildName, identity.name) ? 0 : 4) +
    (c.faction === identity.faction ? 0 : 2) +
    (!identity.realmSlug || c.realmSlug.toLowerCase() === identity.realmSlug ? 0 : 2) +
    (c.userId === preferUserId ? 0 : 1);
  return [...candidates].sort((a, b) => score(a) - score(b));
}

/** Battle.net verification covers WoW: Forever and TBC Anniversary. */
export function verificationSupported(version: GuildVersion): boolean {
  return isSupportedVersion(version);
}

export function identityOf(guild: GuildIdentity): GuildIdentity {
  return {
    gameVersion: guild.gameVersion,
    realmSlug: guild.realmSlug,
    name: guild.name,
    region: guild.region,
    faction: guild.faction,
    ruleset: guild.ruleset,
  };
}

export interface VerificationRun {
  check: CharacterCheck | { ok: false; reason: VerificationReason; conclusive: boolean };
  message: string;
}

/** Runs the Blizzard checks for a guild's admins without writing anything. */
export async function runVerificationCheck(
  db: Db,
  guild: GuildIdentity & { id: string },
  client: BlizzardClient,
  opts: { preferUserId?: string | null; now?: Date } = {},
): Promise<VerificationRun> {
  const now = opts.now ?? new Date();
  const identity = identityOf(guild);
  const done = (check: VerificationRun["check"]): VerificationRun => ({ check, message: describeCheck(check, identity) });
  if (!verificationSupported(identity.gameVersion)) return done({ ok: false, reason: "version_unsupported", conclusive: false });
  if (!battlenetEnabled(client.config)) return done({ ok: false, reason: "battlenet_disabled", conclusive: false });

  const { links, candidates: everywhere } = await adminCandidates(db, guild.id);
  if (links === 0) return done({ ok: false, reason: "no_link", conclusive: true });
  const sameVersion = everywhere.filter((c) => c.gameVersion === identity.gameVersion);
  const candidates = sameVersion.filter((c) => c.region === identity.region);
  if (candidates.length === 0) {
    if (sameVersion.length > 0) return done({ ok: false, reason: "region_mismatch", conclusive: true });
    if (isPreLaunch(now, identity.gameVersion)) return done({ ok: false, reason: "prelaunch", conclusive: true });
    if (everywhere.length > 0) return done({ ok: false, reason: "version_mismatch", conclusive: true });
    return done({ ok: false, reason: "no_version_characters", conclusive: true });
  }

  const checks: CharacterCheck[] = [];
  for (const c of orderCandidates(candidates, identity, opts.preferUserId ?? null).slice(0, MAX_CHARACTERS_CHECKED)) {
    const check = await checkCharacter(client, identity, { id: c.id, name: c.name, realmSlug: c.realmSlug, userId: c.userId });
    checks.push(check);
    if (check.ok) break;
  }
  return done(pickBestCheck(checks, identity)!);
}

/** For a Guild Master of a same-region, same-faction, same-ruleset guild with another name: who holds that name on Guildbook. */
async function claimInfo(db: Db, guild: GuildIdentity & { id: string }, check: VerificationRun["check"]) {
  if (check.ok || check.reason !== "name_mismatch" || !("inGame" in check) || !check.inGame) return null;
  const name = cleanGuildName(check.inGame.name);
  const [holder] = await db
    .select({ id: guilds.id, name: guilds.name, verifiedAt: guilds.verifiedAt })
    .from(guilds)
    .where(and(sameIdentity({ ...identityOf(guild), name }), ne(guilds.id, guild.id)));
  return { name, holderName: holder?.name ?? null, holderVerified: Boolean(holder?.verifiedAt) };
}

function toResult(run: VerificationRun, claim: VerificationResult["claim"]): VerificationResult {
  const { check } = run;
  return {
    verified: check.ok,
    reason: check.ok ? null : check.reason,
    message: run.message,
    conclusive: check.ok ? true : check.conclusive,
    characterName: "character" in check && check.character ? check.character.name : null,
    inGameGuildName: "inGame" in check && check.inGame ? check.inGame.name : null,
    claim,
  };
}

type GuildRow = typeof guilds.$inferSelect;

/**
 * Records a check. Success (re)verifies. A conclusive failure of a verified guild starts, or continues, a grace
 * period; after VERIFICATION_GRACE_DAYS the badge is removed. Inconclusive failures (Blizzard down, roster hidden)
 * never count.
 */
async function applyRun(tx: Db, guild: GuildRow, run: VerificationRun, result: VerificationResult, actor: Actor, now: Date) {
  const { check } = run;
  const base = { verificationCheckedAt: now, verificationResult: result };
  if (check.ok) {
    const same = guild.verifiedAt && guild.verifiedCharacterId === check.character.id;
    await tx
      .update(guilds)
      .set({
        ...base,
        verifiedAt: same ? guild.verifiedAt : now,
        verifiedUserId: check.character.userId,
        verifiedCharacterId: check.character.id,
        verifiedCharacterName: check.character.name,
        verifiedRealmSlug: check.character.realmSlug,
        verifiedVia: "battlenet",
        verificationFailingSince: null,
        setup: sql`${guilds.setup} - 'founderNotGm'`,
      })
      .where(eq(guilds.id, guild.id));
    if (!same) {
      await recordAudit(tx, actor, {
        action: "guild.verify",
        targetType: "guild",
        targetId: guild.id,
        after: { character: check.character.name, realm: check.character.realmSlug, via: "battlenet", ruleset: guild.ruleset },
      });
    }
    return "verified" as const;
  }

  if (!guild.verifiedAt || !check.conclusive) {
    await tx.update(guilds).set(base).where(eq(guilds.id, guild.id));
    return guild.verifiedAt ? ("verified" as const) : ("unverified" as const);
  }

  const failingSince = guild.verificationFailingSince ?? now;
  if (now.getTime() - failingSince.getTime() >= VERIFICATION_GRACE_DAYS * DAY_MS) {
    await tx
      .update(guilds)
      .set({ ...base, ...CLEARED_VERIFICATION })
      .where(eq(guilds.id, guild.id));
    await recordAudit(tx, actor, {
      action: "guild.verification.lapse",
      targetType: "guild",
      targetId: guild.id,
      before: { character: guild.verifiedCharacterName, failingSince },
      after: { reason: check.reason },
    });
    return "lapsed" as const;
  }
  await tx
    .update(guilds)
    .set({ ...base, verificationFailingSince: failingSince })
    .where(eq(guilds.id, guild.id));
  if (!guild.verificationFailingSince) {
    await recordAudit(tx, actor, {
      action: "guild.verification.failing",
      targetType: "guild",
      targetId: guild.id,
      after: { reason: check.reason, graceDays: VERIFICATION_GRACE_DAYS },
    });
  }
  return "failing" as const;
}

async function loadGuild(db: Db, guildId: string) {
  const [guild] = await db.select().from(guilds).where(eq(guilds.id, guildId));
  if (!guild) throw new NotFoundError("Guild");
  return guild;
}

/** Admin "Check verification": runs the check now and records it. */
export async function verifyGuild(db: Db, actor: Actor, client: BlizzardClient, now = new Date()) {
  assertCan(actor, "guild.settings");
  const guild = await loadGuild(db, actor.guildId);
  const run = await runVerificationCheck(db, guild, client, { preferUserId: actor.userId, now });
  const result = toResult(run, await claimInfo(db, guild, run.check));
  const state = await db.transaction((tx) => applyRun(tx, guild, run, result, actor, now));
  const { check } = run;
  if (state !== "verified" && !check.ok && check.reason === "not_guild_master" && "character" in check && check.character?.userId === actor.userId) {
    await noteFounderNotGm(db, guild, { characterName: check.character.name, rank: check.rank ?? null }, now);
  }
  return { state, result };
}

/** Records that the guild's own admin is in the in-game guild but not its Guild Master, with an invite link for the GM. */
async function noteFounderNotGm(db: Db, guild: GuildRow, member: { characterName: string; rank: number | null }, now: Date) {
  await db
    .update(guilds)
    .set({
      setup: {
        ...guild.setup,
        inviteCode: guild.setup.inviteCode ?? randomBytes(9).toString("base64url"),
        founderNotGm: { ...member, checkedAt: now.toISOString() },
      },
    })
    .where(eq(guilds.id, guild.id));
}

async function freeUnverifiedName(tx: Db, identity: GuildIdentity): Promise<string> {
  for (let attempt = 1; attempt < 100; attempt++) {
    const candidate = unverifiedName(identity.name, attempt);
    const [taken] = await tx
      .select({ id: guilds.id })
      .from(guilds)
      .where(sameIdentity({ ...identity, name: candidate }));
    if (!taken) return candidate;
  }
  throw new DomainError("No se ha encontrado un nombre libre para la hermandad sin verificar. Contacta con el equipo de Guildbook.");
}

function appendNotice(existing: string | null, notice: string): string {
  return existing ? `${notice}\n\n${existing}` : notice;
}

/**
 * The in-game Guild Master takes their guild's name. Only the admin whose own linked character is Guild Master of
 * the in-game guild may do this, and the Blizzard check runs again first. If an unverified guild holds the name (same
 * region, faction and ruleset), it is renamed "Name (unverified)" and its admins get a notice; a verified holder is never
 * touched. Custom domains and subdomains don't move.
 */
export async function claimGuildName(db: Db, actor: Actor, client: BlizzardClient, now = new Date()) {
  assertCan(actor, "guild.settings");
  const guild = await loadGuild(db, actor.guildId);
  if (guild.verifiedAt) throw new DomainError("Esta hermandad ya está verificada.");
  const run = await runVerificationCheck(db, guild, client, { preferUserId: actor.userId, now });
  const { check } = run;
  if (check.ok) {
    await db.transaction((tx) => applyRun(tx, guild, run, toResult(run, null), actor, now));
    return { renamedHolder: null, name: guild.name };
  }
  if (check.reason !== "name_mismatch" || !("inGame" in check) || !check.inGame || !check.character) {
    throw new DomainError(run.message);
  }
  if (check.character.userId !== actor.userId) {
    throw new DomainError(`Solo el maestro de la hermandad (el dueño de ${check.character.name}) puede reclamar el nombre de la hermandad.`);
  }
  const name = cleanGuildName(check.inGame.name);
  const identity = { ...identityOf(guild), name };

  try {
    return await db.transaction(async (tx) => {
      const [holder] = await tx
        .select()
        .from(guilds)
        .where(and(sameIdentity(identity), ne(guilds.id, guild.id)))
        .for("update");
      let renamedHolder: string | null = null;
      if (holder) {
        if (holder.verifiedAt) {
          throw new DomainError(`${holder.name} is a verified guild on Guildbook. A verified guild's name can't be claimed.`);
        }
        renamedHolder = await freeUnverifiedName(tx, identity);
        const notice = `Una hermandad verificada reclamó el nombre «${holder.name}» (${describeIdentity(identity)}) el ${now.toISOString().slice(0, 10)}: su maestro de la hermandad demostró con Battle.net que dirige la hermandad del juego con ese nombre. Esta hermandad ha pasado a llamarse «${renamedHolder}». Tu subdominio, tus dominios propios, tus miembros y tu contenido no cambian. Puedes cambiar el nombre de la hermandad en Ajustes de la hermandad.`;
        await tx
          .update(guilds)
          .set({ name: renamedHolder, adminNotice: appendNotice(holder.adminNotice, notice) })
          .where(eq(guilds.id, holder.id));
        await recordAudit(tx, { guildId: holder.id, userId: actor.userId, membershipId: null, tier: "public" }, {
          action: "guild.name_claimed",
          targetType: "guild",
          targetId: holder.id,
          before: { name: holder.name },
          after: { name: renamedHolder, claimedByGuild: guild.slug },
        });
      }
      await tx
        .update(guilds)
        .set({
          name,
          verifiedAt: now,
          verifiedUserId: check.character!.userId,
          verifiedCharacterId: check.character!.id,
          verifiedCharacterName: check.character!.name,
          verifiedRealmSlug: check.character!.realmSlug,
          verifiedVia: "battlenet",
          verificationCheckedAt: now,
          verificationFailingSince: null,
          setup: sql`${guilds.setup} - 'founderNotGm'`,
          verificationResult: {
            verified: true,
            reason: null,
            message: `Verificada: ${check.character!.name} es maestro de la hermandad ${name} (${describeIdentity(identity)}).`,
            conclusive: true,
            characterName: check.character!.name,
            inGameGuildName: check.inGame!.name,
            claim: null,
          },
        })
        .where(eq(guilds.id, guild.id));
      await recordAudit(tx, actor, {
        action: "guild.claim_name",
        targetType: "guild",
        targetId: guild.id,
        before: { name: guild.name },
        after: { name, renamedHolder: holder ? { slug: holder.slug, from: holder.name, to: renamedHolder } : null },
      });
      await recordAudit(tx, actor, {
        action: "guild.verify",
        targetType: "guild",
        targetId: guild.id,
        after: { character: check.character!.name, realm: check.character!.realmSlug, via: "battlenet", ruleset: guild.ruleset },
      });
      return { renamedHolder, name };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("Otra hermandad ha cogido ese nombre en ese mismo momento. Vuelve a comprobarlo.");
    throw err;
  }
}

/** The subdomain a verified guild may claim: its name as a slug. Null when it has it already or it can't be one. */
export function claimableSlug(guild: { name: string; slug: string }): string | null {
  const desired = suggestSlug(guild.name);
  if (!desired || desired === guild.slug || slugProblem(desired)) return null;
  return desired;
}

/** Who holds the subdomain a verified guild could claim, and where that guild would move, for the admin panel. */
export async function getSlugClaim(
  db: Db,
  guild: {
    id: string;
    name: string;
    slug: string;
    verifiedAt: Date | null;
    gameVersion: GuildVersion;
    realmSlug: string | null;
    region: Region;
    faction: Faction;
    ruleset: Ruleset;
  },
) {
  if (!guild.verifiedAt) return null;
  const slug = claimableSlug(guild);
  if (!slug) return null;
  const [holder] = await db
    .select({
      name: guilds.name,
      verifiedAt: guilds.verifiedAt,
      gameVersion: guilds.gameVersion,
      realmSlug: guilds.realmSlug,
      region: guilds.region,
      faction: guilds.faction,
      ruleset: guilds.ruleset,
    })
    .from(guilds)
    .where(eq(guilds.slug, slug));
  if (holder?.verifiedAt) return null;
  const holderMovesTo = holder ? await relocationSlug(db, slug, holder, guild) : null;
  return { slug, holderName: holder?.name ?? null, holderMovesTo };
}

/**
 * A verified guild moves to the subdomain matching its name. If an unverified guild holds it, that guild moves to
 * a free subdomain naming what sets it apart (`slug-pvp`, `slug-horde`, `slug-eu`), else the first free `slug-2`,
 * and its admins get a notice. There are no redirects: the old subdomain now
 * belongs to the verified guild, and the verified guild's previous subdomain is released. Custom domains stay put.
 */
export async function claimGuildSlug(db: Db, actor: Actor, now = new Date()) {
  assertCan(actor, "guild.settings");
  try {
    return await db.transaction(async (tx) => {
      const [guild] = await tx.select().from(guilds).where(eq(guilds.id, actor.guildId)).for("update");
      if (!guild) throw new NotFoundError("Guild");
      if (!guild.verifiedAt) throw new DomainError("Solo las hermandades verificadas pueden reclamar un subdominio.");
      const slug = claimableSlug(guild);
      if (!slug) throw new DomainError("Tu hermandad ya usa el subdominio que corresponde a su nombre, o su nombre no puede ser un subdominio.");
      const [holder] = await tx.select().from(guilds).where(eq(guilds.slug, slug)).for("update");
      let movedHolderTo: string | null = null;
      if (holder) {
        if (holder.verifiedAt) throw new DomainError("Una hermandad verificada usa ese subdominio. No se puede reclamar.");
        movedHolderTo = await relocationSlug(tx, slug, holder, guild);
        const notice = `Una hermandad verificada reclamó el subdominio «${slug}» el ${now.toISOString().slice(0, 10)}: su maestro de la hermandad demostró con Battle.net que dirige la hermandad del juego «${guild.name}». El subdominio de esta hermandad ahora es «${movedHolderTo}». Actualiza los enlaces que hayas compartido. Tus dominios propios, tus miembros y tu contenido no cambian.`;
        await tx
          .update(guilds)
          .set({ slug: movedHolderTo, adminNotice: appendNotice(holder.adminNotice, notice) })
          .where(eq(guilds.id, holder.id));
        await recordAudit(tx, { guildId: holder.id, userId: actor.userId, membershipId: null, tier: "public" }, {
          action: "guild.slug_claimed",
          targetType: "guild",
          targetId: holder.id,
          before: { slug },
          after: { slug: movedHolderTo, claimedByGuild: guild.name },
        });
      }
      await tx.update(guilds).set({ slug }).where(eq(guilds.id, guild.id));
      await recordAudit(tx, actor, {
        action: "guild.claim_slug",
        targetType: "guild",
        targetId: guild.id,
        before: { slug: guild.slug },
        after: { slug, movedHolder: holder ? { name: holder.name, to: movedHolderTo } : null },
      });
      return { slug, previousSlug: guild.slug, movedHolderTo };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("Alguien ha cogido ese subdominio en ese mismo momento. Inténtalo de nuevo.");
    throw err;
  }
}

export async function dismissAdminNotice(db: Db, actor: Actor) {
  assertCan(actor, "guild.settings");
  await db.transaction(async (tx) => {
    const [before] = await tx.select({ adminNotice: guilds.adminNotice }).from(guilds).where(eq(guilds.id, actor.guildId));
    if (!before?.adminNotice) return;
    await tx.update(guilds).set({ adminNotice: null }).where(eq(guilds.id, actor.guildId));
    await recordAudit(tx, actor, {
      action: "guild.notice.dismiss",
      targetType: "guild",
      targetId: actor.guildId,
      before: { notice: before.adminNotice },
    });
  });
}

// --- Daily re-check ----------------------------------------------------------

export interface RecheckSummary {
  checked: number;
  verified: number;
  failing: number;
  lapsed: number;
  inconclusive: number;
}

/** Whether the member who verified the guild is still one of its active admins. */
async function verifierStillAdmin(db: Db, guild: GuildRow): Promise<boolean> {
  if (!guild.verifiedUserId) return false;
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(
      and(
        eq(memberships.guildId, guild.id),
        eq(memberships.userId, guild.verifiedUserId),
        eq(memberships.status, "active"),
        eq(ranks.tier, "admin"),
      ),
    );
  return Boolean(row);
}

/**
 * Cron: re-checks every verified guild's Guild Master character, in the guild's region (still rank 0 of an in-game
 * guild with the same name, faction and ruleset). Failures get VERIFICATION_GRACE_DAYS before the badge is removed; each step is audited.
 */
export async function recheckVerifiedGuilds(db: Db, client: BlizzardClient, now = new Date()): Promise<RecheckSummary> {
  const summary: RecheckSummary = { checked: 0, verified: 0, failing: 0, lapsed: 0, inconclusive: 0 };
  if (!battlenetEnabled(client.config)) return summary;
  const verified = await db.select().from(guilds).where(isNotNull(guilds.verifiedAt)).orderBy(asc(guilds.slug));
  for (const guild of verified) {
    summary.checked++;
    const identity = identityOf(guild);
    let check: VerificationRun["check"];
    if (!verificationSupported(identity.gameVersion)) {
      check = { ok: false, reason: "version_unsupported", conclusive: false };
    } else if (!(await verifierStillAdmin(db, guild))) {
      check = { ok: false, reason: "gm_left", conclusive: true };
    } else if (!guild.verifiedCharacterId || !guild.verifiedCharacterName || !guild.verifiedRealmSlug) {
      check = { ok: false, reason: "character_missing", conclusive: true };
    } else {
      check = await checkCharacter(client, identity, {
        id: guild.verifiedCharacterId,
        name: guild.verifiedCharacterName,
        realmSlug: guild.verifiedRealmSlug,
        userId: guild.verifiedUserId,
      });
    }
    const run = { check, message: describeCheck(check, identity) };
    const actor: Actor = { guildId: guild.id, userId: null, membershipId: null, tier: "public" };
    const state = await db.transaction((tx) => applyRun(tx, guild, run, toResult(run, null), actor, now));
    if (!check.ok && !check.conclusive) summary.inconclusive++;
    else if (state === "verified") summary.verified++;
    else if (state === "failing") summary.failing++;
    else if (state === "lapsed") summary.lapsed++;
  }
  return summary;
}

// --- Founders who aren't the Guild Master -------------------------------------

/** Characters checked against Blizzard for the founder's standing, to bound API calls at creation. */
const MAX_FOUNDER_CHECKS = 3;

export type FounderStanding =
  | { status: "guild_master"; characterName: string }
  | { status: "member"; characterName: string; rank: number | null }
  | { status: "unknown" };

/**
 * Right after a guild is founded: is the founder's linked character in the in-game guild, and is it the Guild Master?
 * A member who isn't gets a setup note (`setup.founderNotGm`) and a draft invite link to hand to the Guild Master,
 * who verifies once they have joined with an admin rank. Best effort: Blizzard failures leave the guild as it is.
 */
export async function recordFounderStanding(
  db: Db,
  guildId: string,
  userId: string,
  client: BlizzardClient,
  now = new Date(),
): Promise<FounderStanding> {
  const guild = await loadGuild(db, guildId);
  if (guild.verifiedAt || !isSupportedVersion(guild.gameVersion) || !battlenetEnabled(client.config)) return { status: "unknown" };
  const [link] = await db.select({ characters: battlenetLinks.characters }).from(battlenetLinks).where(eq(battlenetLinks.userId, userId));
  if (!link) return { status: "unknown" };
  const identity = identityOf(guild);
  const eligible = charactersForGuild(link.characters, { ...identity, realmSlugs: [] });
  const named = (c: BattlenetCharacterSnapshot) => (c.guildName && sameGuildName(c.guildName, guild.name) ? 0 : 1);
  let member: { characterName: string; rank: number | null } | null = null;
  for (const c of [...eligible].sort((a, b) => named(a) - named(b)).slice(0, MAX_FOUNDER_CHECKS)) {
    const check = await checkGuildMembership(client, identity, { id: c.id, name: c.name, realmSlug: c.realmSlug, userId });
    if (check.status !== "member") continue;
    if (check.rank === 0) return { status: "guild_master", characterName: c.name };
    member ??= { characterName: c.name, rank: check.rank };
  }
  if (!member) return { status: "unknown" };
  await noteFounderNotGm(db, guild, member, now);
  return { status: "member", ...member };
}

/**
 * `recordFounderStanding` for an admin of an unverified guild whose Battle.net characters just changed (link, refresh,
 * import): a founder who links Battle.net only after creating the guild is otherwise never checked. Best effort.
 */
export async function recheckAdminStanding(db: Db, actor: Actor, client: BlizzardClient, now = new Date()): Promise<FounderStanding> {
  if (actor.tier !== "admin" || !actor.userId) return { status: "unknown" };
  try {
    return await recordFounderStanding(db, actor.guildId, actor.userId, client, now);
  } catch (err) {
    console.warn(`[guild.standing] admin standing check failed: ${err instanceof Error ? err.message : "unknown error"}`);
    return { status: "unknown" };
  }
}

/** The verified Guild Master's membership when it isn't on the guild's top rank yet, for the hand-over offer. */
export async function guildMasterHandover(db: Db, guild: Pick<GuildRow, "id" | "verifiedAt" | "verifiedUserId" | "verifiedCharacterName">) {
  if (!guild.verifiedAt || !guild.verifiedUserId) return null;
  const ladder = await db.select().from(ranks).where(eq(ranks.guildId, guild.id)).orderBy(asc(ranks.sortOrder));
  const top = ladder[0];
  if (!top) return null;
  const [gm] = await db
    .select({ id: memberships.id, rankId: memberships.rankId })
    .from(memberships)
    .where(and(eq(memberships.guildId, guild.id), eq(memberships.userId, guild.verifiedUserId), eq(memberships.status, "active")));
  if (!gm || gm.rankId === top.id) return null;
  return { membershipId: gm.id, topRank: { id: top.id, name: top.name }, characterName: guild.verifiedCharacterName };
}

/**
 * Hands the guild's top rank to the verified in-game Guild Master (a founder who isn't the Guild Master does this
 * once they have verified). Other members keep their ranks; the founder can step down under Members afterwards.
 */
export async function promoteVerifiedGuildMaster(db: Db, actor: Actor) {
  assertCan(actor, "guild.settings");
  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    const handover = await guildMasterHandover(tx, guild);
    if (!handover) throw new DomainError("El maestro de la hermandad verificado ya tiene el rango más alto, o la hermandad no está verificada.");
    await tx.update(memberships).set({ rankId: handover.topRank.id, updatedAt: sql`now()` }).where(eq(memberships.id, handover.membershipId));
    await recordAudit(tx, actor, {
      action: "member.assignRank",
      targetType: "membership",
      targetId: handover.membershipId,
      after: { rankId: handover.topRank.id, rankName: handover.topRank.name, characterName: handover.characterName, reason: "verified_guild_master" },
    });
    return { rankName: handover.topRank.name, characterName: handover.characterName };
  });
}
