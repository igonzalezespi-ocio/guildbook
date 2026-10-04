import { FACTION_LABELS, type Faction, REGION_LABELS, type Region, RULESET_INFO, type Ruleset } from "@/lib/game";
import { type GuildVersion, realmLabel, VERSION_INFO } from "@/lib/game-versions";

/**
 * A guild's identity on Guildbook is (game version, name, region, realm, faction, ruleset). Game versions and
 * Battle.net regions are separate worlds. WoW: Forever has no realms (`realmSlug` is null) and each ruleset is its own
 * world; TBC Anniversary guilds live on a realm, whose type sets the ruleset. Factions can't share a guild.
 */
export interface GuildIdentity {
  gameVersion: GuildVersion;
  realmSlug: string | null;
  name: string;
  region: Region;
  faction: Faction;
  ruleset: Ruleset;
}

/** How a guild name is stored: Unicode-normalised, typographic apostrophes straightened, whitespace collapsed. */
export function cleanGuildName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u02BC\u0060\u00B4]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The comparison key for names: case-insensitive, as the database's unique index on lower(name) is. */
export function normalizeGuildName(name: string): string {
  return cleanGuildName(name).toLowerCase();
}

export function sameGuildName(a: string, b: string): boolean {
  return normalizeGuildName(a) === normalizeGuildName(b);
}

type DescribedIdentity = Pick<GuildIdentity, "region" | "faction" | "ruleset"> & Partial<Pick<GuildIdentity, "gameVersion" | "realmSlug">>;

/**
 * "Americas, Horde, Normal" for a WoW: Forever guild; "TBC Anniversary, Dreamscythe (US), Horde" for a guild on a
 * realm, whose ruleset the realm implies.
 */
export function describeIdentity(identity: DescribedIdentity): string {
  const version = identity.gameVersion ?? "forever";
  if (VERSION_INFO[version].realms && identity.realmSlug) {
    return `${VERSION_INFO[version].label}, ${realmLabel(version, identity.realmSlug, identity.region)}, ${FACTION_LABELS[identity.faction]}`;
  }
  return `${REGION_LABELS[identity.region]}, ${FACTION_LABELS[identity.faction]}, ${RULESET_INFO[identity.ruleset].label}`;
}

/** Name used for an unverified guild that lost its name to a verified claim: "Name (unverified)", then "(unverified 2)". */
export function unverifiedName(name: string, attempt: number): string {
  return attempt <= 1 ? `${name} (sin verificar)` : `${name} (sin verificar ${attempt})`;
}

/** Days of failed daily checks before a verified guild loses its badge. */
export const VERIFICATION_GRACE_DAYS = 7;
