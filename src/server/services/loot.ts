import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  bosses,
  characters,
  guilds,
  instances,
  lootEntries,
  lootImportBatches,
  lootNameAliases,
  memberships,
  type StoredParsedAward,
  wowItems,
} from "@/db/schema";
import type { Db } from "@/db/types";
import { type Actor, assertCan, AuthorizationError } from "@/lib/authz/policy";
import { fullName } from "@/lib/game";
import type { GuildVersion } from "@/lib/game-versions";
import { canViewLoot } from "@/lib/loot/access";
import { type ItemQuality, isItemQuality, type LootResponse, type LootSource, NO_RECIPIENT_RESPONSES } from "@/lib/loot/constants";
import { parseItemRef, placeholderItemName } from "@/lib/loot/items";
import { displayLootName, normalizeLootName } from "@/lib/loot/names";
import { getLootParser, LootParseError, parseLootExport } from "@/lib/loot/parsers";
import { dateInZone, zonedTime } from "@/lib/loot/time";
import type { ParsedAward } from "@/lib/loot/types";
import { lootAwardInputFor, lootCommitInput, lootImportInput, lootReverseInput } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { isUniqueViolation } from "@/server/db-errors";
import { DomainError, NotFoundError } from "@/server/errors";
import { findItemByName, type ItemLookupClient, listKnownItems, recordItemFacts, resolveItems } from "@/server/services/items";

/** Replaces a deleted user's name on their loot rows (same wording as the audit log's tombstone). */
const TOMBSTONE = "Usuario eliminado";
/** Drafts nobody committed are deleted after this long; they hold pasted names. */
const DRAFT_RETENTION_DAYS = 7;

// --- Access -----------------------------------------------------------------------------------------------------

async function guildLootSettings(db: Db, guildId: string) {
  const [guild] = await db
    .select({ timezone: guilds.timezone, lootPublic: guilds.lootPublic, gameVersion: guilds.gameVersion })
    .from(guilds)
    .where(eq(guilds.id, guildId));
  if (!guild) throw new NotFoundError("Guild");
  return guild;
}

async function assertViewLoot(db: Db, actor: Actor) {
  const guild = await guildLootSettings(db, actor.guildId);
  if (canViewLoot(actor, guild)) return guild;
  if (!actor.userId) throw new AuthorizationError("You must sign in with Discord.", "unauthenticated");
  throw new AuthorizationError("Requires member permissions.");
}

// --- Reading ----------------------------------------------------------------------------------------------------

const reversal = alias(lootEntries, "reversal");

export interface LootRow {
  id: string;
  itemId: number;
  itemName: string;
  quality: ItemQuality | null;
  icon: string | null;
  /** The guild's game version, whose item cache the details came from. */
  gameVersion: GuildVersion;
  itemFromBlizzard: boolean;
  character: { id: string; name: string; surname: string; wowClass: (typeof characters.$inferSelect)["wowClass"] } | null;
  recipientName: string | null;
  response: LootResponse;
  responseText: string | null;
  votes: number | null;
  instanceName: string | null;
  bossName: string | null;
  awardedAt: Date;
  raidDate: string;
  source: LootSource;
  note: string | null;
  reversal: { reason: string | null; at: Date } | null;
}

export interface LootFilter {
  characterId?: string | null;
  response?: LootResponse | null;
  raidDate?: string | null;
  limit?: number;
}

async function selectLoot(db: Db, guildId: string, filter: LootFilter): Promise<LootRow[]> {
  const conditions = [eq(lootEntries.guildId, guildId), eq(lootEntries.kind, "award")];
  if (filter.characterId) conditions.push(eq(lootEntries.characterId, filter.characterId));
  if (filter.response) conditions.push(eq(lootEntries.response, filter.response));
  if (filter.raidDate) conditions.push(eq(lootEntries.raidDate, filter.raidDate));
  const rows = await db
    .select({
      entry: lootEntries,
      quality: wowItems.quality,
      icon: wowItems.icon,
      nameSource: wowItems.nameSource,
      detailsSource: wowItems.detailsSource,
      cachedName: wowItems.name,
      gameVersion: guilds.gameVersion,
      charId: characters.id,
      charName: characters.name,
      charSurname: characters.surname,
      charClass: characters.wowClass,
      reversalNote: reversal.note,
      reversalAt: reversal.createdAt,
    })
    .from(lootEntries)
    .innerJoin(guilds, eq(guilds.id, lootEntries.guildId))
    .leftJoin(wowItems, and(eq(wowItems.gameVersion, guilds.gameVersion), eq(wowItems.itemId, lootEntries.itemId)))
    .leftJoin(characters, and(eq(characters.guildId, lootEntries.guildId), eq(characters.id, lootEntries.characterId)))
    .leftJoin(reversal, and(eq(reversal.reversesEntryId, lootEntries.id), eq(reversal.kind, "reversal")))
    .where(and(...conditions))
    .orderBy(desc(lootEntries.awardedAt), desc(lootEntries.createdAt))
    .limit(Math.min(filter.limit ?? 200, 1000));

  return rows.map((r) => {
    const e = r.entry;
    const placeholder = e.itemName === placeholderItemName(e.itemId);
    return {
      id: e.id,
      itemId: e.itemId,
      itemName: placeholder && r.cachedName ? r.cachedName : e.itemName,
      quality: isItemQuality(r.quality) ? r.quality : null,
      icon: r.icon,
      gameVersion: r.gameVersion,
      itemFromBlizzard: r.detailsSource === "blizzard" || (placeholder && r.nameSource === "blizzard"),
      character: r.charId ? { id: r.charId, name: r.charName!, surname: r.charSurname!, wowClass: r.charClass! } : null,
      recipientName: e.recipientName,
      response: e.response,
      responseText: e.responseText,
      votes: e.votes,
      instanceName: e.instanceName,
      bossName: e.bossName,
      awardedAt: e.awardedAt,
      raidDate: e.raidDate,
      source: e.source,
      note: e.note,
      reversal: r.reversalAt ? { reason: r.reversalNote, at: r.reversalAt } : null,
    };
  });
}

export async function listLoot(db: Db, actor: Actor, filter: LootFilter = {}) {
  await assertViewLoot(db, actor);
  return selectLoot(db, actor.guildId, filter);
}

export async function characterLoot(db: Db, actor: Actor, characterId: string) {
  await assertViewLoot(db, actor);
  return selectLoot(db, actor.guildId, { characterId, limit: 100 });
}

export async function raidLoot(db: Db, actor: Actor, raidDate: string) {
  await assertViewLoot(db, actor);
  return selectLoot(db, actor.guildId, { raidDate, limit: 1000 });
}

/** Raid nights with loot, newest first: how many items went out (not counting reversed awards) and where. */
export async function listRaidNights(db: Db, actor: Actor, limit = 30) {
  await assertViewLoot(db, actor);
  return db
    .select({
      raidDate: lootEntries.raidDate,
      items: sql<number>`count(*) filter (where ${reversal.id} is null)::int`,
      instances: sql<string[]>`coalesce(array_agg(distinct ${lootEntries.instanceName}) filter (where ${lootEntries.instanceName} is not null), '{}')`,
    })
    .from(lootEntries)
    .leftJoin(reversal, and(eq(reversal.reversesEntryId, lootEntries.id), eq(reversal.kind, "reversal")))
    .where(and(eq(lootEntries.guildId, actor.guildId), eq(lootEntries.kind, "award")))
    .groupBy(lootEntries.raidDate)
    .orderBy(desc(lootEntries.raidDate))
    .limit(limit);
}

// --- Recording by hand ------------------------------------------------------------------------------------------

/** Choices for the quick award form: the guild's current characters, its bosses, and items the cache knows. */
export async function awardFormOptions(db: Db, actor: Actor) {
  assertCan(actor, "loot.award");
  const { gameVersion } = await guildLootSettings(db, actor.guildId);
  const [chars, bossRows, items] = await Promise.all([
    db
      .select({ id: characters.id, name: characters.name, surname: characters.surname, wowClass: characters.wowClass })
      .from(characters)
      .innerJoin(memberships, and(eq(memberships.guildId, characters.guildId), eq(memberships.id, characters.membershipId)))
      .where(and(eq(characters.guildId, actor.guildId), isNull(characters.archivedAt), eq(memberships.status, "active")))
      .orderBy(asc(characters.name), asc(characters.surname)),
    db
      .select({ id: bosses.id, name: bosses.name, instanceName: instances.name })
      .from(bosses)
      .innerJoin(instances, and(eq(instances.guildId, bosses.guildId), eq(instances.id, bosses.instanceId)))
      .where(eq(bosses.guildId, actor.guildId))
      .orderBy(asc(instances.sortOrder), asc(instances.name), asc(bosses.sortOrder)),
    listKnownItems(db, gameVersion),
  ]);
  return { characters: chars, bosses: bossRows, items };
}

async function guildCharacter(db: Db, guildId: string, id: string) {
  const [c] = await db
    .select({ id: characters.id, name: characters.name, surname: characters.surname })
    .from(characters)
    .where(and(eq(characters.guildId, guildId), eq(characters.id, id)));
  if (!c) throw new NotFoundError("Character");
  return c;
}

/** An officer's quick award. The item may be an ID, link, Wowhead URL or a name the item cache knows. */
export async function awardLoot(db: Db, actor: Actor, raw: unknown, deps: { client?: ItemLookupClient | null; now?: Date } = {}) {
  assertCan(actor, "loot.award");
  const [guild] = await db.select({ gameVersion: guilds.gameVersion }).from(guilds).where(eq(guilds.id, actor.guildId));
  const input = lootAwardInputFor(guild?.gameVersion ?? "forever").parse(raw);
  const now = deps.now ?? new Date();
  const { timezone, gameVersion } = await guildLootSettings(db, actor.guildId);

  const ref = parseItemRef(input.item);
  let itemId: number;
  let itemName: string;
  if (!ref) throw new DomainError("Enter an item.");
  if (ref.itemId === null) {
    const known = await findItemByName(db, gameVersion, ref.name);
    if (!known) throw new DomainError(`No item called "${ref.name}" is known yet. Paste its item ID, in-game link or Wowhead link.`);
    itemId = known.itemId;
    itemName = known.name;
  } else {
    itemId = ref.itemId;
    if (ref.name) {
      await recordItemFacts(db, gameVersion, [{ itemId, name: ref.name, quality: null }], "manual");
      itemName = ref.name;
    } else {
      const known = (await resolveItems(db, [itemId], { client: deps.client, now, version: gameVersion })).get(itemId);
      itemName = known?.name ?? placeholderItemName(itemId);
    }
  }

  const recipient = NO_RECIPIENT_RESPONSES.has(input.response) || !input.characterId ? null : await guildCharacter(db, actor.guildId, input.characterId);
  let boss: { id: string; name: string; instanceId: string; instanceName: string } | null = null;
  if (input.bossId) {
    const [b] = await db
      .select({ id: bosses.id, name: bosses.name, instanceId: instances.id, instanceName: instances.name })
      .from(bosses)
      .innerJoin(instances, and(eq(instances.guildId, bosses.guildId), eq(instances.id, bosses.instanceId)))
      .where(and(eq(bosses.guildId, actor.guildId), eq(bosses.id, input.bossId)));
    if (!b) throw new NotFoundError("Boss");
    boss = b;
  }

  // Tonight's award keeps the real time; a back-dated one is placed at 8pm server time.
  const awardedAt =
    input.awardedOn === dateInZone(now, timezone)
      ? now
      : (zonedTime({ ...splitDate(input.awardedOn), hour: 20 }, timezone) ?? now);
  const recipientName = recipient ? fullName(recipient.name, recipient.surname) : null;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(lootEntries)
      .values({
        guildId: actor.guildId,
        kind: "award",
        itemId,
        itemName,
        characterId: recipient?.id ?? null,
        recipientName,
        response: input.response,
        instanceId: boss?.instanceId ?? null,
        instanceName: boss?.instanceName ?? null,
        bossId: boss?.id ?? null,
        bossName: boss?.name ?? null,
        awardedAt,
        raidDate: input.awardedOn,
        source: "manual",
        note: input.note,
        recordedByUserId: actor.userId,
      })
      .returning({ id: lootEntries.id });
    await recordAudit(tx, actor, {
      action: "loot.award",
      targetType: "loot_entry",
      targetId: row!.id,
      after: { itemId, itemName, characterName: recipientName, response: input.response, raidDate: input.awardedOn, note: input.note },
    });
    return { id: row!.id, itemName, recipientName };
  });
}

function splitDate(d: string) {
  const [year, month, day] = d.split("-").map(Number) as [number, number, number];
  return { year, month, day };
}

/** Undoes an award with a reversal row; the award itself is never edited. */
export async function reverseLoot(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "loot.reverse");
  const input = lootReverseInput.parse(raw);
  return db.transaction(async (tx) => {
    const [award] = await tx
      .select()
      .from(lootEntries)
      .where(and(eq(lootEntries.guildId, actor.guildId), eq(lootEntries.id, input.entryId)));
    if (!award) throw new NotFoundError("Loot entry");
    if (award.kind !== "award") throw new DomainError("Only awards can be reversed.");
    try {
      const [row] = await tx
        .insert(lootEntries)
        .values({
          guildId: actor.guildId,
          kind: "reversal",
          reversesEntryId: award.id,
          itemId: award.itemId,
          itemName: award.itemName,
          characterId: award.characterId,
          recipientName: award.recipientName,
          response: award.response,
          instanceId: award.instanceId,
          instanceName: award.instanceName,
          bossId: award.bossId,
          bossName: award.bossName,
          awardedAt: new Date(),
          raidDate: award.raidDate,
          source: "manual",
          note: input.reason,
          recordedByUserId: actor.userId,
        })
        .returning({ id: lootEntries.id });
      await recordAudit(tx, actor, {
        action: "loot.reverse",
        targetType: "loot_entry",
        targetId: award.id,
        after: { reversalId: row!.id, itemName: award.itemName, characterName: award.recipientName, reason: input.reason },
      });
      return { id: row!.id, itemName: award.itemName };
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError("That award has already been reversed.");
      throw err;
    }
  });
}

// --- Importing --------------------------------------------------------------------------------------------------

function toStored(rows: ParsedAward[]): StoredParsedAward[] {
  return rows.map((r) => ({ ...r, awardedAt: r.awardedAt.toISOString() }));
}

/** Parses a pasted export into a draft batch for review. Nothing reaches the ledger until it's committed. */
export async function previewImport(db: Db, actor: Actor, raw: unknown, deps: { client?: ItemLookupClient | null } = {}) {
  assertCan(actor, "loot.import");
  const input = lootImportInput.parse(raw);
  const { timezone, gameVersion } = await guildLootSettings(db, actor.guildId);
  if (input.parserId && !getLootParser(input.parserId)) throw new DomainError("Choose a known export format.");

  let parsed;
  try {
    parsed = parseLootExport(input.raw, { timezone, template: input.template ?? undefined, parserId: input.parserId ?? undefined });
  } catch (err) {
    if (err instanceof LootParseError) throw new DomainError(err.message);
    throw err;
  }
  if (parsed.rows.length === 0) {
    const first = parsed.warnings[0];
    throw new DomainError(`No awards found in that ${parsed.parser.label} export${first ? ` (line ${first.line}: ${first.message})` : ""}.`);
  }

  await recordItemFacts(
    db,
    gameVersion,
    parsed.rows.map((r) => ({ itemId: r.itemId, name: r.itemName, quality: r.itemQuality })),
    "import",
  );
  // Exports without item names (RCLootCouncil JSON, TMB) fall back to Blizzard's API for the gaps.
  const unnamed = parsed.rows.filter((r) => !r.itemName).map((r) => r.itemId);
  if (unnamed.length) await resolveItems(db, unnamed, { client: deps.client, version: gameVersion });

  const [batch] = await db
    .insert(lootImportBatches)
    .values({
      guildId: actor.guildId,
      parserId: parsed.parser.id,
      source: parsed.parser.source,
      rawSha256: createHash("sha256").update(input.raw).digest("hex"),
      rows: toStored(parsed.rows),
      warnings: parsed.warnings.slice(0, 200),
      rowCount: parsed.rows.length,
      createdByUserId: actor.userId,
    })
    .returning({ id: lootImportBatches.id });
  return { batchId: batch!.id, rows: parsed.rows.length, warnings: parsed.warnings.length, parser: parsed.parser.label };
}

export type MatchVia = "alias" | "name" | "first_name";

interface Candidate {
  id: string;
  name: string;
  surname: string;
  wowClass: (typeof characters.$inferSelect)["wowClass"];
  archived: boolean;
}

async function matchingContext(db: Db, guildId: string) {
  const [chars, aliases] = await Promise.all([
    db
      .select({ id: characters.id, name: characters.name, surname: characters.surname, wowClass: characters.wowClass, archivedAt: characters.archivedAt })
      .from(characters)
      .where(eq(characters.guildId, guildId))
      .orderBy(asc(characters.name), asc(characters.surname)),
    db.select({ alias: lootNameAliases.alias, characterId: lootNameAliases.characterId }).from(lootNameAliases).where(eq(lootNameAliases.guildId, guildId)),
  ]);
  const candidates: Candidate[] = chars.map((c) => ({ ...c, archived: c.archivedAt !== null }));
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const aliasMap = new Map(aliases.map((a) => [a.alias, a.characterId]));
  const byFullName = new Map<string, Candidate>();
  const byFirstName = new Map<string, Candidate[]>();
  for (const c of candidates) {
    byFullName.set(normalizeLootName(fullName(c.name, c.surname)), c);
    if (c.archived) continue;
    const first = normalizeLootName(c.name);
    byFirstName.set(first, [...(byFirstName.get(first) ?? []), c]);
  }

  const match = (key: string): { character: Candidate; via: MatchVia } | null => {
    const aliased = aliasMap.get(key);
    const aliasTarget = aliased ? byId.get(aliased) : undefined;
    if (aliasTarget) return { character: aliasTarget, via: "alias" };
    const full = byFullName.get(key);
    if (full) return { character: full, via: "name" };
    const firsts = byFirstName.get(key);
    if (firsts?.length === 1) return { character: firsts[0]!, via: "first_name" };
    return null;
  };
  return { candidates, byId, match };
}

async function draftBatch(db: Db, guildId: string, batchId: string, lock = false) {
  const q = db
    .select()
    .from(lootImportBatches)
    .where(and(eq(lootImportBatches.guildId, guildId), eq(lootImportBatches.id, batchId)));
  const [batch] = lock ? await q.for("update") : await q;
  if (!batch) throw new NotFoundError("Import");
  if (batch.status !== "draft") throw new DomainError(batch.status === "committed" ? "That import was already committed." : "That import was discarded.");
  return batch;
}

async function existingExternalIds(db: Db, guildId: string, source: LootSource, ids: string[]) {
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const rows = await db
      .select({ externalId: lootEntries.externalId })
      .from(lootEntries)
      .where(and(eq(lootEntries.guildId, guildId), eq(lootEntries.source, source), eq(lootEntries.kind, "award"), inArray(lootEntries.externalId, chunk)));
    for (const r of rows) if (r.externalId) found.add(r.externalId);
  }
  return found;
}

/** The review screen: each row with its recipient match and whether it's already in the ledger. */
export async function getImportPreview(db: Db, actor: Actor, batchId: string) {
  assertCan(actor, "loot.import");
  const batch = await draftBatch(db, actor.guildId, batchId);
  const { gameVersion } = await guildLootSettings(db, actor.guildId);
  const { candidates, match } = await matchingContext(db, actor.guildId);
  const duplicates = await existingExternalIds(db, actor.guildId, batch.source, batch.rows.map((r) => r.externalId));
  const items = await resolveItems(db, batch.rows.map((r) => r.itemId), { version: gameVersion });

  const names = new Map<string, { key: string; display: string; count: number; match: ReturnType<typeof match> }>();
  const rows = batch.rows.map((r, index) => {
    const key = r.recipient ? normalizeLootName(r.recipient.raw) : null;
    const m = key ? match(key) : null;
    if (key && r.recipient) {
      const entry = names.get(key) ?? { key, display: r.recipient.name, count: 0, match: m };
      entry.count++;
      names.set(key, entry);
    }
    const known = items.get(r.itemId);
    return {
      index,
      row: r,
      key,
      itemName: r.itemName ?? known?.name ?? placeholderItemName(r.itemId),
      quality: r.itemQuality ?? known?.quality ?? null,
      icon: known?.icon ?? null,
      itemFromBlizzard: !r.itemName && Boolean(known?.fromBlizzard),
      duplicate: duplicates.has(r.externalId),
    };
  });

  return {
    batch: { id: batch.id, parserId: batch.parserId, source: batch.source, rowCount: batch.rowCount, warnings: batch.warnings, createdAt: batch.createdAt },
    gameVersion,
    rows,
    names: [...names.values()].sort((a, b) => Number(Boolean(a.match)) - Number(Boolean(b.match)) || a.display.localeCompare(b.display)),
    characters: candidates.filter((c) => !c.archived),
    duplicateCount: rows.filter((r) => r.duplicate).length,
  };
}

function nameKey(value: string | null | undefined) {
  return value ? value.trim().toLowerCase() : null;
}

/**
 * Writes a reviewed batch to the ledger. Rows already recorded (same tool and award ID) are skipped, so the same
 * export, or Gargul's JSON and TMB exports of one raid, can be imported twice without doubling loot.
 */
export async function commitImport(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "loot.import");
  const input = lootCommitInput.parse(raw);
  const { timezone, gameVersion } = await guildLootSettings(db, actor.guildId);

  return db.transaction(async (tx) => {
    const batch = await draftBatch(tx, actor.guildId, input.batchId, true);
    const { byId, match } = await matchingContext(tx, actor.guildId);
    const items = await resolveItems(tx, batch.rows.map((r) => r.itemId), { version: gameVersion });
    const [instanceRows, bossRows] = await Promise.all([
      tx.select({ id: instances.id, name: instances.name, shortName: instances.shortName }).from(instances).where(eq(instances.guildId, actor.guildId)),
      tx.select({ id: bosses.id, name: bosses.name, instanceId: bosses.instanceId }).from(bosses).where(eq(bosses.guildId, actor.guildId)),
    ]);
    const findInstance = (name: string | null) => {
      const k = nameKey(name);
      return k ? instanceRows.find((i) => nameKey(i.name) === k || nameKey(i.shortName) === k) : undefined;
    };
    const findBoss = (name: string | null, instanceId: string | undefined) => {
      const k = nameKey(name);
      if (!k) return undefined;
      const named = bossRows.filter((b) => nameKey(b.name) === k);
      return (instanceId ? named.find((b) => b.instanceId === instanceId) : undefined) ?? (named.length === 1 ? named[0] : undefined);
    };

    const resolved = new Map<string, { character: Candidate | null; skip: boolean }>();
    const remembered: { alias: string; characterId: string }[] = [];
    const recipientFor = (key: string) => {
      const cached = resolved.get(key);
      if (cached) return cached;
      const decision = input.decisions[key];
      const auto = match(key);
      let result: { character: Candidate | null; skip: boolean };
      if (decision === "skip") result = { character: null, skip: true };
      else if (decision === "name") result = { character: null, skip: false };
      else if (decision?.startsWith("char:")) {
        const character = byId.get(decision.slice(5));
        if (!character) throw new DomainError("One of the chosen characters isn't in this guild.");
        result = { character, skip: false };
        if (input.remember && !(auto && auto.via !== "first_name" && auto.character.id === character.id)) {
          remembered.push({ alias: key, characterId: character.id });
        }
      } else result = { character: auto?.character ?? null, skip: false };
      resolved.set(key, result);
      return result;
    };

    let skipped = 0;
    const values: (typeof lootEntries.$inferInsert)[] = [];
    for (const r of batch.rows) {
      const key = r.recipient ? normalizeLootName(r.recipient.raw) : null;
      const who = key ? recipientFor(key) : { character: null, skip: false };
      if (who.skip) {
        skipped++;
        continue;
      }
      const instance = findInstance(r.instance);
      const boss = findBoss(r.boss, instance?.id);
      const awardedAt = new Date(r.awardedAt);
      values.push({
        guildId: actor.guildId,
        kind: "award",
        itemId: r.itemId,
        itemName: r.itemName ?? items.get(r.itemId)?.name ?? placeholderItemName(r.itemId),
        characterId: who.character?.id ?? null,
        recipientName: who.character
          ? fullName(who.character.name, who.character.surname)
          : r.recipient
            ? displayLootName(r.recipient.name)
            : null,
        response: r.response,
        responseText: r.responseText,
        votes: r.votes,
        instanceId: instance?.id ?? null,
        instanceName: instance?.name ?? r.instance,
        bossId: boss?.id ?? null,
        bossName: r.boss,
        awardedAt,
        raidDate: dateInZone(awardedAt, timezone),
        source: batch.source,
        externalId: r.externalId,
        importBatchId: batch.id,
        note: r.note,
        recordedByUserId: actor.userId,
      });
    }

    let inserted = 0;
    for (let i = 0; i < values.length; i += 500) {
      const rows = await tx.insert(lootEntries).values(values.slice(i, i + 500)).onConflictDoNothing().returning({ id: lootEntries.id });
      inserted += rows.length;
    }
    if (remembered.length) {
      await tx
        .insert(lootNameAliases)
        .values(remembered.map((a) => ({ guildId: actor.guildId, ...a, createdByUserId: actor.userId })))
        .onConflictDoUpdate({
          target: [lootNameAliases.guildId, lootNameAliases.alias],
          set: { characterId: sql`excluded.character_id`, createdByUserId: actor.userId },
        });
    }
    await tx
      .update(lootImportBatches)
      .set({ status: "committed", rows: [], committedCount: inserted, committedAt: new Date() })
      .where(eq(lootImportBatches.id, batch.id));
    const result = { inserted, duplicates: values.length - inserted, skipped };
    await recordAudit(tx, actor, {
      action: "loot.import",
      targetType: "loot_import",
      targetId: batch.id,
      after: { parser: batch.parserId, rows: batch.rowCount, ...result, remembered: remembered.length },
    });
    return result;
  });
}

export async function discardImport(db: Db, actor: Actor, batchId: string) {
  assertCan(actor, "loot.import");
  await db
    .update(lootImportBatches)
    .set({ status: "discarded", rows: [] })
    .where(and(eq(lootImportBatches.guildId, actor.guildId), eq(lootImportBatches.id, batchId), eq(lootImportBatches.status, "draft")));
}

/** Daily: drafts and discarded imports older than a week go, since drafts hold pasted player names. */
export async function purgeStaleLootDrafts(db: Db, now = new Date()) {
  const cutoff = new Date(now.getTime() - DRAFT_RETENTION_DAYS * 86_400_000);
  const rows = await db
    .delete(lootImportBatches)
    .where(and(inArray(lootImportBatches.status, ["draft", "discarded"]), lt(lootImportBatches.createdAt, cutoff)))
    .returning({ id: lootImportBatches.id });
  return rows.length;
}

// --- Privacy ----------------------------------------------------------------------------------------------------

/**
 * Account deletion: the user's loot stays in the ledger (it's guild history) but their name and the entry notes
 * become "Deleted user". The character link is dropped by the foreign key when their characters are deleted.
 */
export async function redactLootFor(
  tx: Db,
  target: { characterIds: readonly string[]; identifiers: ReadonlySet<string>; guildIds: readonly string[] },
) {
  const conditions = [];
  if (target.characterIds.length) conditions.push(inArray(lootEntries.characterId, [...target.characterIds]));
  if (target.guildIds.length && target.identifiers.size) {
    conditions.push(
      and(inArray(lootEntries.guildId, [...target.guildIds]), inArray(sql`lower(${lootEntries.recipientName})`, [...target.identifiers])),
    );
  }
  if (conditions.length === 0) return 0;
  await tx.execute(sql`select set_config('guildbook.audit_redact', 'on', true)`);
  const rows = await tx
    .update(lootEntries)
    .set({
      recipientName: sql`case when ${lootEntries.recipientName} is null then null else ${TOMBSTONE} end`,
      note: sql`case when ${lootEntries.note} is null then null else ${TOMBSTONE} end`,
    })
    .where(or(...conditions))
    .returning({ id: lootEntries.id });
  await tx.execute(sql`select set_config('guildbook.audit_redact', '', true)`);
  return rows.length;
}

/** Loot the user's characters received, for "Export my data". */
export async function exportLootFor(db: Db, characterIds: readonly string[]) {
  if (characterIds.length === 0) return [];
  return db
    .select({
      guildId: lootEntries.guildId,
      kind: lootEntries.kind,
      itemId: lootEntries.itemId,
      itemName: lootEntries.itemName,
      characterId: lootEntries.characterId,
      recipientName: lootEntries.recipientName,
      response: lootEntries.response,
      instanceName: lootEntries.instanceName,
      bossName: lootEntries.bossName,
      awardedAt: lootEntries.awardedAt,
      raidDate: lootEntries.raidDate,
      source: lootEntries.source,
      note: lootEntries.note,
    })
    .from(lootEntries)
    .where(inArray(lootEntries.characterId, [...characterIds]))
    .orderBy(asc(lootEntries.awardedAt));
}