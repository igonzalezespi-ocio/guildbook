export const CLASSES = [
  "warrior",
  "paladin",
  "hunter",
  "rogue",
  "priest",
  "shaman",
  "mage",
  "warlock",
  "druid",
] as const;
export type WowClass = (typeof CLASSES)[number];

export const CLASS_INFO: Record<WowClass, { label: string; color: string; specs: readonly string[] }> = {
  warrior: { label: "Guerrero", color: "#C69B6D", specs: ["Arms", "Fury", "Protection"] },
  paladin: { label: "Paladín", color: "#F48CBA", specs: ["Holy", "Protection", "Retribution"] },
  hunter: { label: "Cazador", color: "#AAD372", specs: ["Beast Mastery", "Marksmanship", "Survival"] },
  rogue: { label: "Pícaro", color: "#FFF468", specs: ["Assassination", "Combat", "Subtlety"] },
  priest: { label: "Sacerdote", color: "#FFFFFF", specs: ["Discipline", "Holy", "Shadow"] },
  shaman: { label: "Chamán", color: "#0070DD", specs: ["Elemental", "Enhancement", "Restoration"] },
  mage: { label: "Mago", color: "#3FC7EB", specs: ["Arcane", "Fire", "Frost"] },
  warlock: { label: "Brujo", color: "#8788EE", specs: ["Affliction", "Demonology", "Destruction"] },
  druid: { label: "Druida", color: "#FF7C0A", specs: ["Balance", "Feral", "Restoration"] },
};

/** Spanish (es-ES client) display name of a spec. The stored value stays the English key above. */
export const SPEC_LABELS: Record<string, string> = {
  Arms: "Armas",
  Fury: "Furia",
  Protection: "Protección",
  Holy: "Sagrado",
  Retribution: "Reprensión",
  "Beast Mastery": "Dominio de bestias",
  Marksmanship: "Puntería",
  Survival: "Supervivencia",
  Assassination: "Asesinato",
  Combat: "Combate",
  Subtlety: "Sutileza",
  Discipline: "Disciplina",
  Shadow: "Sombra",
  Elemental: "Elemental",
  Enhancement: "Mejora",
  Restoration: "Restauración",
  Arcane: "Arcano",
  Fire: "Fuego",
  Frost: "Escarcha",
  Affliction: "Aflicción",
  Demonology: "Demonología",
  Destruction: "Destrucción",
  Balance: "Equilibrio",
  Feral: "Feral",
};
export const specLabel = (spec: string): string => SPEC_LABELS[spec] ?? spec;

export function isValidSpec(wowClass: WowClass, spec: string): boolean {
  return CLASS_INFO[wowClass].specs.includes(spec);
}

export const ROLES = ["tank", "healer", "melee", "ranged"] as const;
export type RaidRole = (typeof ROLES)[number];
export const ROLE_LABELS: Record<RaidRole, string> = {
  tank: "Tanque",
  healer: "Sanador",
  melee: "DPS cuerpo a cuerpo",
  ranged: "DPS a distancia",
};

/** "Name Surname", or just the name where the game has no surnames (anything but WoW: Forever). */
export const fullName = (name: string, surname: string | null | undefined) => (surname ? `${name} ${surname}` : name);

export const FACTIONS = ["alliance", "horde"] as const;
export type Faction = (typeof FACTIONS)[number];
export const FACTION_LABELS: Record<Faction, string> = { alliance: "Alianza", horde: "Horda" };

/**
 * Battle.net regions Guildbook supports. Regions are separate worlds: characters, guilds and names exist per region,
 * so a guild belongs to exactly one. Values are Blizzard's API region codes; Korea (`kr`) and Taiwan (`tw`) can be
 * added here (and to the `region` database enum) later.
 */
export const REGIONS = ["us", "eu"] as const;
export type Region = (typeof REGIONS)[number];
export const REGION_LABELS: Record<Region, string> = { us: "América", eu: "Europa" };
/** Compact tag for character lists. */
export const REGION_TAGS: Record<Region, string> = { us: "US", eu: "EU" };
export const REGION_INFO: Record<Region, { label: string; description: string }> = {
  us: { label: "América", description: "Norteamérica, Sudamérica y Oceanía" },
  eu: { label: "Europa", description: "Europa, Rusia y Oriente Medio" },
};

/**
 * WoW: Forever rulesets. Forever has no realms: players pick a ruleset instead, and each ruleset is its own
 * ecosystem (no cross-ruleset grouping, factions still separate), so a guild belongs to exactly one.
 * Source: Blizzard, "Choose Your Ruleset in World of Warcraft: Forever"
 * (https://news.blizzard.com/en-us/article/24302070/choose-your-ruleset-in-world-of-warcraft-forever, September 2026).
 * Normal, PvP and Roleplaying launch on Nov 4, 2026; Hardcore arrives "sometime after launch".
 * Correct this list (and `RULESET_BY_REALM_TYPE`) here if Blizzard changes it.
 */
export const RULESETS = ["normal", "pvp", "rp", "hardcore"] as const;
export type Ruleset = (typeof RULESETS)[number];
export const RULESET_INFO: Record<Ruleset, { label: string; description: string; note?: string }> = {
  normal: { label: "Normal", description: "Misiones y cooperación; JcJ cuando tú quieras" },
  pvp: { label: "JcJ", description: "Conflicto en el mundo abierto en territorio en disputa" },
  rp: { label: "Rol", description: "Para quienes se sumergen en la fantasía de Azeroth" },
  hardcore: { label: "Hardcore", description: "Una sola vida; la muerte tiene consecuencias duraderas", note: "Abre después del lanzamiento" },
};

/**
 * Blizzard's Game Data realm `type.type` for each ruleset. Forever's realm types aren't published yet; these are
 * the values Classic realms use today. `BATTLENET_REALM_RULESETS` overrides them per realm without a code change.
 */
export const RULESET_BY_REALM_TYPE: Record<string, Ruleset> = {
  NORMAL: "normal",
  PVE: "normal",
  PVP: "pvp",
  RP: "rp",
  ROLEPLAYING: "rp",
  HARDCORE: "hardcore",
};

export const PROFESSIONS = [
  "alchemy",
  "blacksmithing",
  "enchanting",
  "engineering",
  "herbalism",
  "leatherworking",
  "mining",
  "skinning",
  "tailoring",
  "cooking",
  "first_aid",
  "fishing",
] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const PROFESSION_LABELS: Record<Profession, string> = {
  alchemy: "Alquimia",
  blacksmithing: "Herrería",
  enchanting: "Encantamiento",
  engineering: "Ingeniería",
  herbalism: "Herboristería",
  leatherworking: "Peletería",
  mining: "Minería",
  skinning: "Desuello",
  tailoring: "Sastrería",
  cooking: "Cocina",
  first_aid: "Primeros auxilios",
  fishing: "Pesca",
};

export const MAX_LEVEL = 60;
export const MAX_PROFESSION_SKILL = 300;
export const MAX_IN_GAME_RANKS = 10;

/** World of Warcraft: Forever launch day (a Wednesday). Nothing happens in game before this date. */
export const WOWF_LAUNCH_DATE = "2026-11-04";

export const DAYS_OF_WEEK = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"] as const;

/** Spanish display names for database enum values shown in the UI. The values themselves never change. */
export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  pending: "pendiente",
  accepted: "aceptada",
  trial: "a prueba",
  declined: "rechazada",
  withdrawn: "retirada",
};
export const ADDON_STATUS_LABELS: Record<string, string> = {
  planned: "Previsto",
  in_development: "En desarrollo",
  beta: "Beta",
  released: "Publicado",
};
export const RECRUITMENT_PRIORITY_LABELS: Record<string, string> = {
  closed: "Cerrado",
  low: "Baja",
  medium: "Media",
  high: "Alta",
};
export const DOMAIN_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  verified: "Verificado",
  failed: "Fallido",
};
