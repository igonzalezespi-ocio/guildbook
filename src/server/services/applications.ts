import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/types";
import { applications, characters, guilds, memberships, ranks, users } from "@/db/schema";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { tierAtLeast } from "@/lib/authz/tiers";
import { APPLICATION_STATUS_LABELS as APPLICATION_STATUS_ES, fullName } from "@/lib/game";
import { applicationDecision, applicationInputFor, bnetCharacterId } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { DomainError, NotFoundError } from "@/server/errors";
import { resolveFaction } from "@/server/faction";
import { defaultEligibility, type Eligibility, resolveVerifiedCharacter } from "@/server/services/battlenet";

export const DRAFT_APPLICATIONS_CLOSED = "Esta hermandad aún no acepta solicitudes. Vuelve cuando esté publicada.";

/** Drafts take applications only through the private invite link an admin shares from the setup checklist. */
export function validDraftInvite(guild: { setup: { inviteCode?: string } }, given: unknown): boolean {
  const code = guild.setup.inviteCode;
  return Boolean(code) && typeof given === "string" && given === code;
}

async function loadGuild(tx: Db, guildId: string) {
  const [guild] = await tx.select().from(guilds).where(eq(guilds.id, guildId));
  if (!guild) throw new NotFoundError("Guild");
  return guild;
}

/**
 * A submission with `bnetCharacterId` is verified: name, class, level, faction and realm are taken from the
 * applicant's stored Battle.net snapshot, never from the form. Without it, the application is manual and unverified.
 */
export async function submitApplication(
  db: Db,
  actor: Actor,
  raw: unknown,
  eligibility: Eligibility = defaultEligibility(),
) {
  assertCan(actor, "application.submit");
  if (tierAtLeast(actor.tier, "member")) throw new DomainError("Ya eres miembro de la hermandad.");
  const form = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const claimed = typeof form.bnetCharacterId === "string" && form.bnetCharacterId.trim() !== "";
  const bnet = claimed
    ? await resolveVerifiedCharacter(db, actor, bnetCharacterId.parse(form.bnetCharacterId), eligibility)
    : null;
  const input = applicationInputFor(await loadGuild(db, actor.guildId)).parse(
    bnet
      ? {
          ...form,
          characterName: bnet.character.name,
          characterSurname: bnet.character.surname ?? form.characterSurname,
          wowClass: bnet.character.wowClass,
          level: bnet.character.level,
          faction: bnet.character.faction,
        }
      : form,
  );
  const verification = bnet
    ? {
        verified: true,
        bnetCharacterId: bnet.character.id,
        region: bnet.character.region ?? "us",
        realmSlug: bnet.character.realmSlug,
        realmName: bnet.character.realmName,
        battletag: bnet.link.battletag,
        bnetSnapshotAt: bnet.link.snapshotAt,
      }
    : { verified: false };

  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    if (!guild.publishedAt && !validDraftInvite(guild, form.invite)) throw new DomainError(DRAFT_APPLICATIONS_CLOSED);
    if (!guild.recruitmentOpen) throw new DomainError("El reclutamiento está cerrado ahora mismo.");
    if (!guild.applicantRankId) throw new DomainError("La hermandad no ha configurado un rango para aspirantes.");
    const faction = await resolveFaction(tx, actor.guildId, input.faction);

    const [pending] = await tx
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.guildId, actor.guildId),
          eq(applications.userId, actor.userId),
          eq(applications.status, "pending"),
        ),
      );
    if (pending) throw new DomainError("Ya tienes una solicitud en revisión.");

    await tx
      .insert(memberships)
      .values({ guildId: actor.guildId, userId: actor.userId, rankId: guild.applicantRankId, status: "applicant" })
      .onConflictDoUpdate({
        target: [memberships.guildId, memberships.userId],
        set: { status: "applicant", rankId: guild.applicantRankId, updatedAt: sql`now()` },
      });

    const [application] = await tx
      .insert(applications)
      .values({ guildId: actor.guildId, userId: actor.userId, ...input, faction, ...verification })
      .returning();
    if (!application) throw new Error("Insert failed");

    await recordAudit(tx, actor, {
      action: "application.submit",
      targetType: "application",
      targetId: application.id,
      after: {
        characterName: fullName(input.characterName, input.characterSurname),
        wowClass: input.wowClass,
        faction,
        verified: verification.verified,
      },
    });
    return application;
  });
}

export async function withdrawApplication(db: Db, actor: Actor, applicationId: string) {
  assertCan(actor, "application.viewOwn");
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(applications)
      .set({ status: "withdrawn" })
      .where(
        and(
          eq(applications.guildId, actor.guildId),
          eq(applications.id, applicationId),
          eq(applications.userId, actor.userId),
          eq(applications.status, "pending"),
        ),
      )
      .returning({
        id: applications.id,
        characterName: applications.characterName,
        characterSurname: applications.characterSurname,
      });
    if (!row) throw new NotFoundError("Pending application");
    await tx
      .update(memberships)
      .set({ status: "former", updatedAt: sql`now()` })
      .where(
        and(
          eq(memberships.guildId, actor.guildId),
          eq(memberships.userId, actor.userId),
          eq(memberships.status, "applicant"),
        ),
      );
    await recordAudit(tx, actor, {
      action: "application.withdraw",
      targetType: "application",
      targetId: row.id,
      after: { characterName: fullName(row.characterName, row.characterSurname) },
    });
    return row;
  });
}

/**
 * Accepting or trialing an applicant activates their membership at the guild's configured
 * rank and registers the applied character. Declining returns an applicant to "former".
 */
export async function reviewApplication(db: Db, actor: Actor, raw: unknown) {
  assertCan(actor, "application.review");
  const { applicationId, decision, note } = applicationDecision.parse(raw);

  return db.transaction(async (tx) => {
    const guild = await loadGuild(tx, actor.guildId);
    const [app] = await tx
      .select()
      .from(applications)
      .where(and(eq(applications.guildId, actor.guildId), eq(applications.id, applicationId)))
      .for("update");
    if (!app) throw new NotFoundError("Application");
    if (app.status !== "pending") throw new DomainError(`Esta solicitud ya estaba ${APPLICATION_STATUS_ES[app.status] ?? app.status}.`);

    await tx
      .update(applications)
      .set({ status: decision, reviewedByUserId: actor.userId, reviewedAt: new Date(), decisionNote: note })
      .where(eq(applications.id, app.id));

    const [membership] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.guildId, actor.guildId), eq(memberships.userId, app.userId)));

    let rankName: string | null = null;
    if (decision === "declined") {
      if (membership?.status === "applicant") {
        await tx
          .update(memberships)
          .set({ status: "former", updatedAt: sql`now()` })
          .where(eq(memberships.id, membership.id));
      }
    } else {
      const rankId = decision === "accepted" ? guild.acceptRankId : guild.trialRankId;
      if (!rankId) throw new DomainError(`La hermandad no ha configurado un rango para los aspirantes «${APPLICATION_STATUS_ES[decision] ?? decision}».`);
      const [rank] = await tx
        .select({ name: ranks.name })
        .from(ranks)
        .where(and(eq(ranks.guildId, actor.guildId), eq(ranks.id, rankId)));
      rankName = rank?.name ?? null;

      const [active] = await tx
        .insert(memberships)
        .values({ guildId: actor.guildId, userId: app.userId, rankId, status: "active", joinedAt: new Date() })
        .onConflictDoUpdate({
          target: [memberships.guildId, memberships.userId],
          set: {
            rankId,
            status: "active",
            joinedAt: sql`coalesce(${memberships.joinedAt}, now())`,
            leftAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning();
      if (!active) throw new Error("Membership upsert failed");

      const sameName = and(
        sql`lower(${characters.name}) = lower(${app.characterName})`,
        sql`lower(${characters.surname}) = lower(${app.characterSurname})`,
      );
      const [existing] = await tx
        .select({ id: characters.id, membershipId: characters.membershipId })
        .from(characters)
        .where(
          and(
            eq(characters.guildId, actor.guildId),
            app.bnetCharacterId ? or(sameName, eq(characters.bnetCharacterId, app.bnetCharacterId)) : sameName,
            isNull(characters.archivedAt),
          ),
        );
      if (existing && existing.membershipId !== active.id) {
        throw new DomainError(`Otro miembro ya ha registrado a ${fullName(app.characterName, app.characterSurname)}.`);
      }
      const verification = app.verified
        ? {
            verified: true,
            bnetCharacterId: app.bnetCharacterId,
            region: app.region,
            realmSlug: app.realmSlug,
            realmName: app.realmName,
            syncedAt: app.bnetSnapshotAt,
          }
        : {};
      if (existing && app.verified) {
        await tx
          .update(characters)
          .set({
            ...verification,
            name: app.characterName,
            surname: app.characterSurname,
            wowClass: app.wowClass,
            level: app.level,
            updatedAt: sql`now()`,
          })
          .where(eq(characters.id, existing.id));
      }
      if (!existing) {
        const [hasMain] = await tx
          .select({ id: characters.id })
          .from(characters)
          .where(
            and(eq(characters.membershipId, active.id), eq(characters.isMain, true), isNull(characters.archivedAt)),
          );
        await tx.insert(characters).values({
          guildId: actor.guildId,
          membershipId: active.id,
          name: app.characterName,
          surname: app.characterSurname,
          faction: app.faction,
          wowClass: app.wowClass,
          spec: app.spec,
          role: app.role,
          level: app.level,
          isMain: !hasMain,
          ...verification,
        });
      }
    }

    await recordAudit(tx, actor, {
      action: `application.${decision === "accepted" ? "accept" : decision === "trial" ? "trial" : "decline"}`,
      targetType: "application",
      targetId: app.id,
      before: { status: app.status },
      after: { status: decision, note, characterName: fullName(app.characterName, app.characterSurname) },
    });
    return { ...app, status: decision, rankName };
  });
}

export async function listApplications(db: Db, actor: Actor, status?: (typeof applications.$inferSelect)["status"]) {
  assertCan(actor, "application.review");
  return db
    .select({
      application: applications,
      applicant: { name: users.name, discordUsername: users.discordUsername, image: users.image },
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(eq(applications.guildId, actor.guildId), status ? eq(applications.status, status) : undefined))
    .orderBy(desc(applications.createdAt));
}

export async function getApplication(db: Db, actor: Actor, id: string) {
  assertCan(actor, "application.review");
  const [row] = await db
    .select({
      application: applications,
      applicant: { name: users.name, discordUsername: users.discordUsername, image: users.image },
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(eq(applications.guildId, actor.guildId), eq(applications.id, id)));
  return row ?? null;
}

export async function listOwnApplications(db: Db, actor: Actor) {
  assertCan(actor, "application.viewOwn");
  return db
    .select()
    .from(applications)
    .where(and(eq(applications.guildId, actor.guildId), eq(applications.userId, actor.userId)))
    .orderBy(desc(applications.createdAt));
}
