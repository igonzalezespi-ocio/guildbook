import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import { CLASSES, FACTIONS, PROFESSIONS, REGIONS, ROLES, RULESETS } from "@/lib/game";
import { RANK_TIERS } from "@/lib/authz/tiers";
import { THEME_BASES, type ThemeOverrides } from "@/lib/tabard/theme";
import { ITEM_DATA_SOURCES, LOOT_RESPONSES, LOOT_SOURCES } from "@/lib/loot/constants";
import type { ParsedAward } from "@/lib/loot/types";
import type { SupportTicketContext } from "@/lib/support";
import type { GameVersion } from "@/lib/wow-versions";
import { GUILD_VERSIONS } from "@/lib/game-versions";
import { GROUP_KINDS, GROUP_ROLES, GROUP_STATUSES } from "@/lib/groups";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const rankTierEnum = pgEnum("rank_tier", RANK_TIERS);
export const wowClassEnum = pgEnum("wow_class", CLASSES);
export const raidRoleEnum = pgEnum("raid_role", ROLES);
export const factionEnum = pgEnum("faction", FACTIONS);
export const rulesetEnum = pgEnum("ruleset", RULESETS);
export const regionEnum = pgEnum("region", REGIONS);
/** The game a guild lives in; every value exists up front, but only SUPPORTED_GUILD_VERSIONS can be chosen. */
export const gameVersionEnum = pgEnum("game_version", GUILD_VERSIONS);
export const professionEnum = pgEnum("profession", PROFESSIONS);
export const membershipStatusEnum = pgEnum("membership_status", ["applicant", "active", "former"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "pending",
  "accepted",
  "trial",
  "declined",
  "withdrawn",
]);
export const recruitmentPriorityEnum = pgEnum("recruitment_priority", ["closed", "low", "medium", "high"]);
/** "order": the Order of Saint Michael's Catholic ranks, pages and imagery. "standard": neutral defaults for new guilds. */
export const guildPresetEnum = pgEnum("guild_preset", ["order", "standard"]);
/** `order` is the Order of Saint Michael's locked theme; a check constraint keeps it off every other guild. */
export const guildThemeBaseEnum = pgEnum("guild_theme_base", THEME_BASES);
export const domainStatusEnum = pgEnum("domain_status", ["pending", "verified", "failed"]);
export const addonStatusEnum = pgEnum("addon_status", ["planned", "in_development", "beta", "released"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Global (not guild-scoped): users and Auth.js tables
// ---------------------------------------------------------------------------

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  discordId: text("discord_id").unique(),
  discordUsername: text("discord_username"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/**
 * A Battle.net account linked to a (Discord) user as a second step; it is never a login method.
 * Blizzard issues no refresh token, so the character list is snapshotted at link time and the
 * access token (encrypted at rest) is only useful until it expires, about 24 hours later.
 */
export const battlenetLinks = pgTable("battlenet_links", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  battlenetId: text("battlenet_id").notNull().unique(),
  battletag: text("battletag").notNull(),
  /** Region of the OAuth grant (the default BATTLENET_REGION); characters are scanned in every region, see `region` on each. */
  region: text("region").notNull(),
  accessTokenEnc: text("access_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  /** Unfiltered: each guild filters by faction and realm on read. */
  characters: jsonb("characters").$type<BattlenetCharacterSnapshot[]>().notNull().default([]),
  /** "ok" | "empty" | "forbidden" | "error": why the snapshot may be empty. */
  snapshotStatus: text("snapshot_status").notNull().default("ok"),
  /** What each namespace returned and the non-Forever characters left out, to explain an empty snapshot. */
  scan: jsonb("scan").$type<BattlenetScan>(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
});

export interface BattlenetNamespaceScan {
  namespace: string;
  /** Absent in scans taken before regions (all US). */
  region?: (typeof REGIONS)[number];
  status: "ok" | "empty" | "forbidden" | "error";
  httpStatus: number;
  /** Characters the namespace listed, before any filtering. */
  characters: number;
}

/** Characters found on the account that aren't WoW: Forever characters, grouped by game and faction. */
export interface BattlenetExcludedGroup {
  version: GameVersion;
  faction: (typeof FACTIONS)[number] | null;
  count: number;
  /** A few of them, shown to the account owner only. */
  examples: { name: string; realmName: string }[];
}

export interface BattlenetScan {
  /** The Forever namespace of the first scanned region (see `foreverNamespaces` for all). */
  foreverNamespace: string;
  /** The Forever namespace per scanned region; absent in scans taken before regions. */
  foreverNamespaces?: string[];
  namespaces: BattlenetNamespaceScan[];
  excluded: BattlenetExcludedGroup[];
}

export interface VerificationResult {
  verified: boolean;
  reason: string | null;
  message: string;
  /** False when Blizzard couldn't give an answer; those failures never count toward the grace period. */
  conclusive: boolean;
  characterName?: string | null;
  /** The in-game guild the checked character is in, when it could be read. */
  inGameGuildName?: string | null;
  /** Set when the character is Guild Master of a same-faction, same-ruleset guild with another name. */
  claim?: { name: string; holderName: string | null; holderVerified: boolean } | null;
}

/** The admin setup checklist's own state; whether each step is done is computed from the guild's data. */
export interface GuildSetupState {
  dismissedAt?: string;
  skipped?: string[];
  /** An admin confirmed the rank ladder in setup without editing it. */
  ranksConfirmedAt?: string;
  /** Lets people apply to a draft guild through a private link (`/apply?invite=`); public applications open on publish. */
  inviteCode?: string;
  /**
   * Set at creation when the founder's linked character is in the in-game guild but isn't its Guild Master, so setup
   * explains that the Guild Master verifies. Cleared once the guild is verified.
   */
  founderNotGm?: { characterName: string; rank: number | null; checkedAt: string };
}

export interface BattlenetCharacterSnapshot {
  id: string;
  name: string;
  surname: string | null;
  realmSlug: string;
  realmName: string;
  level: number;
  wowClass: (typeof CLASSES)[number];
  race: string;
  faction: (typeof FACTIONS)[number];
  guildName: string | null;
  /** Battle.net region the character lives in; absent in snapshots taken before regions, which were all US. */
  region?: (typeof REGIONS)[number];
  /** The realm's WoW: Forever ruleset when Blizzard's realm data says; absent in snapshots taken before rulesets. */
  ruleset?: (typeof RULESETS)[number] | null;
  /** The game the character is in; absent means WoW: Forever (snapshots only kept Forever characters before versions). */
  gameVersion?: (typeof GUILD_VERSIONS)[number];
}

// ---------------------------------------------------------------------------
// Guild-scoped tables. Every child references its parent through (guild_id, id)
// so a row can never point at another guild's data.
// ---------------------------------------------------------------------------

export const guilds = pgTable("guilds", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  motto: text("motto"),
  description: text("description").notNull().default(""),
  realm: text("realm"),
  timezone: text("timezone").notNull().default("America/New_York"),
  /** The game the guild lives in (WoW: Forever, TBC Anniversary). Part of its identity; never changes. */
  gameVersion: gameVersionEnum("game_version").notNull().default("forever"),
  /** The guild's realm, for versions with realms (lib/game-versions.ts); null for WoW: Forever, which has none. */
  realmSlug: text("realm_slug"),
  /** Battle.net region. Regions are separate worlds; with name, faction and ruleset, the guild's identity. */
  region: regionEnum("region").notNull(),
  /** Classic-era guilds are faction-locked: one faction per guild. */
  faction: factionEnum("faction").notNull(),
  /** WoW: Forever ruleset (it has no realms). With name, region and faction, the guild's identity (see guilds_identity_key). */
  ruleset: rulesetEnum("ruleset").notNull(),
  /**
   * Verified: an admin-tier member's Battle.net character is Guild Master (rank 0) of the in-game guild with this
   * name, region, faction and ruleset. The daily cron re-checks it; the badge goes after VERIFICATION_GRACE_DAYS of failures.
   */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  verifiedUserId: text("verified_user_id").references(() => users.id, { onDelete: "set null" }),
  verifiedCharacterId: text("verified_character_id"),
  verifiedCharacterName: text("verified_character_name"),
  verifiedRealmSlug: text("verified_realm_slug"),
  /** How verification was proven; only "battlenet" so far. */
  verifiedVia: text("verified_via"),
  verificationCheckedAt: timestamp("verification_checked_at", { withTimezone: true }),
  /** First failed re-check of a verified guild, cleared by a successful one. */
  verificationFailingSince: timestamp("verification_failing_since", { withTimezone: true }),
  /** The last check's outcome, shown in the admin verification panel (reason, message, in-game guild, claim). */
  verificationResult: jsonb("verification_result").$type<VerificationResult>(),
  /** A notice for the guild's admins (faction backfill, a name or subdomain claimed by a verified guild), until dismissed. */
  adminNotice: text("admin_notice"),
  recruitmentOpen: boolean("recruitment_open").notNull().default(true),
  applicantRankId: uuid("applicant_rank_id").references((): AnyPgColumn => ranks.id, { onDelete: "set null" }),
  acceptRankId: uuid("accept_rank_id").references((): AnyPgColumn => ranks.id, { onDelete: "set null" }),
  trialRankId: uuid("trial_rank_id").references((): AnyPgColumn => ranks.id, { onDelete: "set null" }),
  /**
   * Members Battle.net confirms in the in-game guild join without review. Only ever applies while the guild is
   * verified: an unverified guild could be anyone's squat of the name.
   */
  autoApproveInGuild: boolean("auto_approve_in_guild").notNull().default(true),
  /** The rank confirmed members join at; null means `acceptRankId`. */
  autoApproveRankId: uuid("auto_approve_rank_id").references((): AnyPgColumn => ranks.id, { onDelete: "set null" }),
  discordGuildId: text("discord_guild_id"),
  discordInviteUrl: text("discord_invite_url"),
  preset: guildPresetEnum("preset").notNull().default("standard"),
  /**
   * Null while the guild is a draft: unlisted (out of the directory, sitemap and search engines), still reachable by
   * its link, and not accepting applications. Admins publish it from the setup checklist.
   */
  publishedAt: timestamp("published_at", { withTimezone: true }),
  setup: jsonb("setup").$type<GuildSetupState>().notNull().default({}),
  /** Opt-in listing in the public Guildbook directory. */
  directoryListed: boolean("directory_listed").notNull().default(false),
  /** Loot history is members-only unless the guild opts in to showing it to everyone. */
  lootPublic: boolean("loot_public").notNull().default(false),
  createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  /**
   * The tabard: the game's colour ids (lib/tabard/palette.ts), Blizzard's emblem id (lib/tabard/crest.ts, required
   * except on the Order preset, whose locked crest uses none) and the style of the drawn trim. `tabardBorderId` is the
   * in-game border shape from the last import, stored but never drawn. `tabardEmblem` is the drawn emblem guilds had
   * before migration 0018 mapped them to real ones; nothing reads it.
   */
  tabardBackground: smallint("tabard_background").notNull().default(32),
  tabardBorder: smallint("tabard_border").notNull().default(3),
  tabardBorderStyle: text("tabard_border_style").notNull().default("plain"),
  tabardEmblem: text("tabard_emblem").notNull().default("star"),
  tabardEmblemColor: smallint("tabard_emblem_color").notNull().default(3),
  tabardEmblemId: smallint("tabard_emblem_id"),
  tabardBorderId: smallint("tabard_border_id"),
  themeBase: guildThemeBaseEnum("theme_base").notNull().default("tome"),
  /** Site-only colour overrides (hex) for the primary, trim and highlight roles; the crest ignores them. */
  themeOverrides: jsonb("theme_overrides").$type<ThemeOverrides>().notNull().default({}),
  createdAt: createdAt(),
}, (t) => [
  index("guilds_created_by_idx").on(t.createdByUserId, t.createdAt),
  uniqueIndex("guilds_identity_key").on(t.gameVersion, sql`lower(${t.name})`, t.region, sql`coalesce(${t.realmSlug}, '')`, t.faction, t.ruleset),
  index("guilds_directory_version_idx").on(t.gameVersion, t.directoryListed),
  check("guilds_realm_by_version", sql`(${t.gameVersion} = 'forever') = (${t.realmSlug} is null)`),
  check("guilds_order_forever", sql`${t.preset} <> 'order' or ${t.gameVersion} = 'forever'`),
  check("guilds_theme_order_only", sql`${t.themeBase} <> 'order' or ${t.preset} = 'order'`),
  check("guilds_tabard_background_range", sql`${t.tabardBackground} between 0 and 50`),
  check("guilds_tabard_border_range", sql`${t.tabardBorder} between 0 and 16`),
  check("guilds_tabard_emblem_color_range", sql`${t.tabardEmblemColor} between 0 and 16`),
  check("guilds_tabard_crest_ids", sql`${t.tabardEmblemId} >= 0 and ${t.tabardBorderId} >= 0`),
  check("guilds_tabard_emblem_required", sql`${t.preset} = 'order' or ${t.tabardEmblemId} is not null`),
  check("guilds_tabard_order_drawn", sql`${t.themeBase} <> 'order' or (${t.tabardEmblemId} is null and ${t.tabardBorderId} is null)`),
]);

/**
 * A custom domain a guild serves on, e.g. orderofsaintmichael.org. Ownership is proven with a TXT record holding
 * `verification_token`; only verified domains route to the guild.
 */
export const guildDomains = pgTable(
  "guild_domains",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    domain: text("domain").notNull().unique(),
    status: domainStatusEnum("status").notNull().default("pending"),
    verificationToken: text("verification_token").notNull(),
    lastError: text("last_error"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("guild_domains_guild_id_id_key").on(t.guildId, t.id),
    index("guild_domains_guild_idx").on(t.guildId),
    check("guild_domains_domain_lowercase", sql`${t.domain} = lower(${t.domain})`),
  ],
);

export const ranks = pgTable(
  "ranks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    description: text("description").notNull().default(""),
    tier: rankTierEnum("tier").notNull(),
    /** Key from INSIGNIA in lib/insignia; null falls back to the tier's default emblem. */
    insignia: text("insignia"),
    inGame: boolean("in_game").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    unique("ranks_guild_id_id_key").on(t.guildId, t.id),
    unique("ranks_guild_name_key").on(t.guildId, t.name),
    unique("ranks_guild_sort_key").on(t.guildId, t.sortOrder),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rankId: uuid("rank_id").notNull(),
    status: membershipStatusEnum("status").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("memberships_guild_id_id_key").on(t.guildId, t.id),
    unique("memberships_guild_user_key").on(t.guildId, t.userId),
    foreignKey({
      name: "memberships_rank_fk",
      columns: [t.guildId, t.rankId],
      foreignColumns: [ranks.guildId, ranks.id],
    }).onDelete("restrict"),
  ],
);

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    name: text("name").notNull(),
    surname: text("surname").notNull(),
    faction: factionEnum("faction").notNull(),
    wowClass: wowClassEnum("class").notNull(),
    spec: text("spec").notNull(),
    role: raidRoleEnum("role").notNull(),
    level: integer("level").notNull(),
    isMain: boolean("is_main").notNull().default(false),
    externalRef: text("external_ref"),
    /** Name, class and level came from the owner's linked Battle.net account. */
    verified: boolean("verified").notNull().default(false),
    bnetCharacterId: text("bnet_character_id"),
    /** Battle.net region of a verified character (always the guild's); null for manually entered characters. */
    region: regionEnum("region"),
    realmSlug: text("realm_slug"),
    realmName: text("realm_name"),
    /** Last successful Battle.net sync (lastSyncedAt). */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    /**
     * When Battle.net last showed this character in the guild's in-game guild (same name, faction and, for versions
     * with realms, realm): a verified member. Null when it wasn't, or hasn't been checked.
     */
    inGuildConfirmedAt: timestamp("in_guild_confirmed_at", { withTimezone: true }),
    /** When a re-check found a confirmed character no longer in the in-game guild; cleared once it is confirmed again. */
    inGuildLostAt: timestamp("in_guild_lost_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("characters_guild_id_id_key").on(t.guildId, t.id),
    uniqueIndex("characters_unique_bnet_character")
      .on(t.guildId, t.bnetCharacterId)
      .where(sql`${t.bnetCharacterId} is not null and ${t.archivedAt} is null`),
    foreignKey({
      name: "characters_membership_fk",
      columns: [t.guildId, t.membershipId],
      foreignColumns: [memberships.guildId, memberships.id],
    }).onDelete("cascade"),
    uniqueIndex("characters_one_main_per_member")
      .on(t.membershipId)
      .where(sql`${t.isMain} and ${t.archivedAt} is null`),
    // WoW: Forever names are unique on the full first + last name across the region, regardless of faction.
    uniqueIndex("characters_unique_full_name")
      .on(t.guildId, sql`lower(${t.name})`, sql`lower(${t.surname})`)
      .where(sql`${t.archivedAt} is null`),
    check("characters_level_range", sql`${t.level} between 1 and 100`),
  ],
);

export const characterProfessions = pgTable(
  "character_professions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    characterId: uuid("character_id").notNull(),
    profession: professionEnum("profession").notNull(),
    skill: integer("skill"),
  },
  (t) => [
    foreignKey({
      name: "character_professions_character_fk",
      columns: [t.guildId, t.characterId],
      foreignColumns: [characters.guildId, characters.id],
    }).onDelete("cascade"),
    unique("character_professions_unique").on(t.characterId, t.profession),
  ],
);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    characterName: text("character_name").notNull(),
    characterSurname: text("character_surname").notNull(),
    faction: factionEnum("faction").notNull(),
    wowClass: wowClassEnum("class").notNull(),
    spec: text("spec").notNull(),
    role: raidRoleEnum("role").notNull(),
    level: integer("level").notNull(),
    raidExperience: text("raid_experience").notNull(),
    availability: text("availability").notNull(),
    whyThisGuild: text("why_this_guild").notNull(),
    discordHandle: text("discord_handle").notNull(),
    respectsFaith: boolean("respects_faith").notNull(),
    /** Verified against the applicant's Battle.net character snapshot at submission. */
    verified: boolean("verified").notNull().default(false),
    bnetCharacterId: text("bnet_character_id"),
    /** Battle.net region of a verified application character (always the guild's); null for manual ones. */
    region: regionEnum("region"),
    realmSlug: text("realm_slug"),
    realmName: text("realm_name"),
    battletag: text("battletag"),
    bnetSnapshotAt: timestamp("bnet_snapshot_at", { withTimezone: true }),
    status: applicationStatusEnum("status").notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("applications_guild_id_id_key").on(t.guildId, t.id),
    uniqueIndex("applications_one_pending_per_user")
      .on(t.guildId, t.userId)
      .where(sql`${t.status} = 'pending'`),
    index("applications_guild_status_idx").on(t.guildId, t.status),
  ],
);

export const contentPages = pgTable(
  "content_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedByUserId: text("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("content_pages_guild_id_id_key").on(t.guildId, t.id),
    unique("content_pages_guild_slug_key").on(t.guildId, t.slug),
  ],
);

export const contentRevisions = pgTable(
  "content_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    pageId: uuid("page_id").notNull(),
    title: text("title").notNull(),
    bodyMd: text("body_md").notNull(),
    editedByUserId: text("edited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "content_revisions_page_fk",
      columns: [t.guildId, t.pageId],
      foreignColumns: [contentPages.guildId, contentPages.id],
    }).onDelete("cascade"),
  ],
);

export const raidScheduleSlots = pgTable(
  "raid_schedule_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    dayOfWeek: integer("day_of_week").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    label: text("label").notNull(),
    faction: factionEnum("faction"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [check("raid_schedule_slots_day_range", sql`${t.dayOfWeek} between 0 and 6`)],
);

export const recruitmentNeeds = pgTable(
  "recruitment_needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    wowClass: wowClassEnum("class").notNull(),
    role: raidRoleEnum("role").notNull(),
    faction: factionEnum("faction"),
    priority: recruitmentPriorityEnum("priority").notNull().default("closed"),
    note: text("note").notNull().default(""),
  },
  (t) => [unique("recruitment_needs_unique").on(t.guildId, t.wowClass, t.role, t.faction).nullsNotDistinct()],
);

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    size: integer("size").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("instances_guild_id_id_key").on(t.guildId, t.id),
    unique("instances_guild_name_key").on(t.guildId, t.name),
  ],
);

export const bosses = pgTable(
  "bosses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    unique("bosses_guild_id_id_key").on(t.guildId, t.id),
    foreignKey({
      name: "bosses_instance_fk",
      columns: [t.guildId, t.instanceId],
      foreignColumns: [instances.guildId, instances.id],
    }).onDelete("cascade"),
  ],
);

export const bossKills = pgTable(
  "boss_kills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    bossId: uuid("boss_id").notNull(),
    faction: factionEnum("faction").notNull(),
    killedAt: timestamp("killed_at", { withTimezone: true }).notNull(),
    wclReportCode: text("wcl_report_code"),
    note: text("note").notNull().default(""),
    recordedByUserId: text("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "boss_kills_boss_fk",
      columns: [t.guildId, t.bossId],
      foreignColumns: [bosses.guildId, bosses.id],
    }).onDelete("cascade"),
    index("boss_kills_boss_idx").on(t.bossId, t.faction, t.killedAt),
  ],
);

export const addons = pgTable(
  "addons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    status: addonStatusEnum("status").notNull().default("planned"),
    version: text("version"),
    downloadUrl: text("download_url"),
    sourceUrl: text("source_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [unique("addons_guild_slug_key").on(t.guildId, t.slug)],
);

export const vigilVisibilityEnum = pgEnum("vigil_visibility", ["private", "officers", "guild"]);

/** One analysed fight from a member's combat log. Only the per-fight summary is stored, never the log. */
export const vigilReports = pgTable(
  "vigil_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    characterId: uuid("character_id"),
    visibility: vigilVisibilityEnum("visibility").notNull().default("private"),
    fightLabel: text("fight_label").notNull(),
    fightKind: text("fight_kind").notNull(),
    encounterName: text("encounter_name"),
    playerName: text("player_name").notNull(),
    fightStartedAt: timestamp("fight_started_at", { withTimezone: true }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    modelId: text("model_id"),
    score: integer("score").notNull(),
    summary: jsonb("summary").notNull(),
    /** The game version Vigil detected from the log; null when it couldn't tell. */
    gameVersion: gameVersionEnum("game_version"),
    /** The detected version differs from the guild's (accepted with a warning until WoW: Forever launches). */
    versionMismatch: boolean("version_mismatch").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("vigil_reports_guild_id_id_key").on(t.guildId, t.id),
    foreignKey({
      name: "vigil_reports_membership_fk",
      columns: [t.guildId, t.membershipId],
      foreignColumns: [memberships.guildId, memberships.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "vigil_reports_character_fk",
      columns: [t.guildId, t.characterId],
      foreignColumns: [characters.guildId, characters.id],
    }).onDelete("cascade"),
    index("vigil_reports_owner_idx").on(t.guildId, t.membershipId, t.fightStartedAt),
    index("vigil_reports_shared_idx").on(t.guildId, t.visibility, t.createdAt),
    check("vigil_reports_score_range", sql`${t.score} between 0 and 100`),
    check("vigil_reports_fight_kind", sql`${t.fightKind} in ('boss', 'trash')`),
  ],
);

/** A member's default visibility for new reports. */
export const vigilPreferences = pgTable(
  "vigil_preferences",
  {
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").primaryKey(),
    defaultVisibility: vigilVisibilityEnum("default_visibility").notNull().default("private"),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "vigil_preferences_membership_fk",
      columns: [t.guildId, t.membershipId],
      foreignColumns: [memberships.guildId, memberships.id],
    }).onDelete("cascade"),
  ],
);

/** A short-lived code a member shows on the site and enters in the Vigil companion. Only its hash is stored. */
export const vigilCompanionPairings = pgTable(
  "vigil_companion_pairings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "vigil_companion_pairings_membership_fk",
      columns: [t.guildId, t.membershipId],
      foreignColumns: [memberships.guildId, memberships.id],
    }).onDelete("cascade"),
    index("vigil_companion_pairings_owner_idx").on(t.guildId, t.membershipId),
  ],
);

/**
 * A paired Vigil companion install, scoped to one membership. The device token is stored as a SHA-256 hash;
 * revoking sets `revoked_at`. The rate window counts uploads per minute across server instances.
 */
export const vigilCompanionDevices = pgTable(
  "vigil_companion_devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenHint: text("token_hint").notNull(),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rateWindowStart: timestamp("rate_window_start", { withTimezone: true }).notNull().defaultNow(),
    rateWindowCount: integer("rate_window_count").notNull().default(0),
  },
  (t) => [
    foreignKey({
      name: "vigil_companion_devices_membership_fk",
      columns: [t.guildId, t.membershipId],
      foreignColumns: [memberships.guildId, memberships.id],
    }).onDelete("cascade"),
    index("vigil_companion_devices_owner_idx").on(t.guildId, t.membershipId),
  ],
);

export const groupKindEnum = pgEnum("group_kind", GROUP_KINDS);
export const groupStatusEnum = pgEnum("group_status", GROUP_STATUSES);
export const groupRoleEnum = pgEnum("group_role", GROUP_ROLES);

/**
 * A raid, a dungeon run or a quick "looking for group" call, organised from Discord: the guild's Discord bot creates
 * it and records sign-ups through /api/bot/groups, and the members area shows it. Instances are the bot's own keys
 * and names (a guild's progression instances are a separate, officer-curated list).
 */
export const groupEvents = pgTable(
  "group_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    kind: groupKindEnum("kind").notNull(),
    instanceKey: text("instance_key").notNull(),
    instanceName: text("instance_name").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    /** Quick calls end on their own; scheduled groups end some hours after they start. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    leaderUserId: text("leader_user_id").references(() => users.id, { onDelete: "set null" }),
    tanks: smallint("tanks").notNull(),
    healers: smallint("healers").notNull(),
    dps: smallint("dps").notNull(),
    notes: text("notes").notNull().default(""),
    status: groupStatusEnum("status").notNull().default("open"),
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    discordChannelId: text("discord_channel_id"),
    discordMessageId: text("discord_message_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("group_events_guild_id_id_key").on(t.guildId, t.id),
    index("group_events_guild_starts_idx").on(t.guildId, t.startsAt),
    check("group_events_slots", sql`${t.tanks} >= 0 and ${t.healers} >= 0 and ${t.dps} >= 0 and ${t.tanks} + ${t.healers} + ${t.dps} between 1 and 40`),
  ],
);

/** One member's place in a group, with one of their characters. Order of sign-up decides who gets the slots. */
export const groupSignups = pgTable(
  "group_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull(),
    characterId: uuid("character_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: groupRoleEnum("role").notNull(),
    /** On the bench by their own choice or the leader's; otherwise it depends on the free slots. */
    bench: boolean("bench").notNull().default(false),
    /** Sign-up time: it orders the queue, and changing role or character moves you to its end. */
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "group_signups_event_fk",
      columns: [t.guildId, t.eventId],
      foreignColumns: [groupEvents.guildId, groupEvents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "group_signups_character_fk",
      columns: [t.guildId, t.characterId],
      foreignColumns: [characters.guildId, characters.id],
    }).onDelete("cascade"),
    unique("group_signups_event_user_key").on(t.eventId, t.userId),
  ],
);

/** Append-only; UPDATE and DELETE are rejected by a trigger (see drizzle migrations). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_guild_created_idx").on(t.guildId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Loot ledger
// ---------------------------------------------------------------------------

export const lootEntryKindEnum = pgEnum("loot_entry_kind", ["award", "reversal"]);
export const lootResponseEnum = pgEnum("loot_response", LOOT_RESPONSES);
export const lootSourceEnum = pgEnum("loot_source", LOOT_SOURCES);
export const lootImportStatusEnum = pgEnum("loot_import_status", ["draft", "committed", "discarded"]);
export const itemDataSourceEnum = pgEnum("item_data_source", ITEM_DATA_SOURCES);

/**
 * Item names, quality and icons per game version, shared by every guild of that version (not guild-scoped, like
 * `users`). Keyed by version rather than expansion: each version reads its own Game Data namespace, and versions of
 * one expansion still tune the same item IDs differently (Season of Discovery reworks Classic items; WoW: Forever
 * may too). Imports and the addon are the preferred sources. Blizzard Game Data API fields only fill gaps, and the
 * daily cron refreshes them or drops them within 30 days, as Blizzard's API terms require (`details_source =
 * 'blizzard'`, `name_source = 'blizzard'`).
 */
export const wowItems = pgTable(
  "wow_version_items",
  {
    gameVersion: gameVersionEnum("game_version").notNull(),
    itemId: integer("item_id").notNull(),
    name: text("name").notNull(),
    nameSource: itemDataSourceEnum("name_source").notNull(),
    quality: smallint("quality"),
    /** Icon file name, e.g. `inv_sword_39`. Icons are hotlinked from Blizzard's render CDN, never stored. */
    icon: text("icon"),
    itemLevel: smallint("item_level"),
    /** Source of quality, icon and item level; null when none is known. */
    detailsSource: itemDataSourceEnum("details_source"),
    /** When Blizzard data in this row was last fetched successfully. */
    blizzardFetchedAt: timestamp("blizzard_fetched_at", { withTimezone: true }),
    /** Last Blizzard lookup, successful or not, so missing items aren't retried on every run. */
    blizzardCheckedAt: timestamp("blizzard_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: "wow_version_items_pkey", columns: [t.gameVersion, t.itemId] }),
    index("wow_version_items_name_idx").on(t.gameVersion, sql`lower(${t.name})`),
    index("wow_version_items_blizzard_idx").on(t.blizzardFetchedAt),
    check("wow_version_items_quality_range", sql`${t.quality} between 0 and 7`),
    check("wow_version_items_item_id_positive", sql`${t.itemId} > 0`),
  ],
);

/**
 * The item cache from before versions (one row per item ID, whatever version it was fetched for). Migration 0023
 * copied it into `wow_version_items`; it stays only so code deployed before that migration keeps working during a
 * rolling deploy. Nothing reads it any more; the daily cron still drops its expired Blizzard data (API terms) until a
 * cleanup migration drops the table.
 */
export const legacyWowItems = pgTable(
  "wow_items",
  {
    itemId: integer("item_id").primaryKey(),
    name: text("name").notNull(),
    nameSource: itemDataSourceEnum("name_source").notNull(),
    quality: smallint("quality"),
    /** Icon file name, e.g. `inv_sword_39`. Icons are hotlinked from Blizzard's render CDN, never stored. */
    icon: text("icon"),
    itemLevel: smallint("item_level"),
    /** Source of quality, icon and item level; null when none is known. */
    detailsSource: itemDataSourceEnum("details_source"),
    /** When Blizzard data in this row was last fetched successfully. */
    blizzardFetchedAt: timestamp("blizzard_fetched_at", { withTimezone: true }),
    /** Last Blizzard lookup, successful or not, so missing items aren't retried on every run. */
    blizzardCheckedAt: timestamp("blizzard_checked_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("wow_items_name_idx").on(sql`lower(${t.name})`),
    index("wow_items_blizzard_idx").on(t.blizzardFetchedAt),
    check("wow_items_quality_range", sql`${t.quality} between 0 and 7`),
    check("wow_items_item_id_positive", sql`${t.itemId} > 0`),
  ],
);

/** A pasted Gargul or RCLootCouncil export, parsed and waiting for an officer to review and commit it. */
export const lootImportBatches = pgTable(
  "loot_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    parserId: text("parser_id").notNull(),
    source: lootSourceEnum("source").notNull(),
    status: lootImportStatusEnum("status").notNull().default("draft"),
    /** SHA-256 of the pasted text; the text itself isn't kept. */
    rawSha256: text("raw_sha256").notNull(),
    /** Parsed rows (with ISO dates), cleared once the batch is committed or discarded. */
    rows: jsonb("rows").$type<StoredParsedAward[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<{ line: number; message: string }[]>().notNull().default([]),
    rowCount: integer("row_count").notNull(),
    committedCount: integer("committed_count"),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("loot_import_batches_guild_id_id_key").on(t.guildId, t.id),
    index("loot_import_batches_guild_idx").on(t.guildId, t.createdAt),
  ],
);

export type StoredParsedAward = Omit<ParsedAward, "awardedAt"> & { awardedAt: string };

/**
 * The loot ledger. Append-only: a mistake is corrected with a reversal row, never an edit. The guard trigger
 * (drizzle/0013_loot_ledger_guard.sql) only lets reference columns become NULL when what they point at is deleted,
 * lets identity be replaced with "Deleted user" during account deletion, and lets a guild purge delete rows.
 *
 * The foreign keys to characters, instances, bosses, import batches and the reversed entry are declared in that
 * migration, not here: they're composite `(guild_id, x)` keys with `ON DELETE SET NULL (x)`, which Drizzle can't express.
 * Reversal rows copy the item, recipient and raid fields of the award they reverse.
 */
export const lootEntries = pgTable(
  "loot_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    kind: lootEntryKindEnum("kind").notNull(),
    reversesEntryId: uuid("reverses_entry_id"),
    itemId: integer("item_id").notNull(),
    itemName: text("item_name").notNull(),
    characterId: uuid("character_id"),
    /** The recipient's name at the time (a guild character's full name, or a pug's name); null for disenchant or bank. */
    recipientName: text("recipient_name"),
    response: lootResponseEnum("response").notNull(),
    /** The tool's own wording, e.g. RCLootCouncil's "Upgrade" or Gargul's roll type. */
    responseText: text("response_text"),
    votes: smallint("votes"),
    instanceId: uuid("instance_id"),
    instanceName: text("instance_name"),
    bossId: uuid("boss_id"),
    bossName: text("boss_name"),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull(),
    /** The raid night in the guild's time zone; groups the raid view. */
    raidDate: text("raid_date").notNull(),
    source: lootSourceEnum("source").notNull(),
    externalId: text("external_id"),
    importBatchId: uuid("import_batch_id"),
    note: text("note"),
    recordedByUserId: text("recorded_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("loot_entries_guild_id_id_key").on(t.guildId, t.id),
    uniqueIndex("loot_entries_one_reversal")
      .on(t.reversesEntryId)
      .where(sql`${t.kind} = 'reversal'`),
    uniqueIndex("loot_entries_external_award")
      .on(t.guildId, t.source, t.externalId)
      .where(sql`${t.kind} = 'award' and ${t.externalId} is not null`),
    index("loot_entries_guild_awarded_idx").on(t.guildId, t.awardedAt),
    index("loot_entries_character_idx").on(t.guildId, t.characterId),
    index("loot_entries_raid_idx").on(t.guildId, t.raidDate),
    check("loot_entries_reversal_target", sql`(${t.kind} = 'reversal') = (${t.reversesEntryId} is not null)`),
    check("loot_entries_item_id_positive", sql`${t.itemId} > 0`),
    check("loot_entries_raid_date_format", sql`${t.raidDate} ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
);

/** How an import name (e.g. "Cassian-Forever") maps to a guild character, remembered from earlier imports. */
export const lootNameAliases = pgTable(
  "loot_name_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: uuid("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    /** Normalised: lower case, single spaces. */
    alias: text("alias").notNull(),
    characterId: uuid("character_id").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("loot_name_aliases_guild_alias_key").on(t.guildId, t.alias),
    foreignKey({
      name: "loot_name_aliases_character_fk",
      columns: [t.guildId, t.characterId],
      foreignColumns: [characters.guildId, characters.id],
    }).onDelete("cascade"),
  ],
);

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/**
 * A support request from a signed-in user. Each one is emailed to the operator for now; a ticketing system can build
 * on the table later. Deleted with the account; the guild link is dropped when the guild is deleted.
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    guildId: uuid("guild_id").references(() => guilds.id, { onDelete: "set null" }),
    /** A key of SUPPORT_CATEGORIES in lib/support.ts. */
    category: text("category").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    /** Where to reply; null means reply through Discord. */
    replyTo: text("reply_to"),
    context: jsonb("context").$type<SupportTicketContext>().notNull().default({}),
    /** "open" until a ticketing system starts moving tickets on. */
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [index("support_tickets_user_created_idx").on(t.userId, t.createdAt)],
);
