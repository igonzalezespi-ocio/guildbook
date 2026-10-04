import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import { accounts, applications, auditLog, battlenetLinks, characters, guilds, memberships, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { stripOAuthTokens } from "@/server/auth-adapter";
import { BlizzardClient } from "@/server/blizzard/client";
import { blizzardConfigFromEnv } from "@/server/blizzard/config";
import { createMockFetch } from "@/server/blizzard/mock";
import { DomainError } from "@/server/errors";
import {
  DELETED_USER_ID,
  TOMBSTONE,
  applicationRetentionDays,
  deleteGuild,
  deleteUserAccount,
  exportUserData,
  planAccountDeletion,
  purgeStaleApplications,
} from "@/server/services/account";
import { reviewApplication, submitApplication, withdrawApplication } from "@/server/services/applications";
import {
  type BattlenetDeps,
  getEligibleCharacters,
  importBattlenetCharacter,
  linkBattlenetAccount,
  runGuildCharacterSync,
  unlinkBattlenet,
} from "@/server/services/battlenet";
import { createCharacter } from "@/server/services/characters";
import { listAuditLog } from "@/server/services/content";
import { createGuild, createMember, createTestDb, createVisitor, reloadActor, validApplication } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

const character = { faction: "alliance", wowClass: "paladin", spec: "Holy", role: "healer", level: "60", professions: [] };

/** Drizzle wraps database errors; the trigger's message is on the cause. */
async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const e = err as Error & { cause?: Error };
    return `${e.message} ${e.cause?.message ?? ""}`;
  }
  return "resolved";
}

async function auditRows(guildId: string) {
  return db.select().from(auditLog).where(eq(auditLog.guildId, guildId)).orderBy(auditLog.createdAt);
}

describe("Discord OAuth tokens", () => {
  it("are stripped before the adapter stores the account", async () => {
    const adapter = stripOAuthTokens(
      DrizzleAdapter(db as unknown as Parameters<typeof DrizzleAdapter>[0], {
        usersTable: schema.users,
        accountsTable: schema.accounts,
        sessionsTable: schema.sessions,
        verificationTokensTable: schema.verificationTokens,
      }),
    );
    const user = await adapter.createUser!({ id: crypto.randomUUID(), email: "oauth@example.com", emailVerified: null, name: "Oauth" });
    await adapter.linkAccount!({
      userId: user.id,
      type: "oauth",
      provider: "discord",
      providerAccountId: "discord-oauth-1",
      access_token: "access-secret",
      refresh_token: "refresh-secret",
      id_token: "id-secret",
      expires_at: 1_900_000_000,
      token_type: "bearer",
      scope: "identify email",
    });
    const [row] = await db.select().from(accounts).where(eq(accounts.providerAccountId, "discord-oauth-1"));
    expect(row).toMatchObject({
      provider: "discord",
      userId: user.id,
      access_token: null,
      refresh_token: null,
      id_token: null,
      expires_at: null,
      scope: "identify email",
    });
  });
});

describe("audit redaction guard", () => {
  it("still rejects ordinary updates and deletes", async () => {
    const guild = await createGuild(db);
    await submitApplication(db, await createVisitor(db, guild.guild.id), validApplication);
    const [row] = await auditRows(guild.guild.id);
    expect(await rejection(db.update(auditLog).set({ action: "tampered" }).where(eq(auditLog.id, row!.id)))).toMatch(/append-only/);
    expect(await rejection(db.delete(auditLog).where(eq(auditLog.id, row!.id)))).toMatch(/append-only/);
  });

  it("in redaction mode allows only tombstones, never action, timestamp or other values", async () => {
    const guild = await createGuild(db);
    await submitApplication(db, await createVisitor(db, guild.guild.id), validApplication);
    const [row] = await auditRows(guild.guild.id);
    const attempt = (set: Partial<typeof auditLog.$inferInsert>) =>
      db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('guildbook.audit_redact', 'on', true)`);
        await tx.update(auditLog).set(set).where(eq(auditLog.id, row!.id));
      });
    expect(await rejection(attempt({ action: "character.delete" }))).toMatch(/redaction/);
    expect(await rejection(attempt({ createdAt: new Date(0) }))).toMatch(/redaction/);
    expect(await rejection(attempt({ after: { ...(row!.after as object), level: 1 } }))).toMatch(/redaction/);
    expect(await rejection(attempt({ after: { characterName: TOMBSTONE } }))).toMatch(/redaction/);
    const someoneElse = await createVisitor(db, guild.guild.id);
    expect(await rejection(attempt({ actorUserId: someoneElse.userId }))).toMatch(/redaction/);
    const otherGuild = await createGuild(db);
    const purgeOther = db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('guildbook.audit_purge_guild', ${otherGuild.guild.id}, true)`);
      await tx.delete(auditLog).where(eq(auditLog.id, row!.id));
    });
    expect(await rejection(purgeOther)).toMatch(/append-only/);

    await attempt({ after: { ...(row!.after as object), characterName: TOMBSTONE } });
    const [after] = await db.select().from(auditLog).where(eq(auditLog.id, row!.id));
    expect(after!.after).toMatchObject({ characterName: TOMBSTONE });
    expect(after!.action).toBe(row!.action);
    // The setting is transaction-local, so the next statement is append-only again.
    expect(await rejection(db.update(auditLog).set({ after: row!.after }).where(eq(auditLog.id, row!.id)))).toMatch(/append-only/);
  });
});

describe("account deletion", () => {
  it("removes the user's data, keeps audit rows and replaces their identity with Usuario eliminado", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    await createCharacter(db, marshal, { ...character, name: "Ironvow", surname: "Thornwall" });
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication);
    await reviewApplication(db, marshal, { applicationId: app.id, decision: "accepted", note: "Welcome Joanofarc Domremy" });
    const member = await reloadActor(db, visitor);
    const { id: characterId } = (
      await db.select({ id: characters.id }).from(characters).where(eq(characters.membershipId, member.membershipId!))
    )[0]!;
    const before = await auditRows(guild.guild.id);

    const exported = await exportUserData(db, visitor.userId);
    expect(exported.user.id).toBe(visitor.userId);
    expect(exported.applications).toHaveLength(1);
    expect(exported.characters.map((c) => c.id)).toContain(characterId);
    expect(exported.auditEntriesByYou.map((e) => e.action)).toContain("application.submit");
    expect(JSON.stringify(exported)).not.toMatch(/token_hash|access_token_enc/i);

    const [visitorRow] = await db.select().from(users).where(eq(users.id, visitor.userId));
    await expect(deleteUserAccount(db, visitor.userId, "wrong name")).rejects.toBeInstanceOf(DomainError);
    await deleteUserAccount(db, visitor.userId, visitorRow!.name!.toUpperCase());

    expect(await db.select().from(users).where(eq(users.id, visitor.userId))).toHaveLength(0);
    expect(await db.select().from(memberships).where(eq(memberships.userId, visitor.userId))).toHaveLength(0);
    expect(await db.select().from(applications).where(eq(applications.userId, visitor.userId))).toHaveLength(0);
    expect(await db.select().from(characters).where(eq(characters.id, characterId))).toHaveLength(0);

    const after = await auditRows(guild.guild.id);
    expect(after.map((r) => [r.id, r.action, r.createdAt.getTime()])).toEqual(before.map((r) => [r.id, r.action, r.createdAt.getTime()]));
    const text = JSON.stringify(after);
    expect(text).not.toContain("Joanofarc Domremy");
    expect(text).not.toContain(visitor.userId);
    expect(after.find((r) => r.action === "application.submit")!.actorUserId).toBe(DELETED_USER_ID);
    // The officer's own identity is untouched.
    expect(after.find((r) => r.action === "application.accept")!.actorUserId).toBe(marshal.userId);

    const log = await listAuditLog(db, marshal);
    expect(log.find((r) => r.entry.action === "application.submit")!.actorName).toBe(TOMBSTONE);
  });

  it("blocks the sole admin of a guild with other members and explains how to hand over", async () => {
    const guild = await createGuild(db);
    const gm = await createMember(db, guild, "Grand Master");
    await createMember(db, guild, "Knight");
    const [gmUser] = await db.select().from(users).where(eq(users.id, gm.userId));
    expect((await planAccountDeletion(db, gm.userId)).blockers.map((g) => g.slug)).toEqual([guild.guild.slug]);
    await expect(deleteUserAccount(db, gm.userId, gmUser!.name!)).rejects.toThrow(/only admin.*Promote another member/);

    await createMember(db, guild, "Seneschal");
    expect((await planAccountDeletion(db, gm.userId)).blockers).toEqual([]);
    await deleteUserAccount(db, gm.userId, gmUser!.name!);
    expect(await db.select().from(guilds).where(eq(guilds.id, guild.guild.id))).toHaveLength(1);
  });

  it("deletes guilds where the user is the only member, audit history included", async () => {
    const guild = await createGuild(db);
    const gm = await createMember(db, guild, "Grand Master");
    await createCharacter(db, gm, { ...character, name: "Soloist", surname: "Alone" });
    const [gmUser] = await db.select().from(users).where(eq(users.id, gm.userId));
    const result = await deleteUserAccount(db, gm.userId, gmUser!.name!);
    expect(result.deletedGuilds).toEqual([guild.guild.slug]);
    expect(await db.select().from(guilds).where(eq(guilds.id, guild.guild.id))).toHaveLength(0);
    expect(await auditRows(guild.guild.id)).toHaveLength(0);
  });
});

describe("guild deletion", () => {
  it("lets the owner delete the guild after typing its name; officers can't", async () => {
    const guild = await createGuild(db);
    const gm = await createMember(db, guild, "Grand Master");
    const marshal = await createMember(db, guild, "Marshal");
    await createCharacter(db, marshal, { ...character, name: "Leftbehind", surname: "Stone" });
    await expect(deleteGuild(db, marshal, guild.guild.name)).rejects.toThrow();
    await expect(deleteGuild(db, gm, "nope")).rejects.toThrow(/Type/);
    await expect(deleteGuild(db, gm, guild.guild.name, { protectedSlug: guild.guild.slug })).rejects.toThrow(/default guild/);
    await deleteGuild(db, gm, guild.guild.name);
    expect(await db.select().from(guilds).where(eq(guilds.id, guild.guild.id))).toHaveLength(0);
    expect(await db.select().from(memberships).where(eq(memberships.guildId, guild.guild.id))).toHaveLength(0);
  });
});

describe("Battle.net unlink", () => {
  it("keeps the character but unverifies it, so the sync stops reading it", async () => {
    const config = { ...blizzardConfigFromEnv({}), mock: true };
    const deps: BattlenetDeps = { client: new BlizzardClient(config, createMockFetch()), tokenKey: Buffer.alloc(32, 7) };
    const guild = await createGuild(db, { faction: "alliance" });
    const member = await createMember(db, guild, "Knight");
    await linkBattlenetAccount(db, member, { code: `mock-${member.userId}`, redirectUri: "http://localhost:3000/api/battlenet/callback" }, deps);
    const { characters: eligible } = await getEligibleCharacters(db, member, { realmSlugs: [] });
    const bnet = eligible[0]!;
    const { character: imported } = await importBattlenetCharacter(
      db,
      member,
      { bnetCharacterId: bnet.id, surname: "Linked", spec: "Holy", role: "healer" },
      { realmSlugs: [] },
    );
    expect((await runGuildCharacterSync(db, guild.guild.id, null, deps.client)).checked).toBe(1);

    await unlinkBattlenet(db, member);
    const [row] = await db.select().from(characters).where(eq(characters.id, imported.id));
    expect(row).toMatchObject({ verified: false, bnetCharacterId: null, syncedAt: null, name: imported.name, archivedAt: null });
    expect(await db.select().from(battlenetLinks).where(eq(battlenetLinks.userId, member.userId))).toHaveLength(0);

    const calls: string[] = [];
    const mock = createMockFetch();
    const spy = new BlizzardClient(config, (async (...args: Parameters<typeof mock>) => {
      calls.push(String(args[0]));
      return mock(...args);
    }) as typeof mock);
    expect((await runGuildCharacterSync(db, guild.guild.id, null, spy)).checked).toBe(0);
    expect(calls).toEqual([]);

    const unlinkEntry = (await auditRows(guild.guild.id)).find((r) => r.action === "battlenet.unlink");
    expect(JSON.stringify(unlinkEntry)).not.toMatch(/#\d{4}/);
  });
});

describe("application retention", () => {
  it("deletes withdrawn and declined applications past the retention period and redacts their audit names", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const withdrawer = await createVisitor(db, guild.guild.id);
    const decliner = await createVisitor(db, guild.guild.id);
    const pending = await createVisitor(db, guild.guild.id);
    const w = await submitApplication(db, withdrawer, { ...validApplication, characterName: "Withdrawn" });
    await withdrawApplication(db, withdrawer, w.id);
    const d = await submitApplication(db, decliner, { ...validApplication, characterName: "Declined" });
    await reviewApplication(db, marshal, { applicationId: d.id, decision: "declined" });
    const p = await submitApplication(db, pending, { ...validApplication, characterName: "Pending" });

    const now = new Date();
    expect((await purgeStaleApplications(db, 180, now)).deleted).toBe(0);
    const later = new Date(now.getTime() + 181 * 86_400_000);
    expect((await purgeStaleApplications(db, 180, later)).deleted).toBe(2);
    const left = await db.select({ id: applications.id }).from(applications).where(eq(applications.guildId, guild.guild.id));
    expect(left.map((a) => a.id)).toEqual([p.id]);

    const text = JSON.stringify(await auditRows(guild.guild.id));
    expect(text).not.toContain("Withdrawn Domremy");
    expect(text).not.toContain("Declined Domremy");
    expect(text).toContain("Pending Domremy");
  });

  it("reads the period from APPLICATION_RETENTION_DAYS", () => {
    expect(applicationRetentionDays({})).toBe(180);
    expect(applicationRetentionDays({ APPLICATION_RETENTION_DAYS: "30" })).toBe(30);
    expect(applicationRetentionDays({ APPLICATION_RETENTION_DAYS: "nope" })).toBe(180);
  });
});
