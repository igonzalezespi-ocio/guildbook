import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, memberships } from "@/db/schema";
import type { Db } from "@/db/types";
import { AuthorizationError } from "@/lib/authz/policy";
import { DomainError, NotFoundError } from "@/server/errors";
import { getApplication, reviewApplication, submitApplication } from "@/server/services/applications";
import { updateContentPage } from "@/server/services/content";
import { assignRank, createRank, removeMember, updateRank } from "@/server/services/ranks";
import { createGuild, createMember, createTestDb, createVisitor, validApplication } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

describe("services enforce permissions on the server", () => {
  it("rejects a raider reviewing applications", async () => {
    const guild = await createGuild(db);
    const knight = await createMember(db, guild, "Knight");
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication);
    await expect(reviewApplication(db, knight, { applicationId: app.id, decision: "accepted" })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it("rejects a signed-out visitor submitting an application", async () => {
    const guild = await createGuild(db);
    await expect(
      submitApplication(db, { guildId: guild.guild.id, userId: null, membershipId: null, tier: "public" }, validApplication),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects an officer editing ranks (admin only)", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    await expect(
      createRank(db, marshal, { name: "Pilgrim", description: "", tier: "member", inGame: "on" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("lets an officer edit the charter and records it in the audit log", async () => {
    const guild = await createGuild(db);
    const chaplain = await createMember(db, guild, "Chaplain");
    await updateContentPage(db, chaplain, { slug: "prayer", title: "Prayer", bodyMd: "Sancte Michael…" });
    const rows = await db.select().from(auditLog).where(eq(auditLog.guildId, guild.guild.id));
    expect(rows.some((r) => r.action === "content.edit" && r.actorUserId === chaplain.userId)).toBe(true);
  });

  it("does not let officers grant a tier above their own", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const squire = await createMember(db, guild, "Squire");
    const seneschal = guild.rankId("Seneschal");
    await expect(assignRank(db, marshal, { membershipId: squire.membershipId, rankId: seneschal })).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await assignRank(db, marshal, { membershipId: squire.membershipId, rankId: guild.rankId("Knight") });
    const [row] = await db.select().from(memberships).where(eq(memberships.id, squire.membershipId!));
    expect(row!.rankId).toBe(guild.rankId("Knight"));
  });

  it("does not let officers change a fellow officer", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const commander = await createMember(db, guild, "Commander");
    await expect(
      assignRank(db, marshal, { membershipId: commander.membershipId, rankId: guild.rankId("Squire") }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(removeMember(db, marshal, commander.membershipId!)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses to demote the last admin", async () => {
    const guild = await createGuild(db);
    const gm = await createMember(db, guild, "Grand Master");
    await expect(assignRank(db, gm, { membershipId: gm.membershipId, rankId: guild.rankId("Knight") })).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(
      updateRank(db, gm, guild.rankId("Grand Master"), { name: "Grand Master", description: "", tier: "officer", inGame: "on" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("enforces the ten in-game rank limit", async () => {
    const guild = await createGuild(db);
    const gm = await createMember(db, guild, "Grand Master");
    await createRank(db, gm, { name: "Pilgrim", description: "", tier: "member", inGame: "on" });
    await expect(
      createRank(db, gm, { name: "Hermit", description: "", tier: "member", inGame: "on" }),
    ).rejects.toThrow(/como máximo 10/);
    await expect(createRank(db, gm, { name: "Hermit", description: "", tier: "member" })).resolves.toBeTruthy();
  });

  it("isolates guilds: an officer cannot see or act on another guild's data", async () => {
    const guildA = await createGuild(db);
    const guildB = await createGuild(db);
    const officerA = await createMember(db, guildA, "Marshal");
    const visitorB = await createVisitor(db, guildB.guild.id);
    const appB = await submitApplication(db, visitorB, validApplication);

    expect(await getApplication(db, officerA, appB.id)).toBeNull();
    await expect(reviewApplication(db, officerA, { applicationId: appB.id, decision: "accepted" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    const squireB = await createMember(db, guildB, "Squire");
    await expect(
      assignRank(db, officerA, { membershipId: squireB.membershipId, rankId: guildA.rankId("Knight") }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects rows that reference another guild at the database level", async () => {
    const guildA = await createGuild(db);
    const guildB = await createGuild(db);
    const memberA = await createMember(db, guildA, "Squire");
    await expect(
      db
        .update(memberships)
        .set({ rankId: guildB.rankId("Knight") })
        .where(eq(memberships.id, memberA.membershipId!)),
    ).rejects.toThrow();
  });

  it("keeps the audit log append-only", async () => {
    const guild = await createGuild(db);
    const chaplain = await createMember(db, guild, "Chaplain");
    await updateContentPage(db, chaplain, { slug: "charter", title: "Rules", bodyMd: "Be kind." });
    const causeMessage = (err: unknown) => String((err as { cause?: { message?: string } }).cause?.message);
    await expect(db.execute(sql`update audit_log set action = 'tampered'`)).rejects.toSatisfy((e) =>
      /append-only/.test(causeMessage(e)),
    );
    await expect(db.execute(sql`delete from audit_log`)).rejects.toSatisfy((e) => /append-only/.test(causeMessage(e)));
  });
});
