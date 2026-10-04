import { eq } from "drizzle-orm";
import { z } from "zod";
import { guilds } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { REGION_LABELS } from "@/lib/game";
import { sameGuildName } from "@/lib/guild-identity";
import { tabardSchema } from "@/lib/tabard/config";
import { tabardFromCrest } from "@/lib/tabard/crest-import";
import { guildLook, isOrderLook } from "@/lib/tabard/look";
import { ROLES, SELECTABLE_BASE_IDS, type ThemeOverrides } from "@/lib/tabard/theme";
import { recordAudit } from "@/server/audit";
import type { BlizzardClient, ProfileGuild } from "@/server/blizzard/client";
import { battlenetEnabled } from "@/server/blizzard/config";
import { DomainError, NotFoundError } from "@/server/errors";
import { adminCandidates, isPreLaunch, verificationSupported } from "@/server/services/guild-verification";
import { isSupportedVersion, realmLabel, VERSION_INFO } from "@/lib/game-versions";

/** Columns to select wherever a guild's crest is shown (spread into a Drizzle `select`). */
export const guildLookColumns = {
  tabardBackground: guilds.tabardBackground,
  tabardBorder: guilds.tabardBorder,
  tabardBorderStyle: guilds.tabardBorderStyle,
  tabardEmblemColor: guilds.tabardEmblemColor,
  tabardEmblemId: guilds.tabardEmblemId,
  tabardBorderId: guilds.tabardBorderId,
  themeBase: guilds.themeBase,
  themeOverrides: guilds.themeOverrides,
};

const hexOrBlank = z
  .string()
  .trim()
  .transform((v) => v.toLowerCase())
  .refine((v) => v === "" || /^#[0-9a-f]{6}$/.test(v), "Usa un color hexadecimal como #a8182f o déjalo en blanco.");

/**
 * The tabard and theme form. `themeBase` only accepts the selectable styles, so no guild can pick the Order's
 * theme; overrides are optional per role (blank clears one).
 */
export const tabardThemeInput = tabardSchema().extend({
  themeBase: z.enum(SELECTABLE_BASE_IDS, { error: "Elige un estilo base." }),
  overridePrimary: hexOrBlank.optional().default(""),
  overrideTrim: hexOrBlank.optional().default(""),
  overrideHighlight: hexOrBlank.optional().default(""),
});

/** Saves a guild's tabard, base style and site colour overrides. Admins only; the Order's look is locked. */
export async function updateGuildTabard(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "guild.settings");
  const input = tabardThemeInput.parse(raw);
  const given = { primary: input.overridePrimary, trim: input.overrideTrim, highlight: input.overrideHighlight };
  const overrides: ThemeOverrides = {};
  for (const role of ROLES) if (given[role]) overrides[role] = given[role];

  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(guilds).where(eq(guilds.id, actor.guildId));
    if (!before) throw new NotFoundError("Guild");
    if (isOrderLook(before)) throw new DomainError("El emblema y el tema de la Order of Saint Michael están bloqueados.");
    const [updated] = await tx
      .update(guilds)
      .set({
        tabardBackground: input.background,
        tabardBorder: input.border,
        tabardBorderStyle: input.borderStyle,
        tabardEmblemColor: input.emblemColor,
        tabardEmblemId: input.emblemId,
        themeBase: input.themeBase,
        themeOverrides: overrides,
      })
      .where(eq(guilds.id, actor.guildId))
      .returning();
    const summary = (g: typeof before) => {
      const look = guildLook(g);
      return { ...look.tabard, themeBase: look.base, overrides: look.overrides };
    };
    await recordAudit(tx, actor, { action: "guild.tabard", targetType: "guild", targetId: actor.guildId, before: summary(before), after: summary(updated!) });
    return guildLook(updated!);
  });
}

/** Characters looked up on Battle.net per import, to bound API calls. */
const MAX_IMPORT_LOOKUPS = 10;

/**
 * The guild's in-game guild: the verified Guild Master's first, else the first admin character (in the guild's region)
 * whose in-game guild has the guild's name. Throws a DomainError explaining why none was found.
 */
async function findInGameGuild(db: Db, guild: typeof guilds.$inferSelect, client: BlizzardClient, now: Date): Promise<ProfileGuild> {
  const region = REGION_LABELS[guild.region];
  const versionLabel = VERSION_INFO[guild.gameVersion].label;
  if (!verificationSupported(guild.gameVersion) || !isSupportedVersion(guild.gameVersion)) {
    throw new DomainError(`Aún no se puede importar el tabardo desde ${versionLabel}. De momento, diséñalo aquí.`);
  }
  const version = guild.gameVersion;
  const { links, candidates: all } = await adminCandidates(db, guild.id);
  const everywhere = all.filter((c) => c.gameVersion === version);
  const candidates = everywhere.filter((c) => c.region === guild.region && (!guild.realmSlug || c.realmSlug.toLowerCase() === guild.realmSlug));
  const tried = new Set<string>();
  const lookups: { name: string; realmSlug: string }[] = [];
  if (guild.verifiedAt && guild.verifiedCharacterName && guild.verifiedRealmSlug) {
    lookups.push({ name: guild.verifiedCharacterName, realmSlug: guild.verifiedRealmSlug });
  }
  const named = (c: (typeof candidates)[number]) => (c.snapshotGuildName && sameGuildName(c.snapshotGuildName, guild.name) ? 0 : 1);
  for (const c of [...candidates].sort((a, b) => named(a) - named(b))) lookups.push({ name: c.name, realmSlug: c.realmSlug });

  if (lookups.length === 0) {
    if (links === 0) throw new DomainError("Ningún administrador de esta hermandad ha vinculado Battle.net. Vincúlalo desde Mis personajes y vuelve a importar.");
    if (everywhere.length > 0) {
      throw new DomainError(
        guild.realmSlug
          ? `Ninguno de los personajes de ${versionLabel} de los administradores está en ${realmLabel(version, guild.realmSlug, guild.region)}, el reino de esta hermandad.`
          : `Los personajes de ${versionLabel} de los administradores están en otra región, pero esta hermandad está en la región de ${region}.`,
      );
    }
    if (isPreLaunch(now, version)) {
      throw new DomainError(
        "La importación se abre cuando existan personajes de WoW: Forever. Forever sale el 4 de noviembre de 2026; hasta entonces, diseña tu tabardo aquí.",
      );
    }
    throw new DomainError(
      `No se han encontrado personajes de ${versionLabel} en la región de ${region} en las cuentas de Battle.net vinculadas de los administradores. Actualiza tus personajes en Mis personajes y vuelve a importar.`,
    );
  }

  let failed = false;
  for (const l of lookups) {
    const key = `${l.realmSlug}/${l.name.toLowerCase()}`;
    if (tried.has(key)) continue;
    tried.add(key);
    if (tried.size > MAX_IMPORT_LOOKUPS) break;
    const lookup = await client.lookupCharacterProfile(guild.region, l.realmSlug, l.name, version);
    if (lookup.status === "error") failed = true;
    const inGame = lookup.status === "ok" ? lookup.profile.guild : null;
    const sameRealm = !guild.realmSlug || inGame?.realmSlug.toLowerCase() === guild.realmSlug;
    if (inGame && sameRealm && sameGuildName(inGame.name, guild.name) && (!inGame.faction || inGame.faction === guild.faction)) return inGame;
  }
  if (failed) throw new DomainError("Battle.net no ha respondido. Inténtalo más tarde.");
  throw new DomainError(
    `Ninguno de los personajes de ${versionLabel} de los administradores está en una hermandad del juego llamada ${guild.name} ${guild.realmSlug ? `en ${realmLabel(version, guild.realmSlug, guild.region)}` : `en la región de ${region}`}. Revisa el nombre de la hermandad o actualiza tus personajes en Mis personajes.`,
  );
}

/**
 * Replaces the guild's tabard with its in-game one: Blizzard's emblem and the three colours from the guild endpoint's
 * crest (in the guild's region). The border shape is stored but not drawn (the crest keeps Guildbook's trim), and
 * the theme and colour overrides stay. Admins only; the Order's look is locked.
 */
export async function importInGameTabard(db: Db, actor: Actor, client: BlizzardClient, now = new Date()) {
  assertCan(actor, "guild.settings");
  const [guild] = await db.select().from(guilds).where(eq(guilds.id, actor.guildId));
  if (!guild) throw new NotFoundError("Guild");
  if (isOrderLook(guild)) throw new DomainError("El emblema y el tema de la Order of Saint Michael están bloqueados.");
  if (!battlenetEnabled(client.config)) {
    throw new DomainError("Battle.net aún no está configurado en este sitio, así que no se puede importar el tabardo del juego.");
  }

  const inGame = await findInGameGuild(db, guild, client, now);
  const lookup = await client.lookupGuild(guild.region, inGame.realmSlug, inGame.nameSlug, isSupportedVersion(guild.gameVersion) ? guild.gameVersion : "forever");
  if (lookup.status === "error") throw new DomainError("Battle.net no ha respondido. Inténtalo más tarde.");
  if (lookup.status !== "ok" || !lookup.crest) {
    throw new DomainError(`Battle.net no ha devuelto el tabardo de ${inGame.name}. Una hermandad que no ha diseñado uno en el juego no tiene nada que importar.`);
  }
  const current = guildLook(guild).tabard;
  const mapped = tabardFromCrest(lookup.crest, current);
  if (!mapped.ok) {
    throw new DomainError(`El emblema del juego de ${lookup.name} (número ${mapped.id}) aún no está en el catálogo de Guildbook. Elige el más parecido de abajo.`);
  }

  const tabard = mapped.tabard;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(guilds)
      .set({
        tabardBackground: tabard.background,
        tabardBorder: tabard.border,
        tabardEmblemColor: tabard.emblemColor,
        tabardEmblemId: tabard.emblemId,
        tabardBorderId: tabard.borderId,
      })
      .where(eq(guilds.id, actor.guildId))
      .returning();
    await recordAudit(tx, actor, {
      action: "guild.tabard",
      targetType: "guild",
      targetId: actor.guildId,
      before: current,
      after: { ...guildLook(updated!).tabard, importedFrom: { name: lookup.name, realm: inGame.realmSlug, region: guild.region } },
    });
    return { look: guildLook(updated!), inGameName: lookup.name };
  });
}
