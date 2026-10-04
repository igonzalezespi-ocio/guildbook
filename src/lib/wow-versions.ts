/**
 * Which World of Warcraft game a Battle.net character belongs to. Blizzard keeps each game's characters in a
 * separate profile namespace, and Classic Era, Hardcore and Season of Discovery realms share one
 * (`profile-classic1x-*`), so the realm decides between them.
 */
export const GAME_VERSIONS = ["forever", "era", "hardcore", "seasonal", "anniversary", "progression", "retail", "unknown"] as const;
export type GameVersion = (typeof GAME_VERSIONS)[number];

export const GAME_VERSION_LABELS: Record<GameVersion, string> = {
  forever: "WoW: Forever",
  era: "Classic Era",
  hardcore: "Classic Hardcore",
  seasonal: "Temporada de descubrimiento",
  anniversary: "TBC Anniversary",
  progression: "Classic con progresión",
  retail: "World of Warcraft (retail)",
  unknown: "otro",
};

export type NamespaceFamily = "classic1x" | "classicann" | "classic" | "retail" | "other";

/** `profile-classic1x-us` to `classic1x`, `profile-us` to `retail`. */
export function namespaceFamily(namespace: string): NamespaceFamily {
  const m = namespace.toLowerCase().match(/^(?:profile|dynamic|static)-(?:([a-z0-9]+)-)?([a-z]{2})$/);
  if (!m) return "other";
  const flavor = m[1];
  if (!flavor) return "retail";
  if (flavor === "classic1x" || flavor === "classicann" || flavor === "classic") return flavor;
  return "other";
}

/**
 * Realms that existed before WoW: Forever, from the Game Data realm index (`dynamic-classic1x-*`, all regions,
 * September 2026). The API labels Hardcore realms "Classic Era", so those are listed by hand.
 */
const HARDCORE_REALMS = new Set([
  "skull-rock",
  "defias-pillager",
  "doomhowl",
  "stitches",
  "nekrosh",
  "soulseeker",
  "makgora",
  "teremus",
  "voidwalker",
]);

const SEASONAL_REALMS = new Set([
  "chaos-bolt",
  "crusader-strike",
  "lava-lash",
  "living-flame",
  "lone-wolf",
  "wild-growth",
  "penance-au",
  "shadowstrike-au",
  "penance-season",
  "shadowstrike-season",
]);

const ERA_REALMS = new Set([
  // US and Oceanic
  "anathema", "arcanite-reaper", "arugal", "ashkandi", "atiesh", "azuresong", "benediction", "bigglesworth",
  "blaumeux", "bloodsail-buccaneers", "deviate-delight", "earthfury", "faerlina", "fairbanks", "felstriker",
  "grobbulus", "heartseeker", "herod", "incendius", "kirtonos", "kromcrush", "kurinnaxx", "loatheb", "mankrik",
  "myzrael", "netherwind", "old-blanchy", "pagle", "rattlegore", "remulos", "skeram", "smolderweb", "stalagg",
  "sulfuras", "sulthraze", "thalnos", "thunderfury", "westfall", "whitemane", "windseeker", "yojamba",
  // Europe
  "amnennar", "ashbringer", "auberdine", "bloodfang", "celebras", "chromie-ru", "dragonfang", "dragons-call",
  "dreadmist", "earthshaker", "everlook", "finkle", "firemaw", "flamegor-ru", "flamelash", "gandling", "gehennas",
  "golemagg", "harbinger-of-doom-ru", "heartstriker", "hydraxian-waterlords", "judgement", "lakeshire", "lucifron",
  "mandokir", "mirage-raceway", "mograine", "nethergarde-keep", "noggenfogger", "patchwerk", "pyrewood-village",
  "razorfen", "razorgore", "rhokdelar-ru", "shazzrah", "skullflame", "stonespine", "sulfuron", "ten-storms",
  "transcendence", "venoxis", "wyrmthalak-ru", "zandalar-tribe",
  // Korea and Taiwan
  "hillsbrad", "iceblood", "lokholar", "ragnaros", "shimmering-flats", "slipkiks-savvy", "ivus", "maraudon",
]);

const ANNIVERSARY_REALMS = new Set([
  "dreamscythe", "nightslayer", "maladath", "spineshatter", "thunderstrike", "anniversary", "fengus-ferocity",
  "moldars-moxie",
]);

const PROGRESSION_REALMS = new Set([
  "atiesh", "myzrael", "old-blanchy", "azuresong", "mankrik", "pagle", "ashkandi", "westfall", "whitemane", "faerlina",
  "grobbulus", "bloodsail-buccaneers", "remulos-au", "arugal-au", "yojamba-au", "skyfury", "sulfuras", "windseeker",
  "benediction", "earthfury", "maladath", "angerforge", "eranikus", "nazgrim", "galakras", "raden", "lei-shen",
  "immerseus", "everlook", "auberdine", "lakeshire", "chromie", "pyrewood-village", "mirage-raceway", "razorfen",
  "nethergarde-keep", "sulfuron", "golemagg", "patchwerk", "firemaw", "flamegor", "gehennas", "venoxis",
  "hydraxian-waterlords", "mograine", "amnennar", "ashbringer", "transcendence", "earthshaker", "giantstalker",
  "mandokir", "thekal", "jindo", "shekzeer", "garalon", "norushen", "hoptallus", "ook-ook", "shimmering-flats",
  "lokholar", "iceblood", "ragnaros", "frostmourne", "maraudon", "ivus", "wushoolay", "zeliek", "arathi-basin",
  "murloc",
]);

/** The pre-Forever game a character on this namespace and realm belongs to, or `unknown` for a realm we don't know. */
export function knownGameVersion(namespace: string, realmSlug: string): GameVersion {
  const realm = realmSlug.toLowerCase();
  switch (namespaceFamily(namespace)) {
    case "classic1x":
      if (HARDCORE_REALMS.has(realm)) return "hardcore";
      if (SEASONAL_REALMS.has(realm)) return "seasonal";
      if (ERA_REALMS.has(realm)) return "era";
      return "unknown";
    case "classicann":
      return ANNIVERSARY_REALMS.has(realm) ? "anniversary" : "unknown";
    case "classic":
      return PROGRESSION_REALMS.has(realm) ? "progression" : "unknown";
    case "retail":
      return "retail";
    case "other":
      return "unknown";
  }
}

/**
 * Whether a character counts as a WoW: Forever character. It must be in the Forever profile namespace, and then:
 * with a realm allowlist, on one of those realms (the allowlist is an explicit statement that they are Forever
 * realms); without one, on a realm that isn't a known Classic Era, Hardcore, Seasonal, Anniversary or progression
 * realm, and never on retail.
 */
export function isForeverCharacter(
  character: { namespace: string; realmSlug: string },
  forever: { namespace: string; realmSlugs: readonly string[] },
): boolean {
  if (character.namespace !== forever.namespace) return false;
  const realm = character.realmSlug.toLowerCase();
  if (forever.realmSlugs.length > 0) return forever.realmSlugs.includes(realm);
  return knownGameVersion(character.namespace, realm) === "unknown" && namespaceFamily(character.namespace) !== "retail";
}
