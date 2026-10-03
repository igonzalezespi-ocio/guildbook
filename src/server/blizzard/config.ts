import { REGIONS, type Region, RULESETS, type Ruleset } from "@/lib/game";
import type { SupportedGuildVersion } from "@/lib/game-versions";
import { isProductionRuntime } from "@/lib/runtime-env";

export { REGIONS, type Region };

/**
 * Namespaces are stored as templates with a `{region}` placeholder and resolved per region with `namespaceFor`.
 * Env values may be templates (`profile-classic1x-{region}`), region-agnostic bases (`profile-classic1x`, which gets
 * `-{region}` appended) or, as before regions, concrete names (`profile-classic1x-us`, whose region suffix is replaced).
 */
export interface BlizzardConfig {
  /** Default region: item lookups (Game Data) and the region recorded on a link. */
  region: Region;
  /** Regions read when linking; each has its own characters (BATTLENET_REGIONS, default every supported region). */
  regions: Region[];
  /**
   * Profile API namespace template WoW: Forever characters are read from. Blizzard hasn't published one yet: likely
   * `profile-classic1x-{region}` (shared with Classic Era), possibly `profile-classic-{region}`. Characters here on a
   * known pre-Forever realm are never treated as Forever characters (see `isForeverCharacter`).
   */
  profileNamespace: string;
  /**
   * Every profile namespace template read when linking, so an account without Forever characters can be told what it
   * does have. Always includes `profileNamespace`.
   */
  scanNamespaces: string[];
  /**
   * Game Data namespace template for item names and icons. Classic Era uses `static-classic1x-{region}`; WoW: Forever's
   * is unknown until launch. Item data is only a gap-filler behind imports and the addon.
   */
  staticNamespace: string;
  locale: string;
  /**
   * WoW: Forever realm slugs, each optionally region-prefixed (`eu:realm-slug`); unprefixed slugs apply to every
   * region. When a region has any, only characters on those realms (in `profileNamespace`) count as Forever characters
   * there, even realms otherwise known as Classic ones. None means any realm that isn't a known Classic one.
   */
  realmSlugs: string[];
  /**
   * Game Data namespace template for realm lookups (realm type to ruleset). Defaults to the profile namespace's
   * `dynamic-` twin, e.g. `profile-classic1x-{region}` to `dynamic-classic1x-{region}`.
   */
  dynamicNamespace: string;
  /**
   * Explicit realm to ruleset map (BATTLENET_REALM_RULESETS), checked before Blizzard's realm type. Keys are `slug`
   * (every region) or `region:slug`.
   */
  realmRulesets: Record<string, Ruleset>;
  /** In-game guild used for one-request roster syncs, when both are set; it lives in `guildRegion`. */
  guildRealmSlug: string | null;
  guildSlug: string | null;
  guildRegion: Region;
  clientId: string | null;
  clientSecret: string | null;
  /** Serve fixture characters instead of calling Blizzard (dev and e2e). */
  mock: boolean;
  /**
   * Namespace templates per supported game version (read through `versionNamespaces`, which takes Forever's from
   * `profileNamespace`, `dynamicNamespace` and `staticNamespace`). `anniversary` reads `profile-classicann-{region}` and its `dynamic-`/`static-` twins
   * (BATTLENET_ANNIVERSARY_{PROFILE,DYNAMIC,STATIC}_NAMESPACE override them).
   */
  versions: Record<SupportedGuildVersion, VersionNamespaces>;
}

export interface VersionNamespaces {
  profile: string;
  dynamic: string;
  static: string;
}

/** The namespace templates Blizzard serves a version's characters, realms and items from. */
export function versionNamespaces(
  config: Pick<BlizzardConfig, "versions" | "profileNamespace" | "dynamicNamespace" | "staticNamespace">,
  version: SupportedGuildVersion,
): VersionNamespaces {
  if (version === "forever") {
    return { profile: config.profileNamespace, dynamic: config.dynamicNamespace, static: config.staticNamespace };
  }
  return config.versions[version];
}

const DEFAULT_NAMESPACE = "profile-classic1x-{region}";
const DEFAULT_STATIC_NAMESPACE = "static-classic1x-{region}";
const ANNIVERSARY_PROFILE_NAMESPACE = "profile-classicann-{region}";
const DEFAULT_SCAN_NAMESPACES = [
  "profile-classic1x-{region}",
  "profile-classicann-{region}",
  "profile-classic-{region}",
  "profile-{region}",
];

/** Blizzard's API region codes, including ones Guildbook doesn't expose yet, so their suffixes are recognised. */
const REGION_SUFFIX = /-(us|eu|kr|tw|cn)$/;

function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

/** A namespace env value as a `{region}` template (see `BlizzardConfig`). */
export function namespaceTemplate(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.includes("{region}")) return v;
  if (REGION_SUFFIX.test(v)) return v.replace(REGION_SUFFIX, "-{region}");
  return `${v}-{region}`;
}

export function namespaceFor(template: string, region: Region): string {
  return template.replaceAll("{region}", region);
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** `realm-a:pvp,eu:realm-b:normal` to a map keyed `slug` or `region:slug`; unknown rulesets and regions are ignored. */
function realmRulesetMap(value: string | undefined): Record<string, Ruleset> {
  const out: Record<string, Ruleset> = {};
  for (const entry of list(value)) {
    const parts = entry.split(":").map((s) => s.trim());
    const ruleset = parts.pop();
    const key = parts.join(":");
    if (!ruleset || !(RULESETS as readonly string[]).includes(ruleset)) continue;
    if (parts.length === 1 && parts[0]) out[key] = ruleset as Ruleset;
    if (parts.length === 2 && isRegion(parts[0]!) && parts[1]) out[key] = ruleset as Ruleset;
  }
  return out;
}

/** Realm allowlist entries: `slug` or `region:slug`; entries for unknown regions are dropped. */
function realmList(value: string | undefined): string[] {
  return list(value).filter((entry) => {
    const [region, slug, extra] = entry.split(":");
    return slug === undefined ? Boolean(region) : Boolean(region && isRegion(region) && slug && extra === undefined);
  });
}

/** The Forever realm allowlist for one region: its prefixed entries plus the unprefixed ones. */
export function realmSlugsFor(config: { realmSlugs: readonly string[] }, region: Region): string[] {
  return config.realmSlugs.flatMap((entry) => {
    const [a, b] = entry.split(":");
    if (b === undefined) return [a!];
    return a === region ? [b] : [];
  });
}

/** A realm's configured ruleset: the region-specific entry first, then the all-regions one. */
export function configuredRealmRuleset(
  config: Pick<BlizzardConfig, "realmRulesets">,
  region: Region,
  realmSlug: string,
): Ruleset | undefined {
  const slug = realmSlug.toLowerCase();
  return config.realmRulesets[`${region}:${slug}`] ?? config.realmRulesets[slug];
}

function regionOr(value: string | undefined, fallback: Region): Region {
  const v = (value ?? "").trim().toLowerCase();
  return isRegion(v) ? v : fallback;
}

export function blizzardConfigFromEnv(env: Record<string, string | undefined> = process.env): BlizzardConfig {
  const region = regionOr(env.BATTLENET_REGION, "us");
  const regions = list(env.BATTLENET_REGIONS).filter(isRegion);
  const mock = env.BATTLENET_MOCK === "1";
  if (mock && isProductionRuntime(env)) {
    throw new Error("BATTLENET_MOCK must never be enabled in production.");
  }
  const profileNamespace = namespaceTemplate(env.BATTLENET_PROFILE_NAMESPACE?.trim() || DEFAULT_NAMESPACE);
  const staticNamespace = namespaceTemplate(env.BATTLENET_STATIC_NAMESPACE?.trim() || DEFAULT_STATIC_NAMESPACE);
  const dynamicNamespace = namespaceTemplate(env.BATTLENET_DYNAMIC_NAMESPACE?.trim() || profileNamespace.replace(/^profile-/, "dynamic-"));
  const annProfile = namespaceTemplate(env.BATTLENET_ANNIVERSARY_PROFILE_NAMESPACE?.trim() || ANNIVERSARY_PROFILE_NAMESPACE);
  const anniversary: VersionNamespaces = {
    profile: annProfile,
    dynamic: namespaceTemplate(env.BATTLENET_ANNIVERSARY_DYNAMIC_NAMESPACE?.trim() || annProfile.replace(/^profile-/, "dynamic-")),
    static: namespaceTemplate(env.BATTLENET_ANNIVERSARY_STATIC_NAMESPACE?.trim() || annProfile.replace(/^profile-/, "static-")),
  };
  const scan = list(env.BATTLENET_SCAN_NAMESPACES);
  return {
    region,
    regions: regions.length > 0 ? [...new Set(regions)] : [...REGIONS],
    profileNamespace,
    scanNamespaces: [
      ...new Set([profileNamespace, anniversary.profile, ...(scan.length > 0 ? scan : DEFAULT_SCAN_NAMESPACES).map(namespaceTemplate)]),
    ],
    staticNamespace,
    locale: env.BATTLENET_LOCALE?.trim() || "en_US",
    realmSlugs: realmList(env.BATTLENET_REALMS),
    dynamicNamespace,
    versions: { forever: { profile: profileNamespace, dynamic: dynamicNamespace, static: staticNamespace }, anniversary },
    realmRulesets: realmRulesetMap(env.BATTLENET_REALM_RULESETS),
    guildRealmSlug: env.BATTLENET_GUILD_REALM?.trim().toLowerCase() || null,
    guildSlug: env.BATTLENET_GUILD_SLUG?.trim().toLowerCase() || null,
    guildRegion: regionOr(env.BATTLENET_GUILD_REGION, "us"),
    clientId: env.BATTLENET_CLIENT_ID?.trim() || null,
    clientSecret: env.BATTLENET_CLIENT_SECRET?.trim() || null,
    mock,
  };
}

/** OAuth (authorize, token, userinfo) is global: one host for every region outside China. */
export function oauthHost(): string {
  return "https://oauth.battle.net";
}

export function apiHost(region: Region): string {
  return `https://${region}.api.blizzard.com`;
}

/** Whether Battle.net linking can work at all: real credentials, or mock mode. */
export function battlenetEnabled(config: BlizzardConfig): boolean {
  return config.mock || Boolean(config.clientId && config.clientSecret);
}
