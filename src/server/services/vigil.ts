import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { characters, guilds, memberships, users, vigilPreferences, vigilReports } from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { tierAtLeast } from "@/lib/authz/tiers";
import { type GuildVersion, VERSION_INFO, versionHasLaunched, versionLaunchLabel } from "@/lib/game-versions";
import { reportGameVersion } from "@/lib/vigil/game-version";
import { fightReportSchema, MAX_REPORT_BYTES, type FightReport } from "@/lib/vigil/report";
import { canViewReport, VISIBILITIES, type Visibility } from "@/lib/vigil/visibility";
import { recordAudit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";

const visibilityInput = z.enum(VISIBILITIES);

const createInput = z.object({
  report: z.unknown(),
  characterId: z.uuid().nullish(),
  visibility: visibilityInput.nullish(),
});

function requireMembership(actor: Actor): string {
  if (!actor.membershipId) throw new DomainError("Necesitas ser miembro activo para usar Vigil.");
  return actor.membershipId;
}

export async function getVigilPreferences(db: Db, actor: Actor): Promise<{ defaultVisibility: Visibility }> {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  const [row] = await db
    .select({ defaultVisibility: vigilPreferences.defaultVisibility })
    .from(vigilPreferences)
    .where(and(eq(vigilPreferences.guildId, actor.guildId), eq(vigilPreferences.membershipId, membershipId)));
  return { defaultVisibility: row?.defaultVisibility ?? "private" };
}

/** A log from another game than the guild's, refused once WoW: Forever is live. */
export class VersionMismatchError extends DomainError {
  readonly code = "version_mismatch";
}

export interface ReportVersionCheck {
  /** The game the log came from, when the log says. */
  gameVersion: GuildVersion | null;
  versionMismatch: boolean;
  /** Shown to the uploader when the report was kept despite the mismatch. */
  warning: string | null;
}

/**
 * Whether a report's game matches its guild. Until WoW: Forever launches, Forever guilds test with logs from other
 * games, so a mismatch is kept with a warning; from launch day it is refused.
 */
export function checkReportVersion(
  report: FightReport,
  guild: { name: string; gameVersion: GuildVersion },
  now: Date = new Date(),
): ReportVersionCheck {
  const gameVersion = reportGameVersion(report);
  if (!gameVersion || gameVersion === guild.gameVersion) return { gameVersion, versionMismatch: false, warning: null };
  const log = VERSION_INFO[gameVersion].label;
  const mismatch = `Este registro es de ${log}; ${guild.name} es una hermandad de ${VERSION_INFO[guild.gameVersion].label}.`;
  if (versionHasLaunched("forever", now)) throw new VersionMismatchError(`${mismatch} Empareja Vigil con tu hermandad de ${log}.`);
  return {
    gameVersion,
    versionMismatch: true,
    warning: `${mismatch} El informe se ha guardado con un aviso. A partir del ${versionLaunchLabel("forever")}, Vigil rechaza registros de otro juego, así que empareja Vigil con tu hermandad de ${log}.`,
  };
}

/**
 * Stores one fight's summary. Creation is not audited: the audit log is officer-visible and a private
 * report must not leave a trace officers can read.
 */
export async function createVigilReport(db: Db, actor: Actor, raw: unknown, now: Date = new Date()) {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  const input = createInput.parse(raw);
  if (JSON.stringify(input.report ?? null).length > MAX_REPORT_BYTES) {
    throw new DomainError("El informe de este combate es demasiado grande para subirlo. Prueba con un combate más corto.");
  }
  const parsed = fightReportSchema.safeParse(input.report);
  if (!parsed.success) throw new DomainError("El informe no tiene un formato que Vigil entienda. Recarga e inténtalo de nuevo.");
  const report = parsed.data;

  return db.transaction(async (tx) => {
    const [guild] = await tx.select({ name: guilds.name, gameVersion: guilds.gameVersion }).from(guilds).where(eq(guilds.id, actor.guildId));
    if (!guild) throw new NotFoundError("Guild");
    const check = checkReportVersion(report, guild, now);
    if (input.characterId) {
      const [own] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(
          and(
            eq(characters.guildId, actor.guildId),
            eq(characters.id, input.characterId),
            eq(characters.membershipId, membershipId),
            isNull(characters.archivedAt),
          ),
        );
      if (!own) throw new NotFoundError("Character");
    }
    const visibility = input.visibility ?? (await getVigilPreferences(tx, actor)).defaultVisibility;
    const [row] = await tx
      .insert(vigilReports)
      .values({
        guildId: actor.guildId,
        membershipId,
        characterId: input.characterId ?? null,
        visibility,
        fightLabel: report.fight.label,
        fightKind: report.fight.kind,
        encounterName: report.fight.encounter?.name ?? null,
        playerName: report.player.name,
        fightStartedAt: new Date(report.fight.startedAt),
        durationMs: report.fight.durationMs,
        modelId: report.model?.id ?? null,
        score: report.score.overall,
        gameVersion: check.gameVersion,
        versionMismatch: check.versionMismatch,
        summary: report,
      })
      .returning({ id: vigilReports.id });
    if (!row) throw new Error("Insert failed");
    return { ...row, ...check };
  });
}

const listColumns = {
  id: vigilReports.id,
  membershipId: vigilReports.membershipId,
  visibility: vigilReports.visibility,
  fightLabel: vigilReports.fightLabel,
  fightKind: vigilReports.fightKind,
  encounterName: vigilReports.encounterName,
  playerName: vigilReports.playerName,
  fightStartedAt: vigilReports.fightStartedAt,
  durationMs: vigilReports.durationMs,
  modelId: vigilReports.modelId,
  score: vigilReports.score,
  gameVersion: vigilReports.gameVersion,
  versionMismatch: vigilReports.versionMismatch,
  createdAt: vigilReports.createdAt,
  characterName: characters.name,
  characterSurname: characters.surname,
  characterClass: characters.wowClass,
};

export async function listOwnVigilReports(db: Db, actor: Actor) {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  return db
    .select(listColumns)
    .from(vigilReports)
    .leftJoin(characters, eq(characters.id, vigilReports.characterId))
    .where(and(eq(vigilReports.guildId, actor.guildId), eq(vigilReports.membershipId, membershipId)))
    .orderBy(desc(vigilReports.fightStartedAt))
    .limit(200);
}

/** Other members' reports this actor may read: guild-shared for members, officer-shared too for officers. */
export async function listSharedVigilReports(db: Db, actor: Actor) {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  const shared: Visibility[] = tierAtLeast(actor.tier, "officer") ? ["guild", "officers"] : ["guild"];
  return db
    .select({ ...listColumns, ownerName: users.name })
    .from(vigilReports)
    .innerJoin(
      memberships,
      and(eq(memberships.guildId, vigilReports.guildId), eq(memberships.id, vigilReports.membershipId)),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(characters, eq(characters.id, vigilReports.characterId))
    .where(
      and(
        eq(vigilReports.guildId, actor.guildId),
        ne(vigilReports.membershipId, membershipId),
        eq(memberships.status, "active"),
        inArray(vigilReports.visibility, shared),
      ),
    )
    .orderBy(desc(vigilReports.createdAt))
    .limit(100);
}

/** A report the actor may read, or NotFound (never "forbidden", so private reports stay invisible). */
export async function getVigilReport(db: Db, actor: Actor, id: string) {
  assertCan(actor, "vigil.use");
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Report");
  const [row] = await db
    .select({ ...listColumns, summary: vigilReports.summary, ownerStatus: memberships.status, ownerName: users.name })
    .from(vigilReports)
    .innerJoin(
      memberships,
      and(eq(memberships.guildId, vigilReports.guildId), eq(memberships.id, vigilReports.membershipId)),
    )
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(characters, eq(characters.id, vigilReports.characterId))
    .where(and(eq(vigilReports.guildId, actor.guildId), eq(vigilReports.id, id)));
  if (!row || !canViewReport(actor, { ...row, ownerActive: row.ownerStatus === "active" })) {
    throw new NotFoundError("Report");
  }
  const { summary, ownerStatus: _status, ...meta } = row;
  return { ...meta, isOwner: actor.membershipId === row.membershipId, report: summary as FightReport };
}

async function loadOwnReport(tx: Db, actor: Actor, id: string) {
  const membershipId = requireMembership(actor);
  if (!z.uuid().safeParse(id).success) throw new NotFoundError("Report");
  const [row] = await tx
    .select({ id: vigilReports.id, visibility: vigilReports.visibility, fightLabel: vigilReports.fightLabel })
    .from(vigilReports)
    .where(
      and(eq(vigilReports.guildId, actor.guildId), eq(vigilReports.id, id), eq(vigilReports.membershipId, membershipId)),
    );
  if (!row) throw new NotFoundError("Report");
  return row;
}

export async function setVigilReportVisibility(db: Db, actor: Actor, id: string, raw: unknown) {
  assertCan(actor, "vigil.use");
  const visibility = visibilityInput.parse(raw);
  return db.transaction(async (tx) => {
    const current = await loadOwnReport(tx, actor, id);
    const result = { fightLabel: current.fightLabel, visibility, changed: current.visibility !== visibility };
    if (!result.changed) return result;
    await tx.update(vigilReports).set({ visibility }).where(eq(vigilReports.id, id));
    await recordAudit(tx, actor, {
      action: "vigil.visibility",
      targetType: "vigil_report",
      targetId: id,
      before: { visibility: current.visibility },
      after: { visibility },
    });
    return result;
  });
}

/** Sets the default for new reports and, when asked, applies it to every existing report of this player. */
export async function setVigilDefaultVisibility(db: Db, actor: Actor, raw: unknown, applyToExisting = false) {
  assertCan(actor, "vigil.use");
  const membershipId = requireMembership(actor);
  const visibility = visibilityInput.parse(raw);
  await db.transaction(async (tx) => {
    const before = await getVigilPreferences(tx, actor);
    await tx
      .insert(vigilPreferences)
      .values({ guildId: actor.guildId, membershipId, defaultVisibility: visibility })
      .onConflictDoUpdate({ target: vigilPreferences.membershipId, set: { defaultVisibility: visibility, updatedAt: new Date() } });
    let changed = 0;
    if (applyToExisting) {
      const rows = await tx
        .update(vigilReports)
        .set({ visibility })
        .where(
          and(
            eq(vigilReports.guildId, actor.guildId),
            eq(vigilReports.membershipId, membershipId),
            ne(vigilReports.visibility, visibility),
          ),
        )
        .returning({ id: vigilReports.id });
      changed = rows.length;
    }
    if (before.defaultVisibility !== visibility || changed > 0) {
      await recordAudit(tx, actor, {
        action: "vigil.default_visibility",
        targetType: "membership",
        targetId: membershipId,
        before: { defaultVisibility: before.defaultVisibility },
        after: { defaultVisibility: visibility, reportsChanged: changed },
      });
    }
  });
}

export async function deleteVigilReport(db: Db, actor: Actor, id: string) {
  assertCan(actor, "vigil.use");
  return db.transaction(async (tx) => {
    const current = await loadOwnReport(tx, actor, id);
    await tx.delete(vigilReports).where(eq(vigilReports.id, id));
    await recordAudit(tx, actor, {
      action: "vigil.delete",
      targetType: "vigil_report",
      targetId: id,
      before: { visibility: current.visibility },
    });
    return { fightLabel: current.fightLabel };
  });
}

export type VigilReportListItem = Awaited<ReturnType<typeof listOwnVigilReports>>[number];
export type SharedVigilReport = Awaited<ReturnType<typeof listSharedVigilReports>>[number];
