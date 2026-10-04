import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { contentPages, guilds, ranks } from "@/db/schema";
import type { Faction, Region, Ruleset } from "@/lib/game";
import type { GuildVersion } from "@/lib/game-versions";
import type { GuildIdentity } from "@/lib/guild-identity";
import { DEFAULT_RANK_PRESET, RANK_PRESETS, type RankPresetKey, type RankTemplate } from "@/lib/rank-presets";
import { LORE_MD, LORE_SLUG, LORE_TITLE } from "@/lib/lore";
import { DEFAULT_TABARD, ORDER_TABARD } from "@/lib/tabard/config";

export type GuildPreset = "order" | "standard";

/** Guilds with this identity, matched the way `guilds_identity_key` compares them (name case-insensitively). */
export function sameIdentity(identity: GuildIdentity): SQL {
  return and(
    eq(guilds.gameVersion, identity.gameVersion),
    sql`lower(${guilds.name}) = lower(${identity.name})`,
    eq(guilds.region, identity.region),
    identity.realmSlug ? eq(guilds.realmSlug, identity.realmSlug) : isNull(guilds.realmSlug),
    eq(guilds.faction, identity.faction),
    eq(guilds.ruleset, identity.ruleset),
  )!;
}

/** The Order of Saint Michael's ranks, modelled on a religious house. */
export const DEFAULT_RANKS: RankTemplate[] = [
  { name: "Grand Master", description: "Guild leader", tier: "admin", insignia: "archangel", inGame: true },
  { name: "Seneschal", description: "Second in command; runs logistics, bank and recruiting", tier: "admin", insignia: "keys", inGame: true },
  { name: "Marshal", description: "Raid leader", tier: "officer", insignia: "banner", inGame: true },
  { name: "Commander", description: "Class or role lead", tier: "officer", insignia: "laurel", inGame: true },
  { name: "Chaplain", description: "Leads prayer, rosary and feast-day events", tier: "officer", insignia: "chalice", inGame: true },
  { name: "Knight", description: "Core raider", tier: "raider", insignia: "cross-pattee", inGame: true },
  { name: "Sergeant", description: "Raider or bench", tier: "raider", insignia: "chevron", inGame: true },
  { name: "Squire", description: "Member, social or leveling", tier: "member", insignia: "helm", inGame: true },
  { name: "Novice", description: "Trial member", tier: "member", insignia: "cross", inGame: true },
  { name: "Postulant", description: "Applicant on the website; not a guild rank in game", tier: "applicant", insignia: "candle", inGame: false },
];

/** Neutral ranks for guilds created on Guildbook. Officers rename them freely. */
export const STANDARD_RANKS: readonly RankTemplate[] = RANK_PRESETS[DEFAULT_RANK_PRESET].ranks;

export const DEFAULT_CONTENT_PAGES = [
  { slug: "charter", title: "Rules of the Order", sortOrder: 1 },
  { slug: "clean-chat", title: "The Clean Chat Standard", sortOrder: 2 },
  { slug: "loot-policy", title: "Loot Policy", sortOrder: 3 },
  { slug: "prayer", title: "Prayer to Saint Michael", sortOrder: 4 },
  { slug: LORE_SLUG, title: LORE_TITLE, sortOrder: 5 },
] as const;

export const STANDARD_CHARTER_MD = `> Este es un reglamento de ejemplo para **{name}**. Los oficiales pueden reescribirlo en Administración > Reglamento para contar cómo funciona de verdad la hermandad.

### Nuestras normas

1. **Sé amable.** Nada de acoso, insultos ni dramas en los canales públicos. Trata con respeto a los compañeros de hermandad, a los de grupos aleatorios y a los rivales.
2. **Cumple tu palabra.** Si te apuntas a un evento, ven preparado y a tiempo. Si cambian tus planes, avisa a un oficial.
3. **Ven preparado.** Ten claro lo que el grupo necesita de ti y mantén al día tu equipo y tus addons.
4. **Resuelve los desacuerdos en privado.** Lleva tus quejas a un oficial, no al chat de la hermandad.

### Rangos

Nuestros rangos, y lo que puede hacer cada uno, aparecen al final de este reglamento.`;

export const STANDARD_LOOT_MD = `El botín sirve primero al progreso de la hermandad.

- **Consejo de botín** o **reserva (SR)**: los oficiales anuncian qué sistema usa cada banda antes del primer pull.
- Las tiradas de **especialización secundaria** solo se hacen cuando ya está resuelto el interés por la principal.
- Los objetos que nadie necesita se **desencantan** para el banco de la hermandad.`;

export const STANDARD_STORY_MD = `> Esta página es un punto de partida. Los oficiales pueden sustituirla en Administración > Reglamento.

## Quiénes somos

Cuenta a los visitantes de qué va la hermandad: cómo empezó, qué valoráis y cómo es una noche de banda.

## A qué jugamos

Bandas, mazmorras, JcJ o subir de nivel juntos: di en qué se centra la hermandad y cuándo.

## Unirse

Explica quién encaja mejor y cómo contactar con un oficial en Discord.`;

export const STANDARD_CONTENT_PAGES = [
  { slug: "charter", title: "Reglamento de la hermandad", sortOrder: 1, bodyMd: STANDARD_CHARTER_MD },
  { slug: "loot-policy", title: "Política de botín", sortOrder: 2, bodyMd: STANDARD_LOOT_MD },
  { slug: LORE_SLUG, title: "Nuestra historia", sortOrder: 3, bodyMd: STANDARD_STORY_MD },
] as const;

const PRESETS = {
  order: {
    ranks: DEFAULT_RANKS,
    pages: DEFAULT_CONTENT_PAGES.map((p) => ({ ...p, bodyMd: p.slug === LORE_SLUG ? LORE_MD : "" })),
    applicantRank: "Postulant",
    acceptRank: "Squire",
    trialRank: "Novice",
  },
  standard: { ...RANK_PRESETS[DEFAULT_RANK_PRESET], pages: STANDARD_CONTENT_PAGES },
} satisfies Record<GuildPreset, unknown>;

/** A starter page's body for this guild, as `createGuildWithDefaults` writes it. */
export const starterBody = (bodyMd: string, guildName: string) => bodyMd.replaceAll("{name}", guildName);

/** The Order preset keeps the Order's locked crest and theme (see migration 0011_guild_tabard). */
const ORDER_LOOK = {
  tabardBackground: ORDER_TABARD.background,
  tabardBorder: ORDER_TABARD.border,
  tabardBorderStyle: ORDER_TABARD.borderStyle,
  tabardEmblem: "cross-pattee",
  tabardEmblemColor: ORDER_TABARD.emblemColor,
  tabardEmblemId: null,
  themeBase: "order",
} as const;

/** Every other guild starts on the default Blizzard emblem (see DEFAULT_TABARD). */
const NEW_GUILD_LOOK = { tabardEmblemId: DEFAULT_TABARD.emblemId };

/**
 * Creates a guild with a rank ladder, application rank defaults and starter pages. The "order" preset is the
 * Order of Saint Michael's Catholic ranks, prayer and lore; new guilds get the neutral "standard" preset with the
 * chosen starter ladder. Published unless `publishedAt` is null (guilds founded on the apex start as drafts).
 */
export async function createGuildWithDefaults(
  db: Db,
  input: {
    slug: string;
    name: string;
    motto?: string | null;
    description?: string;
    timezone?: string;
    realm?: string | null;
    /** Defaults to WoW: Forever (seeds and the Order). Guilds founded on the apex always choose. */
    gameVersion?: GuildVersion;
    /** Required for versions with realms, null for WoW: Forever. */
    realmSlug?: string | null;
    /** Battle.net region; defaults to the Americas (seeds and the Order). Guilds founded on the apex always choose. */
    region?: Region;
    faction: Faction;
    ruleset: Ruleset;
    preset?: GuildPreset;
    rankPreset?: RankPresetKey;
    directoryListed?: boolean;
    createdByUserId?: string | null;
    publishedAt?: Date | null;
  },
) {
  const { rankPreset, publishedAt, region = "us", gameVersion = "forever", realmSlug = null, ...values } = input;
  const preset =
    input.preset === "order" ? PRESETS.order : { ...RANK_PRESETS[rankPreset ?? DEFAULT_RANK_PRESET], pages: STANDARD_CONTENT_PAGES };
  const look = input.preset === "order" ? ORDER_LOOK : NEW_GUILD_LOOK;
  return db.transaction(async (tx) => {
    const [guild] = await tx
      .insert(guilds)
      .values({ ...values, gameVersion, realmSlug, region, ...look, publishedAt: publishedAt === undefined ? new Date() : publishedAt })
      .returning();
    if (!guild) throw new Error("Guild insert failed");
    const rankRows = await tx
      .insert(ranks)
      .values(preset.ranks.map((r, i) => ({ ...r, guildId: guild.id, sortOrder: i + 1 })))
      .returning();
    const byName = (name: string) => rankRows.find((r) => r.name === name)!.id;
    const [updated] = await tx
      .update(guilds)
      .set({ applicantRankId: byName(preset.applicantRank), acceptRankId: byName(preset.acceptRank), trialRankId: byName(preset.trialRank) })
      .where(eq(guilds.id, guild.id))
      .returning();
    await tx
      .insert(contentPages)
      .values(preset.pages.map((p) => ({ ...p, guildId: guild.id, bodyMd: starterBody(p.bodyMd, guild.name) })));
    return { guild: updated!, ranks: rankRows, rankId: byName };
  });
}
