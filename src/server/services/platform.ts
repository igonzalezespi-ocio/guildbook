import { and, asc, count, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { characters, guildDomains, guilds, memberships, ranks, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { CONTACT_EMAIL } from "@/lib/brand";
import type { Faction, Region, Ruleset } from "@/lib/game";
import { DEFAULT_GUILD_VERSION, type SupportedGuildVersion } from "@/lib/game-versions";
import { describeIdentity, type GuildIdentity } from "@/lib/guild-identity";
import { slugProblem } from "@/lib/hosts";
import { createGuildInput, SLUG_MESSAGES } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError } from "@/server/errors";
import { createGuildWithDefaults, sameIdentity } from "@/server/services/guilds";
import { suggestSlugs } from "@/server/services/slug-suggestions";
import { guildLookColumns } from "@/server/services/tabard";
import type { SlugIdentity } from "@/lib/slug-suggestions";

export interface CreationLimits {
  /** Guilds one user may own (have founded and not deleted) at once. */
  perUser: number;
  /** Guilds one user may found in a rolling day. */
  perDay: number;
  /** Discord IDs of platform admins, who have no limits. */
  exemptDiscordIds?: ReadonlySet<string>;
  /** Per-user `perUser` overrides, keyed by Discord ID. */
  overrides?: Readonly<Record<string, number>>;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const DEFAULT_GUILD_CREATE_LIMIT = 3;

function idList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function creationLimitsFromEnv(env: Record<string, string | undefined> = process.env): CreationLimits {
  const overrides: Record<string, number> = {};
  for (const entry of idList(env.GUILD_CREATE_LIMIT_OVERRIDES)) {
    const [id, limit] = entry.split(":").map((s) => s.trim());
    const n = Number.parseInt(limit ?? "", 10);
    if (id && Number.isFinite(n) && n >= 0) overrides[id] = n;
  }
  return {
    perUser: positiveInt(env.GUILD_CREATE_LIMIT, DEFAULT_GUILD_CREATE_LIMIT),
    perDay: positiveInt(env.GUILD_CREATE_DAILY_LIMIT, 2),
    exemptDiscordIds: new Set(idList(env.PLATFORM_ADMIN_DISCORD_IDS)),
    overrides,
  };
}

function guildLimitMessage(limit: number, owned: string[]): string {
  const count = limit === 1 ? "1 hermandad" : `${limit} hermandades`;
  const list = owned.length > 0 ? ` Eres dueño de ${owned.join(", ")}.` : "";
  return `Cada cuenta puede ser dueña de hasta ${count}.${list} Borra una hermandad que ya no necesites desde sus Ajustes de la hermandad, o escribe a ${CONTACT_EMAIL} con tu usuario de Discord para pedir un límite mayor.`;
}

/** Enforces the per-account guild cap and daily founding limit; platform admins are exempt. */
async function assertCanFoundGuild(db: Db, userId: string, limits: CreationLimits, now: Date) {
  const [user] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, userId));
  const discordId = user?.discordId ?? null;
  if (discordId && limits.exemptDiscordIds?.has(discordId)) return;
  const perUser = (discordId ? limits.overrides?.[discordId] : undefined) ?? limits.perUser;
  const owned = await db.select({ name: guilds.name }).from(guilds).where(eq(guilds.createdByUserId, userId)).orderBy(asc(guilds.name));
  if (owned.length >= perUser) throw new DomainError(guildLimitMessage(perUser, owned.map((g) => g.name)));
  const [{ recent } = { recent: 0 }] = await db
    .select({ recent: count() })
    .from(guilds)
    .where(and(eq(guilds.createdByUserId, userId), gte(guilds.createdAt, new Date(now.getTime() - DAY_MS))));
  if (recent >= limits.perDay) throw new DomainError("Hoy ya has fundado varias hermandades. Inténtalo de nuevo mañana.");
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type SlugAvailability = { available: true } | { available: false; reason: string; suggestions?: string[] };

/** Whether a subdomain is free; when it's taken or reserved, free alternatives for a guild with `identity`. */
export async function checkSlugAvailability(db: Db, raw: string, identity: SlugIdentity = {}): Promise<SlugAvailability> {
  const slug = raw.trim().toLowerCase();
  const problem = slugProblem(slug);
  if (problem === "reserved") return { available: false, reason: SLUG_MESSAGES[problem], suggestions: await suggestSlugs(db, slug, identity) };
  if (problem) return { available: false, reason: SLUG_MESSAGES[problem] };
  const [taken] = await db.select({ id: guilds.id }).from(guilds).where(eq(guilds.slug, slug));
  if (!taken) return { available: true };
  return { available: false, reason: "Ese subdominio está ocupado", suggestions: await suggestSlugs(db, slug, identity) };
}

/** The guild holding this identity, compared case-insensitively like `guilds_identity_key`. */
export async function findGuildByIdentity(db: Db, identity: GuildIdentity, exceptGuildId?: string) {
  const [row] = await db
    .select({ id: guilds.id, slug: guilds.slug, name: guilds.name, verifiedAt: guilds.verifiedAt })
    .from(guilds)
    .where(and(sameIdentity(identity), exceptGuildId ? ne(guilds.id, exceptGuildId) : undefined));
  return row ?? null;
}

export function identityTakenMessage(identity: GuildIdentity): string {
  return `Ya hay en Guildbook una hermandad llamada ${identity.name} (${describeIdentity(identity)}). Elige otro nombre o, si eres el maestro de esa hermandad en el juego, crea la tuya con un nombre provisional y verifícala para reclamar el nombre.`;
}

export const IDENTITY_CONSTRAINT = "guilds_identity_key";

/**
 * Founds a guild on Guildbook: neutral "standard" preset (ranks, charter, loot policy, story page), with the
 * creator as an active member at the top rank (Guild Master, an admin). It starts as an unlisted draft until an
 * admin publishes it from the setup checklist.
 */
export async function createGuildForUser(
  db: Db,
  userId: string,
  raw: unknown,
  limits: CreationLimits = creationLimitsFromEnv(),
  now = new Date(),
) {
  const input = createGuildInput.parse(raw);
  await assertCanFoundGuild(db, userId, limits, now);

  const availability = await checkSlugAvailability(db, input.slug, input);
  if (!availability.available) {
    throw new DomainError(availability.reason, { field: "slug", suggestions: availability.suggestions });
  }
  const holder = await findGuildByIdentity(db, input);
  if (holder) throw new DomainError(identityTakenMessage({ ...input, name: holder.name }), { field: "name" });

  try {
    return await db.transaction(async (tx) => {
      const created = await createGuildWithDefaults(tx, {
        slug: input.slug,
        name: input.name,
        motto: input.motto,
        timezone: input.timezone,
        gameVersion: input.gameVersion,
        realmSlug: input.realmSlug,
        region: input.region,
        faction: input.faction,
        ruleset: input.ruleset,
        directoryListed: input.directoryListed,
        preset: "standard",
        rankPreset: input.rankPreset,
        createdByUserId: userId,
        publishedAt: null,
      });
      const top = [...created.ranks].sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
      const [membership] = await tx
        .insert(memberships)
        .values({ guildId: created.guild.id, userId, rankId: top.id, status: "active", joinedAt: now })
        .returning();
      await recordAudit(
        tx,
        { guildId: created.guild.id, userId, membershipId: membership!.id, tier: "admin" },
        {
          action: "guild.create",
          targetType: "guild",
          targetId: created.guild.id,
          after: {
            slug: input.slug,
            name: input.name,
            gameVersion: input.gameVersion,
            realmSlug: input.realmSlug,
            region: input.region,
            faction: input.faction,
            ruleset: input.ruleset,
          },
        },
      );
      return { guild: created.guild, founderRank: top };
    });
  } catch (err) {
    if (isUniqueViolation(err, IDENTITY_CONSTRAINT)) throw new DomainError(identityTakenMessage(input), { field: "name" });
    if (isUniqueViolation(err)) {
      throw new DomainError("Ese subdominio está ocupado", { field: "slug", suggestions: await suggestSlugs(db, input.slug, input) });
    }
    throw err;
  }
}

/** Guilds the user belongs to or has applied to, with their rank and main, for "Your guilds" on the apex. */
export async function listUserGuilds(db: Db, userId: string) {
  const rows = await db
    .select({
      slug: guilds.slug,
      name: guilds.name,
      motto: guilds.motto,
      preset: guilds.preset,
      ...guildLookColumns,
      gameVersion: guilds.gameVersion,
      realmSlug: guilds.realmSlug,
      region: guilds.region,
      faction: guilds.faction,
      ruleset: guilds.ruleset,
      verifiedAt: guilds.verifiedAt,
      publishedAt: guilds.publishedAt,
      status: memberships.status,
      rankName: ranks.name,
      rankTier: ranks.tier,
      rankInsignia: ranks.insignia,
      main: {
        id: characters.id,
        name: characters.name,
        surname: characters.surname,
        wowClass: characters.wowClass,
        spec: characters.spec,
        level: characters.level,
      },
    })
    .from(memberships)
    .innerJoin(guilds, eq(guilds.id, memberships.guildId))
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .leftJoin(
      characters,
      and(
        eq(characters.membershipId, memberships.id),
        eq(characters.isMain, true),
        isNull(characters.archivedAt),
        eq(memberships.status, "active"),
      ),
    )
    .where(and(eq(memberships.userId, userId), ne(memberships.status, "former")))
    .orderBy(asc(guilds.name));
  return attachDomains(db, rows);
}

export interface DirectoryFilter {
  /** Defaults to WoW: Forever: other versions are listed only when asked for. */
  version?: SupportedGuildVersion;
  /** Only for versions with realms. */
  realm?: string;
  region?: Region;
  faction?: Faction;
  ruleset?: Ruleset;
}

/**
 * Published guilds of one game version (WoW: Forever unless the filter asks for another) that opted in to the public
 * directory, with active member counts: verified first, then largest.
 */
export async function listDirectoryGuilds(db: Db, filter: DirectoryFilter = {}) {
  const rows = await db
    .select({
      id: guilds.id,
      slug: guilds.slug,
      name: guilds.name,
      motto: guilds.motto,
      description: guilds.description,
      preset: guilds.preset,
      ...guildLookColumns,
      gameVersion: guilds.gameVersion,
      realmSlug: guilds.realmSlug,
      region: guilds.region,
      faction: guilds.faction,
      ruleset: guilds.ruleset,
      verifiedAt: guilds.verifiedAt,
      recruitmentOpen: guilds.recruitmentOpen,
      timezone: guilds.timezone,
    })
    .from(guilds)
    .where(
      and(
        eq(guilds.directoryListed, true),
        isNotNull(guilds.publishedAt),
        eq(guilds.gameVersion, filter.version ?? DEFAULT_GUILD_VERSION),
        filter.realm ? eq(guilds.realmSlug, filter.realm) : undefined,
        filter.region ? eq(guilds.region, filter.region) : undefined,
        filter.faction ? eq(guilds.faction, filter.faction) : undefined,
        filter.ruleset ? eq(guilds.ruleset, filter.ruleset) : undefined,
      ),
    )
    .orderBy(asc(guilds.name));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ guildId: memberships.guildId, members: count() })
    .from(memberships)
    .where(and(eq(memberships.status, "active"), inArray(memberships.guildId, rows.map((r) => r.id))))
    .groupBy(memberships.guildId);
  const withCounts = rows
    .map((r) => ({ ...r, members: counts.find((c) => c.guildId === r.id)?.members ?? 0 }))
    .sort((a, b) => Number(Boolean(b.verifiedAt)) - Number(Boolean(a.verifiedAt)) || b.members - a.members || a.name.localeCompare(b.name));
  return attachDomains(db, withCounts);
}

/** Adds each guild's first verified custom domain, used for its public link. */
async function attachDomains<T extends { slug: string }>(db: Db, rows: T[]): Promise<(T & { customDomain: string | null })[]> {
  if (rows.length === 0) return [];
  const domains = await db
    .select({ slug: guilds.slug, domain: guildDomains.domain })
    .from(guildDomains)
    .innerJoin(guilds, eq(guilds.id, guildDomains.guildId))
    .where(and(eq(guildDomains.status, "verified"), inArray(guilds.slug, rows.map((r) => r.slug))))
    .orderBy(asc(guildDomains.createdAt));
  return rows.map((r) => ({ ...r, customDomain: domains.find((d) => d.slug === r.slug)?.domain ?? null }));
}
