import { z } from "zod";
import { RANK_TIERS } from "@/lib/authz/tiers";
import { SLUG_MAX, SLUG_MIN, type SlugProblem, slugProblem } from "@/lib/hosts";
import { INSIGNIA } from "@/lib/insignia";
import { DEFAULT_RANK_PRESET, RANK_PRESET_KEYS } from "@/lib/rank-presets";
import { LOOT_RESPONSES, MAX_IMPORT_BYTES, NO_RECIPIENT_RESPONSES } from "@/lib/loot/constants";
import {
  CLASSES,
  FACTIONS,
  isValidSpec,
  PROFESSIONS,
  REGIONS,
  ROLES,
  RULESETS,
} from "@/lib/game";
import { cleanGuildName } from "@/lib/guild-identity";
import {
  findRealm,
  type GuildVersion,
  hasSurnames,
  maxLevelFor,
  maxProfessionSkillFor,
  SUPPORTED_GUILD_VERSIONS,
  VERSION_INFO,
} from "@/lib/game-versions";

const trimmed = (max: number) => z.string().trim().max(max);
const required = (label: string, max: number) =>
  z.string().trim().min(1, `El campo «${label}» es obligatorio`).max(max, `El campo «${label}» es demasiado largo`);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((v) => (v ? v : null));
const checkbox = z
  .unknown()
  .optional()
  .transform((v) => v === "on" || v === "true" || v === true);
const uuid = z.uuid();

/** One part of a WoW: Forever name: letters only (accents allowed), 2–12 characters. */
const namePart = (label: string) =>
  z
    .string()
    .trim()
    .min(2, `${label} debe tener al menos 2 caracteres`)
    .max(12, `${label} debe tener como máximo 12 caracteres`)
    .regex(/^\p{L}+$/u, `${label} solo puede contener letras`);
export const characterName = namePart("El nombre");
export const characterSurname = namePart("El apellido");

const levelFor = (version: GuildVersion) => z.coerce.number().int().min(1).max(maxLevelFor(version));
/** Surnames exist only in WoW: Forever; elsewhere the field is ignored and stored empty. */
const surnameFor = (version: GuildVersion) =>
  hasSurnames(version) ? characterSurname : z.unknown().optional().transform(() => "");
const optionalFaction = z
  .enum([...FACTIONS, ""])
  .optional()
  .transform((v) => (v ? v : null));

const classSpecShape = {
  faction: optionalFaction,
  wowClass: z.enum(CLASSES),
  spec: required("Especialización", 40),
  role: z.enum(ROLES),
};

function refineSpec<T extends { wowClass: (typeof CLASSES)[number]; spec: string }>(v: T, ctx: z.RefinementCtx) {
  if (!isValidSpec(v.wowClass, v.spec)) {
    ctx.addIssue({ code: "custom", path: ["spec"], message: "Esa especialización no es de esa clase" });
  }
}

// --- Applications ----------------------------------------------------------

/** The Order's pledge also asks applicants to respect its faith; other guilds only ask them to keep the charter. */
export const applicationInputFor = (guild: { preset: string; gameVersion?: GuildVersion }) =>
  z
    .object({
      characterName,
      characterSurname: surnameFor(guild.gameVersion ?? "forever"),
      ...classSpecShape,
      level: levelFor(guild.gameVersion ?? "forever"),
      raidExperience: required("Experiencia en bandas", 2000),
      availability: required("Disponibilidad", 1000),
      whyThisGuild: required("¿Por qué esta hermandad?", 2000),
      discordHandle: required("Usuario de Discord", 64),
      respectsFaith: checkbox.refine(
        (v) => v,
        guild.preset === "order" ? "Tienes que aceptar respetar la fe y el reglamento" : "Tienes que aceptar cumplir el reglamento",
      ),
    })
    .superRefine(refineSpec);
export type ApplicationInput = z.infer<ReturnType<typeof applicationInputFor>>;

/** Joining without review as a member Battle.net confirms in the in-game guild: the charter pledge still applies. */
export const confirmedJoinInputFor = (guild: { preset: string }) =>
  z.object({
    bnetCharacterId,
    surname: characterSurname.optional(),
    spec: required("Especialización", 40),
    role: z.enum(ROLES),
    respectsFaith: checkbox.refine(
      (v) => v,
      guild.preset === "order" ? "Tienes que aceptar respetar la fe y el reglamento" : "Tienes que aceptar cumplir el reglamento",
    ),
  });

export const applicationDecision = z.object({
  applicationId: uuid,
  decision: z.enum(["accepted", "trial", "declined"]),
  note: optionalText(1000),
});

// --- Characters ------------------------------------------------------------

export const professionEntryFor = (version: GuildVersion) =>
  z.object({
    profession: z.enum(PROFESSIONS),
    skill: z.coerce.number().int().min(1).max(maxProfessionSkillFor(version)).nullable(),
  });
export const professionEntry = professionEntryFor("forever");

/** A character in a guild of this game version: level and profession caps follow its expansion. */
export const characterInputFor = (version: GuildVersion) =>
  z
    .object({
      name: characterName,
      surname: surnameFor(version),
      ...classSpecShape,
      level: levelFor(version),
      isMain: checkbox,
      professions: z
        .array(professionEntryFor(version))
        .max(4, "Como máximo 4 profesiones")
        .refine((list) => new Set(list.map((p) => p.profession)).size === list.length, "Profesión repetida"),
    })
    .superRefine(refineSpec);
export const characterInput = characterInputFor("forever");
export type CharacterInput = z.infer<typeof characterInput>;

/** Blizzard character IDs are numeric; we keep them as strings. */
export const bnetCharacterId = z.string().trim().regex(/^\d{1,20}$/, "Elige uno de tus personajes de Battle.net");

/** Importing a Battle.net character: name, class and level come from Blizzard; the rest is the member's. */
export const importCharacterInput = z.object({
  bnetCharacterId,
  surname: characterSurname.optional(),
  spec: required("Especialización", 40),
  role: z.enum(ROLES),
  isMain: checkbox,
});

// --- Ranks & members -------------------------------------------------------

export const rankInput = z.object({
  name: required("Nombre", 40),
  description: trimmed(300).default(""),
  tier: z.enum(RANK_TIERS),
  insignia: z
    .enum([...INSIGNIA, ""])
    .optional()
    .transform((v) => (v ? v : null)),
  inGame: checkbox,
});
export type RankInput = z.infer<typeof rankInput>;

export const rankDefaultsInput = z.object({
  applicantRankId: uuid,
  acceptRankId: uuid,
  trialRankId: uuid,
});

export const assignRankInput = z.object({ membershipId: uuid, rankId: uuid });

/** An empty rank means the accepted-applicant rank. */
export const confirmedJoinSettingsInput = z.object({
  autoApproveInGuild: checkbox,
  autoApproveRankId: z
    .union([uuid, z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
});

// --- Guild settings --------------------------------------------------------

function isDiscordInvite(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "discord.gg" || url.pathname.startsWith("/invite/");
  } catch {
    return false;
  }
}

const discordInviteUrl = z
  .union([
    z
      .url({ protocol: /^https$/, hostname: /^(discord\.gg|(www\.)?discord\.com)$/ })
      .refine(isDiscordInvite, { message: "Usa un enlace de discord.gg o discord.com/invite" }),
    z.literal(""),
  ])
  .optional()
  .transform((v) => (v ? v : null));

const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, "Zona horaria desconocida");

const guildName = (max: number) => required("Nombre", max).transform(cleanGuildName).pipe(z.string().min(1, "El campo «Nombre» es obligatorio"));
const guildFaction = z.enum(FACTIONS, "Elige la facción de tu hermandad");
const guildRuleset = z.enum(RULESETS, "Elige el tipo de reino de tu hermandad");
const guildRegion = z.enum(REGIONS, "Elige la región de tu hermandad");
const optionalRealm = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((v) => (v ? v : null));

/**
 * Where a guild lives in its game version: WoW: Forever guilds choose a ruleset and have no realm; guilds in a version
 * with realms choose a realm in their region, and the realm's type sets the ruleset.
 */
export function resolveGuildWorld(
  version: GuildVersion,
  input: { region: (typeof REGIONS)[number]; ruleset?: (typeof RULESETS)[number] | null; realmSlug?: string | null },
): { ok: true; realmSlug: string | null; ruleset: (typeof RULESETS)[number] } | { ok: false; field: "realmSlug" | "ruleset"; message: string } {
  if (!VERSION_INFO[version].realms) {
    if (!input.ruleset) return { ok: false, field: "ruleset", message: "Elige el tipo de reino de tu hermandad" };
    return { ok: true, realmSlug: null, ruleset: input.ruleset };
  }
  const realm = findRealm(version, input.realmSlug);
  if (!realm) return { ok: false, field: "realmSlug", message: "Elige el reino de tu hermandad" };
  if (realm.region !== input.region) return { ok: false, field: "realmSlug", message: `${realm.name} está en otra región. Elige un reino de la región de tu hermandad.` };
  return { ok: true, realmSlug: realm.slug, ruleset: realm.ruleset };
}

/** Guild settings. The game version never changes; each version's ruleset or realm is resolved by `resolveGuildWorld`. */
export const guildSettingsInput = z.object({
  name: guildName(80),
  motto: optionalText(120),
  description: trimmed(2000).default(""),
  timezone,
  region: guildRegion,
  faction: guildFaction,
  ruleset: guildRuleset.optional(),
  realmSlug: optionalRealm,
  discordInviteUrl,
  recruitmentOpen: checkbox,
  directoryListed: checkbox,
  lootPublic: checkbox,
});

// --- Guildbook platform ------------------------------------------------------

export const SLUG_MESSAGES: Record<SlugProblem, string> = {
  length: `Usa entre ${SLUG_MIN} y ${SLUG_MAX} caracteres`,
  characters: "Usa minúsculas, números y guiones sueltos, empezando y acabando por letra o número",
  reserved: "Ese nombre está reservado",
};

export const guildSlug = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((slug, ctx) => {
    const problem = slugProblem(slug);
    if (problem) ctx.addIssue({ code: "custom", message: SLUG_MESSAGES[problem] });
  });

const createGuildShared = {
  name: guildName(60),
  slug: guildSlug,
  region: guildRegion,
  faction: guildFaction,
  timezone,
  motto: optionalText(120),
  directoryListed: checkbox,
  rankPreset: z.enum(RANK_PRESET_KEYS).catch(DEFAULT_RANK_PRESET),
};

/** WoW: Forever guilds choose a ruleset; they have no realm. */
export const createForeverGuild = z
  .object({
    gameVersion: z.literal("forever"),
    ...createGuildShared,
    ruleset: guildRuleset,
  })
  .transform((v) => ({ ...v, realmSlug: null as string | null }));

/** TBC Anniversary guilds choose a realm in their region; its type sets the ruleset, so a submitted one is ignored. */
export const createAnniversaryGuild = z
  .object({
    gameVersion: z.literal("anniversary"),
    ...createGuildShared,
    realmSlug: z.string("Elige el reino de tu hermandad").trim().toLowerCase(),
  })
  .superRefine((v, ctx) => {
    const world = resolveGuildWorld("anniversary", { region: v.region, realmSlug: v.realmSlug });
    if (!world.ok) ctx.addIssue({ code: "custom", path: [world.field], message: world.message });
  })
  .transform((v) => ({ ...v, ruleset: findRealm("anniversary", v.realmSlug)!.ruleset }));

/** A missing version (older clients, tests) means WoW: Forever. */
function defaultVersion(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw;
  const v = (raw as { gameVersion?: unknown }).gameVersion;
  return v === undefined || v === "" ? { ...raw, gameVersion: "forever" } : raw;
}

export const createGuildInput = z.preprocess(
  defaultVersion,
  z.discriminatedUnion("gameVersion", [createForeverGuild, createAnniversaryGuild], {
    error: () => `Elige ${SUPPORTED_GUILD_VERSIONS.map((v) => VERSION_INFO[v].label).join(" o ")}`,
  }),
);
export type CreateGuildInput = z.infer<typeof createGuildInput>;

/** A bare hostname such as `orderofsaintmichael.org` or `www.example.com`; a pasted URL is reduced to its host. */
export const customDomainInput = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, ""))
    .pipe(
      z
        .string()
        .max(253, "El dominio es demasiado largo")
        .regex(
          /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
          "Escribe un dominio como ejemplo.org",
        ),
    ),
});

// --- Content ---------------------------------------------------------------

export const contentPageInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: required("Título", 120),
  bodyMd: trimmed(50_000),
});

// --- Schedule & recruitment ------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa HH:MM (24 horas)");

export const scheduleSlotInput = z.object({
  id: uuid.optional(),
  dayOfWeek: z.coerce.number().int().min(0).max(6),
  startTime: hhmm,
  endTime: hhmm,
  label: required("Etiqueta", 80),
  faction: optionalFaction,
});

export const recruitmentNeedInput = z.object({
  wowClass: z.enum(CLASSES),
  role: z.enum(ROLES),
  faction: optionalFaction,
  priority: z.enum(["closed", "low", "medium", "high"]),
  note: trimmed(200).default(""),
});

// --- Progression -----------------------------------------------------------

export const instanceInput = z.object({
  name: required("Nombre", 80),
  shortName: required("Nombre corto", 12),
  size: z.coerce.number().int().refine((n) => [10, 20, 25, 40].includes(n), "El tamaño debe ser 10, 20, 25 o 40"),
});

/** Today's date in the furthest-ahead time zone (UTC+14), so a kill from tonight is never "in the future" for any guild. */
function latestCalendarDate(): string {
  return new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const bossInput = z.object({ instanceId: uuid, name: required("Nombre", 80) });

/** A date in game: not in the future, and for a version with a launch date (WoW: Forever), not before launch. */
const gameDate = (what: string, version: GuildVersion) => {
  const launch = VERSION_INFO[version].launchDate;
  return z.iso
    .date("Usa una fecha válida")
    .refine((d) => !launch || d >= launch, `${what} no puede tener fecha anterior al lanzamiento de World of Warcraft: Forever, el 4 de noviembre de 2026`)
    .refine((d) => d <= latestCalendarDate(), `${what} no puede tener fecha futura`);
};

export const bossKillInputFor = (version: GuildVersion) =>
  z.object({
    bossId: uuid,
    faction: optionalFaction,
    killedOn: gameDate("Una muerte de jefe", version),
    note: trimmed(300).default(""),
  });
export const bossKillInput = bossKillInputFor("forever");

// --- Addons ----------------------------------------------------------------

const optionalUrl = z
  .union([z.url({ protocol: /^https$/ }), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

export const addonInput = z.object({
  id: uuid.optional(),
  name: required("Nombre", 80),
  slug: z.string().regex(/^[a-z0-9-]+$/, "Solo minúsculas, números y guiones").max(60),
  summary: required("Resumen", 200),
  descriptionMd: trimmed(10_000).default(""),
  status: z.enum(["planned", "in_development", "beta", "released"]),
  version: optionalText(20),
  downloadUrl: optionalUrl,
  sourceUrl: optionalUrl,
});

export const idInput = z.object({ id: uuid });

// --- Loot ------------------------------------------------------------------

const optionalUuid = z
  .union([uuid, z.literal("")])
  .optional()
  .transform((v) => (v ? v : null));

export const lootAwardInputFor = (version: GuildVersion) =>
  z
    .object({
      item: required("Objeto", 300),
      characterId: optionalUuid,
      response: z.enum(LOOT_RESPONSES, "Elige por qué se entregó el objeto"),
      bossId: optionalUuid,
      awardedOn: gameDate("Un botín", version),
      note: optionalText(300),
    })
    .refine((v) => v.characterId || NO_RECIPIENT_RESPONSES.has(v.response), {
      path: ["characterId"],
      message: "Elige quién recibió el objeto",
    });
export const lootAwardInput = lootAwardInputFor("forever");

export const lootReverseInput = z.object({
  entryId: uuid,
  reason: required("Motivo", 300),
});

export const lootImportInput = z.object({
  raw: z
    .string()
    .trim()
    .min(1, "Pega primero una exportación")
    .max(MAX_IMPORT_BYTES, "Esa exportación es demasiado grande; importa una banda cada vez"),
  parserId: optionalText(40),
  template: optionalText(200),
});

/** For each unmatched import name: a guild character (`char:<id>`), keep the name only (`name`), or leave it out (`skip`). */
export const lootNameDecision = z.string().regex(/^(char:[0-9a-f-]{36}|name|skip)$/, "Elige qué hacer con este nombre");

export const lootCommitInput = z.object({
  batchId: uuid,
  decisions: z.record(z.string().max(120), lootNameDecision).default({}),
  remember: checkbox,
});
