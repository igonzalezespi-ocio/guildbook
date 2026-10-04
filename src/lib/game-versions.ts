import { type Region, REGION_TAGS, type Ruleset, WOWF_LAUNCH_DATE } from "@/lib/game";

/**
 * The game a guild lives in. It is part of the guild's identity and never changes. Every value exists in the
 * `game_version` database enum (migration 0020) so later versions need no enum migration, but only
 * `SUPPORTED_GUILD_VERSIONS` can be chosen.
 */
export const GUILD_VERSIONS = ["forever", "anniversary", "era", "seasonal", "progression"] as const;
export type GuildVersion = (typeof GUILD_VERSIONS)[number];

export const SUPPORTED_GUILD_VERSIONS = ["forever", "anniversary"] as const satisfies readonly GuildVersion[];
export type SupportedGuildVersion = (typeof SUPPORTED_GUILD_VERSIONS)[number];

export const DEFAULT_GUILD_VERSION: SupportedGuildVersion = "forever";

/** The content a version runs. Level cap, profession cap, bosses and rotations follow the expansion, not the version. */
export const EXPANSIONS = ["classic", "tbc"] as const;
export type Expansion = (typeof EXPANSIONS)[number];

export const EXPANSION_INFO: Record<Expansion, { label: string; maxLevel: number; maxProfessionSkill: number }> = {
  classic: { label: "Classic", maxLevel: 60, maxProfessionSkill: 300 },
  tbc: { label: "The Burning Crusade", maxLevel: 70, maxProfessionSkill: 375 },
};

export interface VersionInfo {
  label: string;
  /** Badge text. */
  short: string;
  expansion: Expansion;
  /** Whether guilds live on realms (Anniversary) rather than on a ruleset alone (Forever). */
  realms: boolean;
  /** Characters have a surname (WoW: Forever only). */
  surnames: boolean;
  /** Day the version opens (YYYY-MM-DD, UTC), or null when it is already live. */
  launchDate: string | null;
  /** Suffix that tells two guilds with the same name apart across versions (`oathbound-tbc`). */
  slugSuffix: string;
}

export const VERSION_INFO: Record<GuildVersion, VersionInfo> = {
  forever: { label: "WoW: Forever", short: "Forever", expansion: "classic", realms: false, surnames: true, launchDate: WOWF_LAUNCH_DATE, slugSuffix: "forever" },
  anniversary: { label: "TBC Anniversary", short: "TBC", expansion: "tbc", realms: true, surnames: false, launchDate: null, slugSuffix: "tbc" },
  era: { label: "Classic Era", short: "Era", expansion: "classic", realms: true, surnames: false, launchDate: null, slugSuffix: "era" },
  seasonal: { label: "Temporada de descubrimiento", short: "SoD", expansion: "classic", realms: true, surnames: false, launchDate: null, slugSuffix: "sod" },
  progression: { label: "Classic con progresión", short: "Progresión", expansion: "tbc", realms: true, surnames: false, launchDate: null, slugSuffix: "prog" },
};

export function isSupportedVersion(value: unknown): value is SupportedGuildVersion {
  return (SUPPORTED_GUILD_VERSIONS as readonly unknown[]).includes(value);
}

export const expansionOf = (version: GuildVersion): Expansion => VERSION_INFO[version].expansion;
export const maxLevelFor = (version: GuildVersion) => EXPANSION_INFO[expansionOf(version)].maxLevel;
export const maxProfessionSkillFor = (version: GuildVersion) => EXPANSION_INFO[expansionOf(version)].maxProfessionSkill;
export const hasSurnames = (version: GuildVersion) => VERSION_INFO[version].surnames;

/** Whether the version is open in game at `now`. Versions without a launch date are already live. */
export function versionHasLaunched(version: GuildVersion, now: Date): boolean {
  const date = VERSION_INFO[version].launchDate;
  return !date || now >= new Date(`${date}T00:00:00Z`);
}

/** The version's launch day as "4 nov", or null when it has no launch date. */
export function versionLaunchLabel(version: GuildVersion): string | null {
  const date = VERSION_INFO[version].launchDate;
  if (!date) return null;
  return new Intl.DateTimeFormat("es-ES", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

/** A realm a guild can live on, for versions with realms. */
export interface Realm {
  slug: string;
  name: string;
  region: Region;
  ruleset: Ruleset;
}

/**
 * TBC Anniversary realms (September 2026): Blizzard's Anniversary realm announcements and the Warcraft Wiki realm
 * list. Maladath is the Oceanic realm, served from the US API region (`profile-classicann-us`). The Anniversary
 * Hardcore realms (Doomhowl, Soulseeker) stayed on Classic Era (`classic1x`) rather than moving to TBC, so they
 * aren't listed. Check against `/data/wow/realm/index?namespace=dynamic-classicann-{us,eu}` when adding realms.
 */
export const ANNIVERSARY_REALMS: readonly Realm[] = [
  { slug: "dreamscythe", name: "Dreamscythe", region: "us", ruleset: "normal" },
  { slug: "nightslayer", name: "Nightslayer", region: "us", ruleset: "pvp" },
  { slug: "maladath", name: "Maladath", region: "us", ruleset: "pvp" },
  { slug: "thunderstrike", name: "Thunderstrike", region: "eu", ruleset: "normal" },
  { slug: "spineshatter", name: "Spineshatter", region: "eu", ruleset: "pvp" },
];

const REALMS: Partial<Record<GuildVersion, readonly Realm[]>> = { anniversary: ANNIVERSARY_REALMS };

/** The version's realms, optionally in one region. Empty for versions without realms. */
export function realmsFor(version: GuildVersion, region?: Region): Realm[] {
  return (REALMS[version] ?? []).filter((r) => !region || r.region === region);
}

export function findRealm(version: GuildVersion, slug: string | null | undefined): Realm | null {
  if (!slug) return null;
  return (REALMS[version] ?? []).find((r) => r.slug === slug) ?? null;
}

/** "Dreamscythe (US)", or the raw slug for a realm no longer in the list. */
export function realmLabel(version: GuildVersion, slug: string, region?: Region): string {
  const realm = findRealm(version, slug);
  const name = realm?.name ?? slug;
  const tag = realm?.region ?? region;
  return tag ? `${name} (${REGION_TAGS[tag]})` : name;
}
