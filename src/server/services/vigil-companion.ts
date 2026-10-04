import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { characters, guilds, memberships, ranks, users, vigilCompanionDevices, vigilCompanionPairings } from "@/db/schema";
import { type Actor, AuthorizationError, assertCan, can, resolveTier } from "@/lib/authz/policy";
import { fightReportSchema } from "@/lib/vigil/report";
import { VISIBILITIES } from "@/lib/vigil/visibility";
import { DomainError, NotFoundError } from "@/server/errors";
import { createVigilReport, getVigilPreferences } from "@/server/services/vigil";

/**
 * Pairing and device tokens for the Vigil companion desktop app. A signed-in member creates a short code on
 * the site; the app exchanges it once for a long-lived device token. Codes and tokens are stored as SHA-256
 * hashes, so a database leak does not hand out working credentials.
 */

export const PAIRING_TTL_MS = 10 * 60_000;
export const MAX_DEVICES = 10;
export const UPLOADS_PER_MINUTE = 30;
export const TOKEN_PREFIX = "osmv_";

/** No 0/O or 1/I, so a code read off one screen types cleanly into another. 32 symbols: no modulo bias. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function newPairingCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const newDeviceToken = () => `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;

function requireMembership(actor: Actor): string {
  if (!actor.membershipId) throw new DomainError("Necesitas ser miembro activo para usar Vigil.");
  return actor.membershipId;
}

/** A fresh pairing code for the actor. Any earlier unused code stops working. */
export async function createPairingCode(db: Db, actor: Actor): Promise<{ code: string; expiresAt: Date }> {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(vigilCompanionPairings)
      .where(
        and(
          eq(vigilCompanionPairings.guildId, actor.guildId),
          eq(vigilCompanionPairings.membershipId, membershipId),
          isNull(vigilCompanionPairings.usedAt),
        ),
      );
    await tx.insert(vigilCompanionPairings).values({
      guildId: actor.guildId,
      membershipId,
      userId: actor.userId,
      codeHash: hashSecret(normalizePairingCode(code)),
      expiresAt,
    });
  });
  return { code, expiresAt };
}

const exchangeInput = z.object({
  code: z.string().min(4).max(40),
  deviceName: z.string().trim().min(1).max(80).default("Vigil companion"),
});

const INVALID_CODE = "Ese código de emparejamiento no es válido o ha caducado. Crea uno nuevo en el sitio.";

/** Trades a pairing code for a device token. Each code works once, within its lifetime, for an active member. */
export async function exchangePairingCode(db: Db, raw: unknown) {
  const input = exchangeInput.parse(raw);
  const normalized = normalizePairingCode(input.code);
  if (normalized.length !== 8) throw new DomainError(INVALID_CODE);

  return db.transaction(async (tx) => {
    const [pairing] = await tx
      .update(vigilCompanionPairings)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(vigilCompanionPairings.codeHash, hashSecret(normalized)),
          isNull(vigilCompanionPairings.usedAt),
          gt(vigilCompanionPairings.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!pairing) throw new DomainError(INVALID_CODE);

    const actor = await loadActor(tx, pairing.guildId, pairing.membershipId, pairing.userId);
    if (!can(actor, "vigil.use")) throw new DomainError(INVALID_CODE);

    const [{ active } = { active: 0 }] = await tx
      .select({ active: count() })
      .from(vigilCompanionDevices)
      .where(and(eq(vigilCompanionDevices.membershipId, pairing.membershipId), isNull(vigilCompanionDevices.revokedAt)));
    if (active >= MAX_DEVICES) {
      throw new DomainError(`Ya tienes ${MAX_DEVICES} apps emparejadas. Revoca una en el sitio primero.`);
    }

    const token = newDeviceToken();
    const [device] = await tx
      .insert(vigilCompanionDevices)
      .values({
        guildId: pairing.guildId,
        membershipId: pairing.membershipId,
        userId: pairing.userId,
        name: input.deviceName,
        tokenHash: hashSecret(token),
        tokenHint: token.slice(-4),
      })
      .returning({ id: vigilCompanionDevices.id, name: vigilCompanionDevices.name });
    const [guild] = await tx
      .select({ slug: guilds.slug, name: guilds.name, gameVersion: guilds.gameVersion })
      .from(guilds)
      .where(eq(guilds.id, pairing.guildId));
    return { token, device: device!, guild: guild!, guildId: pairing.guildId };
  });
}

async function loadActor(db: Db, guildId: string, membershipId: string, userId: string): Promise<Actor & { userId: string }> {
  const [row] = await db
    .select({ status: memberships.status, rankTier: ranks.tier })
    .from(memberships)
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(and(eq(memberships.guildId, guildId), eq(memberships.id, membershipId), eq(memberships.userId, userId)));
  const tier = resolveTier(row ?? null);
  return { guildId, userId, membershipId: row?.status === "active" ? membershipId : null, tier };
}

export interface DeviceAuth {
  device: { id: string; name: string };
  guild: { id: string; slug: string; name: string };
  actor: Actor & { userId: string };
}

/**
 * Resolves a bearer device token to the member it acts for. The tier is read from the database on every
 * call, so a member who leaves or is demoted below Vigil access loses upload rights at once.
 */
export async function authenticateDevice(db: Db, token: string | null | undefined): Promise<DeviceAuth> {
  if (!token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) {
    throw new AuthorizationError("Primero empareja esta app con el sitio.", "unauthenticated");
  }
  const [row] = await db
    .select({
      id: vigilCompanionDevices.id,
      name: vigilCompanionDevices.name,
      guildId: vigilCompanionDevices.guildId,
      membershipId: vigilCompanionDevices.membershipId,
      userId: vigilCompanionDevices.userId,
      lastUsedAt: vigilCompanionDevices.lastUsedAt,
      slug: guilds.slug,
      guildName: guilds.name,
    })
    .from(vigilCompanionDevices)
    .innerJoin(guilds, eq(guilds.id, vigilCompanionDevices.guildId))
    .where(and(eq(vigilCompanionDevices.tokenHash, hashSecret(token)), isNull(vigilCompanionDevices.revokedAt)));
  if (!row) throw new AuthorizationError("Esta app no está emparejada o se revocó. Vuelve a emparejarla.", "unauthenticated");

  const actor = await loadActor(db, row.guildId, row.membershipId, row.userId);
  if (!can(actor, "vigil.use")) throw new AuthorizationError("Tu pertenencia ya no incluye Vigil.");

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
    await db.update(vigilCompanionDevices).set({ lastUsedAt: new Date() }).where(eq(vigilCompanionDevices.id, row.id));
  }
  return {
    device: { id: row.id, name: row.name },
    guild: { id: row.guildId, slug: row.slug, name: row.guildName },
    actor,
  };
}

/** Counts one upload against the device's per-minute window; atomic, so it holds across server instances. */
export async function takeUploadQuota(db: Db, deviceId: string): Promise<{ ok: true } | { ok: false; retryAfterS: number }> {
  const stale = sql`${vigilCompanionDevices.rateWindowStart} <= now() - interval '60 seconds'`;
  const [row] = await db
    .update(vigilCompanionDevices)
    .set({
      rateWindowCount: sql`case when ${stale} then 1 else ${vigilCompanionDevices.rateWindowCount} + 1 end`,
      rateWindowStart: sql`case when ${stale} then now() else ${vigilCompanionDevices.rateWindowStart} end`,
    })
    .where(eq(vigilCompanionDevices.id, deviceId))
    .returning({ count: vigilCompanionDevices.rateWindowCount, start: vigilCompanionDevices.rateWindowStart });
  if (!row || row.count <= UPLOADS_PER_MINUTE) return { ok: true };
  return { ok: false, retryAfterS: Math.max(1, Math.ceil((row.start.getTime() + 60_000 - Date.now()) / 1000)) };
}

const uploadInput = z.object({
  report: z.unknown(),
  /** Overrides the member's default for this report; omitted or null uses the default (private unless changed). */
  visibility: z.enum(VISIBILITIES).nullish(),
  /** The guild the app believes it is paired with; a mismatch is refused rather than silently rerouted. */
  guild: z.string().max(64).nullish(),
});

/** Stores one fight from the companion through the same service as the browser upload. */
export async function uploadCompanionReport(db: Db, auth: DeviceAuth, raw: unknown, now: Date = new Date()) {
  const input = uploadInput.parse(raw);
  if (input.guild && input.guild !== auth.guild.slug) {
    throw new AuthorizationError("Esta app está emparejada con otra hermandad.");
  }
  const parsed = fightReportSchema.safeParse(input.report);
  const playerName = parsed.success ? parsed.data.player.name : null;
  let characterId: string | null = null;
  if (playerName) {
    const [own] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(
        and(
          eq(characters.guildId, auth.guild.id),
          eq(characters.membershipId, auth.actor.membershipId!),
          isNull(characters.archivedAt),
          sql`lower(${characters.name}) = lower(${playerName})`,
        ),
      )
      .orderBy(desc(characters.isMain))
      .limit(1);
    characterId = own?.id ?? null;
  }
  return createVigilReport(db, auth.actor, { report: input.report, characterId, visibility: input.visibility ?? null }, now);
}

/** What the app shows once paired, and the characters it uses to narrow rotation detection. */
export async function companionProfile(db: Db, auth: DeviceAuth) {
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.actor.userId));
  const chars = await db
    .select({ name: characters.name, surname: characters.surname, wowClass: characters.wowClass, level: characters.level })
    .from(characters)
    .where(
      and(
        eq(characters.guildId, auth.guild.id),
        eq(characters.membershipId, auth.actor.membershipId!),
        isNull(characters.archivedAt),
      ),
    )
    .orderBy(desc(characters.isMain), asc(characters.name));
  const { defaultVisibility } = await getVigilPreferences(db, auth.actor);
  const [guild] = await db.select({ gameVersion: guilds.gameVersion }).from(guilds).where(eq(guilds.id, auth.guild.id));
  return {
    guild: { slug: auth.guild.slug, name: auth.guild.name, gameVersion: guild?.gameVersion ?? "forever" },
    user: { name: user?.name ?? null },
    device: auth.device,
    defaultVisibility,
    characters: chars,
  };
}

export async function listCompanionDevices(db: Db, actor: Actor) {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  return db
    .select({
      id: vigilCompanionDevices.id,
      name: vigilCompanionDevices.name,
      tokenHint: vigilCompanionDevices.tokenHint,
      createdAt: vigilCompanionDevices.createdAt,
      lastUsedAt: vigilCompanionDevices.lastUsedAt,
    })
    .from(vigilCompanionDevices)
    .where(
      and(
        eq(vigilCompanionDevices.guildId, actor.guildId),
        eq(vigilCompanionDevices.membershipId, membershipId),
        isNull(vigilCompanionDevices.revokedAt),
      ),
    )
    .orderBy(desc(vigilCompanionDevices.createdAt));
}

export async function revokeCompanionDevice(db: Db, actor: Actor, id: string) {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Device");
  const rows = await db
    .update(vigilCompanionDevices)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(vigilCompanionDevices.guildId, actor.guildId),
        eq(vigilCompanionDevices.membershipId, membershipId),
        eq(vigilCompanionDevices.id, id),
        isNull(vigilCompanionDevices.revokedAt),
      ),
    )
    .returning({ id: vigilCompanionDevices.id });
  if (rows.length === 0) throw new NotFoundError("Device");
}

export type CompanionDevice = Awaited<ReturnType<typeof listCompanionDevices>>[number];
