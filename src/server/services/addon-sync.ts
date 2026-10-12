import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, isNull, lt, notInArray } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import {
  addonSyncReports,
  addonSyncTokens,
  characterAddonLinks,
  characterProfessions,
  characters,
  guilds,
  memberships,
  ranks,
  users,
} from "@/db/schema";
import { type Actor, AuthorizationError, assertCan, can, resolveTier } from "@/lib/authz/policy";
import { PROFESSION_BY_SKILL_LINE, type Profession } from "@/lib/game";
import { maxProfessionSkillFor } from "@/lib/game-versions";
import { addonProfessionsUpload, addonSyncTokenInput } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import { hashSecret } from "@/server/services/vigil-companion";

/**
 * The addon sync app: it reads the Guild Professions & Recipes addon's saved data on an officer's PC and sends the
 * guild's profession levels here. The addon shares every member's record with every member in game, so one officer's
 * file covers the whole guild; that is also why only officers may send it (a member could edit their file to change
 * other people's professions). Keys are stored as SHA-256 hashes and the sender's tier is re-read on every request.
 */

export const TOKEN_PREFIX = "gpra_";
export const MAX_TOKENS = 5;
/** Reports kept per guild for the admin page. */
export const REPORTS_KEPT = 20;
/** How far a record's time may run ahead of the server's clock (the addon allows the same). */
const FUTURE_SLACK_S = 300;
const MAX_UNMATCHED_LISTED = 200;

const newToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

function requireMembership(actor: Actor): string {
  if (!actor.membershipId) throw new DomainError("Necesitas ser miembro activo de la hermandad.");
  return actor.membershipId;
}

/** A new key for the actor. It is returned once and never shown again. */
export async function createSyncToken(db: Db, actor: Actor, raw: unknown): Promise<{ id: string; token: string }> {
  assertCan(actor, "addonSync.manage");
  const membershipId = requireMembership(actor);
  const input = addonSyncTokenInput.parse(raw);
  return db.transaction(async (tx) => {
    const [{ active } = { active: 0 }] = await tx
      .select({ active: count() })
      .from(addonSyncTokens)
      .where(and(eq(addonSyncTokens.guildId, actor.guildId), isNull(addonSyncTokens.revokedAt)));
    if (active >= MAX_TOKENS) {
      throw new DomainError(`La hermandad ya tiene ${MAX_TOKENS} claves activas. Anula alguna antes de crear otra.`);
    }
    const token = newToken();
    const [row] = await tx
      .insert(addonSyncTokens)
      .values({
        guildId: actor.guildId,
        membershipId,
        userId: actor.userId,
        name: input.name,
        tokenHash: hashSecret(token),
        tokenHint: token.slice(-4),
      })
      .returning({ id: addonSyncTokens.id });
    await recordAudit(tx, actor, { action: "addon_sync.token_create", targetType: "addon_sync_token", targetId: row!.id, after: { name: input.name } });
    return { id: row!.id, token };
  });
}

/** The guild's active keys, for any officer: one officer can revoke another's lost key. */
export async function listSyncTokens(db: Db, actor: Actor) {
  assertCan(actor, "addonSync.manage");
  const rows = await db
    .select({
      id: addonSyncTokens.id,
      name: addonSyncTokens.name,
      tokenHint: addonSyncTokens.tokenHint,
      createdAt: addonSyncTokens.createdAt,
      lastUsedAt: addonSyncTokens.lastUsedAt,
      ownerName: users.name,
      userId: addonSyncTokens.userId,
    })
    .from(addonSyncTokens)
    .innerJoin(users, eq(users.id, addonSyncTokens.userId))
    .where(and(eq(addonSyncTokens.guildId, actor.guildId), isNull(addonSyncTokens.revokedAt)))
    .orderBy(desc(addonSyncTokens.createdAt));
  return rows.map(({ userId, ...row }) => ({ ...row, own: userId === actor.userId }));
}

export async function revokeSyncToken(db: Db, actor: Actor, id: string) {
  assertCan(actor, "addonSync.manage");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Key");
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(addonSyncTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(addonSyncTokens.guildId, actor.guildId), eq(addonSyncTokens.id, id), isNull(addonSyncTokens.revokedAt)))
      .returning({ id: addonSyncTokens.id, name: addonSyncTokens.name });
    if (rows.length === 0) throw new NotFoundError("Key");
    await recordAudit(tx, actor, { action: "addon_sync.token_revoke", targetType: "addon_sync_token", targetId: id, before: { name: rows[0]!.name } });
  });
}

export interface SyncAuth {
  token: { id: string; name: string };
  guild: { id: string; slug: string; name: string };
  actor: Actor & { userId: string };
}

/** Resolves a bearer key to the officer it acts for, re-reading their tier: a demoted officer's key stops working. */
export async function authenticateSyncToken(db: Db, token: string | null | undefined): Promise<SyncAuth> {
  if (!token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    throw new AuthorizationError("Falta la clave del sincronizador. Créala en la web, en Administración.", "unauthenticated");
  }
  const [row] = await db
    .select({
      id: addonSyncTokens.id,
      name: addonSyncTokens.name,
      guildId: addonSyncTokens.guildId,
      membershipId: addonSyncTokens.membershipId,
      userId: addonSyncTokens.userId,
      lastUsedAt: addonSyncTokens.lastUsedAt,
      slug: guilds.slug,
      guildName: guilds.name,
      status: memberships.status,
      rankTier: ranks.tier,
    })
    .from(addonSyncTokens)
    .innerJoin(guilds, eq(guilds.id, addonSyncTokens.guildId))
    .innerJoin(memberships, and(eq(memberships.guildId, addonSyncTokens.guildId), eq(memberships.id, addonSyncTokens.membershipId)))
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(and(eq(addonSyncTokens.tokenHash, hashSecret(token)), isNull(addonSyncTokens.revokedAt)));
  if (!row) throw new AuthorizationError("Esa clave no existe o se anuló. Crea una nueva en la web.", "unauthenticated");

  const tier = resolveTier({ status: row.status, rankTier: row.rankTier });
  const actor = { guildId: row.guildId, userId: row.userId, membershipId: row.status === "active" ? row.membershipId : null, tier };
  if (!can(actor, "addonSync.manage")) throw new AuthorizationError("Esta clave es de alguien que ya no es oficial de la hermandad.");

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(addonSyncTokens).set({ lastUsedAt: new Date() }).where(eq(addonSyncTokens.id, row.id));
  }
  return { token: { id: row.id, name: row.name }, guild: { id: row.guildId, slug: row.slug, name: row.guildName }, actor };
}

/** "Name Surname" as the addon and the site both spell it, compared without case or doubled spaces. */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

export interface ProfessionsSyncResult {
  received: number;
  updated: number;
  unchanged: number;
  skippedOld: number;
  unmatched: string[];
}

type Wanted = { profession: Profession; skill: number | null };

function sameProfessions(current: Wanted[], wanted: Wanted[]) {
  const key = (list: Wanted[]) =>
    list
      .map((p) => `${p.profession}:${p.skill ?? ""}`)
      .sort()
      .join(",");
  return key(current) === key(wanted);
}

/**
 * Applies what the addon knows to the site's characters. A character is found by the GUID it was linked to before,
 * else by "Name Surname", else by first name when only one character has it. For each one:
 * - a copy older than the one already applied (the addon's `t`) is ignored, so two officers' files never fight;
 * - otherwise its professions become exactly the addon's (professions the site does not know are left out).
 */
export async function ingestProfessions(db: Db, auth: SyncAuth, raw: unknown, now: Date = new Date()): Promise<ProfessionsSyncResult> {
  const input = addonProfessionsUpload.parse(raw);
  const guildId = auth.guild.id;
  const nowS = Math.floor(now.getTime() / 1000);

  return db.transaction(async (tx) => {
    const [guild] = await tx.select({ gameVersion: guilds.gameVersion }).from(guilds).where(eq(guilds.id, guildId));
    const maxSkill = maxProfessionSkillFor(guild?.gameVersion ?? "forever");

    const roster = await tx
      .select({ id: characters.id, name: characters.name, surname: characters.surname })
      .from(characters)
      .innerJoin(memberships, and(eq(memberships.guildId, characters.guildId), eq(memberships.id, characters.membershipId)))
      .where(and(eq(characters.guildId, guildId), isNull(characters.archivedAt), eq(memberships.status, "active")));
    const byFullName = new Map(roster.map((c) => [nameKey(`${c.name} ${c.surname}`), c.id]));
    const byFirstName = new Map<string, string | null>();
    for (const c of roster) {
      const key = nameKey(c.name);
      byFirstName.set(key, byFirstName.has(key) ? null : c.id);
    }
    const links = await tx.select().from(characterAddonLinks).where(eq(characterAddonLinks.guildId, guildId));
    const linkByGuid = new Map(links.map((l) => [l.guid, l]));
    const linkByCharacter = new Map(links.map((l) => [l.characterId, l]));
    const rosterIds = new Set(roster.map((c) => c.id));

    // The newest copy of each character wins if the same one comes twice in one file.
    const latest = new Map<string, (typeof input.characters)[number]>();
    for (const c of input.characters) {
      const seen = latest.get(c.guid);
      if (!seen || c.t > seen.t) latest.set(c.guid, c);
    }

    const result: ProfessionsSyncResult = { received: latest.size, updated: 0, unchanged: 0, skippedOld: 0, unmatched: [] };
    const targets = new Map<string, { record: (typeof input.characters)[number]; wanted: Wanted[] }>();
    for (const record of latest.values()) {
      if (record.t > nowS + FUTURE_SLACK_S) {
        result.skippedOld++; // dated in the future: a broken clock, not newer data
        continue;
      }
      const linked = linkByGuid.get(record.guid)?.characterId;
      const characterId =
        (linked && rosterIds.has(linked) ? linked : undefined) ?? byFullName.get(nameKey(record.name)) ?? byFirstName.get(nameKey(record.name)) ?? null;
      if (!characterId) {
        if (result.unmatched.length < MAX_UNMATCHED_LISTED) result.unmatched.push(record.name);
        continue;
      }
      const link = linkByCharacter.get(characterId);
      const other = targets.get(characterId);
      if ((link && record.t < link.addonTime) || (other && record.t <= other.record.t)) {
        result.skippedOld++;
        continue;
      }
      const wanted: Wanted[] = [];
      for (const p of record.professions) {
        const profession = PROFESSION_BY_SKILL_LINE[p.skillLine];
        if (!profession || wanted.some((w) => w.profession === profession)) continue;
        wanted.push({ profession, skill: p.rank > 0 ? Math.min(p.rank, maxSkill) : null });
      }
      targets.set(characterId, { record, wanted });
    }

    const ids = [...targets.keys()];
    const currentRows = ids.length
      ? await tx
          .select({ characterId: characterProfessions.characterId, profession: characterProfessions.profession, skill: characterProfessions.skill })
          .from(characterProfessions)
          .where(and(eq(characterProfessions.guildId, guildId), inArray(characterProfessions.characterId, ids)))
      : [];
    for (const [characterId, { record, wanted }] of targets) {
      const current = currentRows.filter((r) => r.characterId === characterId);
      if (sameProfessions(current, wanted)) {
        result.unchanged++;
      } else {
        const keep = wanted.map((w) => w.profession);
        await tx
          .delete(characterProfessions)
          .where(
            and(
              eq(characterProfessions.characterId, characterId),
              keep.length ? notInArray(characterProfessions.profession, keep) : undefined,
            ),
          );
        for (const w of wanted) {
          await tx
            .insert(characterProfessions)
            .values({ guildId, characterId, profession: w.profession, skill: w.skill })
            .onConflictDoUpdate({ target: [characterProfessions.characterId, characterProfessions.profession], set: { skill: w.skill } });
        }
        result.updated++;
      }
      // A GUID belongs to one character: drop a stale link (a character re-created on the site) before linking.
      await tx.delete(characterAddonLinks).where(and(eq(characterAddonLinks.guildId, guildId), eq(characterAddonLinks.guid, record.guid)));
      await tx
        .insert(characterAddonLinks)
        .values({ characterId, guildId, guid: record.guid, addonTime: record.t })
        .onConflictDoUpdate({ target: characterAddonLinks.characterId, set: { guid: record.guid, addonTime: record.t, updatedAt: now } });
    }

    await tx.insert(addonSyncReports).values({
      guildId,
      userId: auth.actor.userId,
      tokenName: auth.token.name,
      addonVersion: input.addonVersion ?? null,
      received: result.received,
      updated: result.updated,
      unchanged: result.unchanged,
      skippedOld: result.skippedOld,
      unmatched: result.unmatched,
    });
    const [cutoff] = await tx
      .select({ createdAt: addonSyncReports.createdAt })
      .from(addonSyncReports)
      .where(eq(addonSyncReports.guildId, guildId))
      .orderBy(desc(addonSyncReports.createdAt))
      .offset(REPORTS_KEPT - 1)
      .limit(1);
    if (cutoff) {
      await tx.delete(addonSyncReports).where(and(eq(addonSyncReports.guildId, guildId), lt(addonSyncReports.createdAt, cutoff.createdAt)));
    }
    if (result.updated > 0) {
      await recordAudit(tx, auth.actor, {
        action: "addon_sync.professions",
        targetType: "guild",
        targetId: guildId,
        after: { key: auth.token.name, updated: result.updated, unmatched: result.unmatched.length },
      });
    }
    return result;
  });
}

/** The newest reports, for the admin page. */
export async function listSyncReports(db: Db, actor: Actor, limit = 5) {
  assertCan(actor, "addonSync.manage");
  return db
    .select({
      id: addonSyncReports.id,
      createdAt: addonSyncReports.createdAt,
      tokenName: addonSyncReports.tokenName,
      userName: users.name,
      addonVersion: addonSyncReports.addonVersion,
      received: addonSyncReports.received,
      updated: addonSyncReports.updated,
      unchanged: addonSyncReports.unchanged,
      skippedOld: addonSyncReports.skippedOld,
      unmatched: addonSyncReports.unmatched,
    })
    .from(addonSyncReports)
    .leftJoin(users, eq(users.id, addonSyncReports.userId))
    .where(eq(addonSyncReports.guildId, actor.guildId))
    .orderBy(desc(addonSyncReports.createdAt))
    .limit(limit);
}

export type SyncToken = Awaited<ReturnType<typeof listSyncTokens>>[number];
export type SyncReport = Awaited<ReturnType<typeof listSyncReports>>[number];
