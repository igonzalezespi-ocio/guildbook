import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memberships, supportTickets, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { type EmailMessage, emailTransportFromEnv, mockTransport } from "@/lib/email";
import { SUPPORT_RATE_LIMIT, SUPPORT_RATE_WINDOW_MS, supportTicketInput, ticketReference } from "@/lib/support";
import { actionError } from "@/server/action-error";
import { deleteGuild, deleteUserAccount, exportUserData } from "@/server/services/account";
import {
  buildSupportEmail,
  getOwnSupportTicket,
  listSupportGuilds,
  submitSupportTicket,
  supportMailFromEnv,
} from "@/server/services/support";
import { createGuild, createMember, createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
let n = 0;

async function newUser(extra: Partial<typeof users.$inferInsert> = {}) {
  const [user] = await db
    .insert(users)
    .values({ name: `Seeker ${++n}`, discordId: `support-${n}`, discordUsername: `seeker${n}`, ...extra })
    .returning();
  return user!;
}

const valid = {
  category: "bug",
  subject: "Roster page is empty",
  message: "The roster shows no members since this morning, even though we have twelve.",
  replyTo: "seeker@example.com",
};

async function fieldErrorsFor(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    const result = actionError(err);
    return result.ok ? {} : (result.fieldErrors ?? {});
  }
  throw new Error("expected a failure");
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await close();
});

describe("supportTicketInput", () => {
  it("accepts a valid ticket and blanks optional fields to null", () => {
    expect(supportTicketInput.parse({ ...valid, replyTo: "  ", guildId: "" })).toMatchObject({ replyTo: null, guildId: null, category: "bug" });
  });

  it("names each invalid field", () => {
    const result = supportTicketInput.safeParse({ category: "refund", subject: " ", message: "short", replyTo: "nope", guildId: "x" });
    expect(result.success).toBe(false);
    const fields = Object.keys(result.error!.flatten().fieldErrors).sort();
    expect(fields).toEqual(["category", "guildId", "message", "replyTo", "subject"]);
  });

  it("caps subject and message length", () => {
    expect(supportTicketInput.safeParse({ ...valid, subject: "x".repeat(121) }).success).toBe(false);
    expect(supportTicketInput.safeParse({ ...valid, message: "x".repeat(5001) }).success).toBe(false);
    expect(supportTicketInput.safeParse({ ...valid, message: "x".repeat(5000) }).success).toBe(true);
  });
});

describe("submitSupportTicket", () => {
  it("saves the ticket with context and emails the operator", async () => {
    const user = await newUser();
    const guild = await createGuild(db, { name: "Silver Dawn" });
    const member = await createMember(db, guild, "Knight");
    await db.update(users).set({ discordUsername: "knightly" }).where(eq(users.id, member.userId));
    const outbox: EmailMessage[] = [];
    const mail = { transport: mockTransport(outbox), from: "Guildbook <support@guildbook.test>", to: ["ops@example.test"] };

    const { ticket, email } = await submitSupportTicket(
      db,
      member.userId,
      { ...valid, guildId: guild.guild.id, page: "ignored by the schema" },
      { mail, context: { page: "http://osm.localhost:3000/roster", userAgent: "Vitest", appVersion: "0.1.0", host: "localhost:3000" } },
    );

    const [row] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id));
    expect(row).toMatchObject({
      userId: member.userId,
      guildId: guild.guild.id,
      category: "bug",
      subject: valid.subject,
      replyTo: "seeker@example.com",
      status: "open",
      context: { page: "http://osm.localhost:3000/roster", userAgent: "Vitest", appVersion: "0.1.0", discordUsername: "knightly" },
    });
    expect(email).toMatchObject({ status: "sent", transport: "mock" });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: ["ops@example.test"], replyTo: "seeker@example.com" });
    expect(outbox[0]!.subject).toBe(`[Guildbook support] ${ticketReference(ticket.id)} Informar de un error: ${valid.subject}`);
    expect(outbox[0]!.text).toContain("Silver Dawn");
    expect(outbox[0]!.text).toContain(member.userId);
    expect(await getOwnSupportTicket(db, member.userId, ticket.id)).not.toBeNull();
    expect(await getOwnSupportTicket(db, user.id, ticket.id)).toBeNull();
  });

  it("still saves the ticket when email is not configured or fails", async () => {
    const user = await newUser();
    const skipped = await submitSupportTicket(db, user.id, { ...valid, replyTo: "" });
    expect(skipped.email.status).toBe("skipped");
    expect(skipped.ticket.replyTo).toBeNull();

    const failing = { name: "broken", send: async () => Promise.reject(new Error("provider down")) };
    const failed = await submitSupportTicket(db, user.id, valid, { mail: { transport: failing, from: "a@b.test", to: ["c@d.test"] } });
    expect(failed.email).toEqual({ status: "failed", transport: "broken", error: "provider down" });
    expect(await db.select().from(supportTickets).where(eq(supportTickets.userId, user.id))).toHaveLength(2);
  });

  it("rejects a guild the user doesn't belong to, as a field error", async () => {
    const user = await newUser();
    const guild = await createGuild(db);
    expect(await fieldErrorsFor(() => submitSupportTicket(db, user.id, { ...valid, guildId: guild.guild.id }))).toEqual({
      guildId: ["Elige una de tus hermandades"],
    });
  });

  it("returns field-named validation errors", async () => {
    const user = await newUser();
    const errors = await fieldErrorsFor(() => submitSupportTicket(db, user.id, { subject: "", message: "hi" }));
    expect(Object.keys(errors).sort()).toEqual(["category", "message", "subject"]);
  });

  it(`allows ${SUPPORT_RATE_LIMIT} tickets per user per hour`, async () => {
    const user = await newUser();
    const other = await newUser();
    const start = new Date("2026-09-28T10:00:00Z");
    for (let i = 0; i < SUPPORT_RATE_LIMIT; i++) {
      await submitSupportTicket(db, user.id, valid, { now: new Date(start.getTime() + i * 60_000) });
    }
    const later = new Date(start.getTime() + 10 * 60_000);
    await expect(submitSupportTicket(db, user.id, valid, { now: later })).rejects.toThrow(/última hora/);
    await expect(submitSupportTicket(db, other.id, valid, { now: later })).resolves.toBeDefined();
    const nextHour = new Date(start.getTime() + SUPPORT_RATE_WINDOW_MS + 60_000);
    await expect(submitSupportTicket(db, user.id, valid, { now: nextHour })).resolves.toBeDefined();
  });

  it("lists the user's guilds, applicants included, formers excluded", async () => {
    const a = await createGuild(db, { name: "Alpha Wing" });
    const member = await createMember(db, a, "Knight");
    const b = await createGuild(db, { name: "Beta Watch" });
    const rank = b.ranks.find((r) => r.name === "Postulant")!;
    await db.insert(memberships).values({ guildId: b.guild.id, userId: member.userId, rankId: rank.id, status: "former" });
    expect((await listSupportGuilds(db, member.userId)).map((g) => g.name)).toEqual(["Alpha Wing"]);
  });

  it("is exported with the account, drops its guild with the guild, and is deleted with the account", async () => {
    const guild = await createGuild(db, { name: "Gamma Keep" });
    const gm = await createMember(db, guild, "Grand Master");
    const { ticket } = await submitSupportTicket(db, gm.userId, { ...valid, guildId: guild.guild.id });
    expect((await exportUserData(db, gm.userId)).supportRequests.map((t) => t.id)).toEqual([ticket.id]);

    await deleteGuild(db, gm, guild.guild.name);
    expect((await getOwnSupportTicket(db, gm.userId, ticket.id))?.guildId).toBeNull();

    const [user] = await db.select().from(users).where(eq(users.id, gm.userId));
    await deleteUserAccount(db, gm.userId, user!.name!);
    expect(await db.select().from(supportTickets).where(eq(supportTickets.id, ticket.id))).toHaveLength(0);
  });
});

describe("support email", () => {
  it("escapes user content in the HTML and keeps the subject on one line", () => {
    const ticket = {
      id: "0a1b2c3d-0000-4000-8000-000000000000",
      userId: "u1",
      guildId: null,
      category: "other",
      subject: "Hello\r\nBcc: victim@example.com",
      message: `<script>alert("x")</script> & more`,
      replyTo: null,
      context: { page: "https://guildbook.io/?q=<b>", userAgent: "UA", appVersion: "0.1.0" },
      status: "open",
      createdAt: new Date("2026-09-28T12:00:00Z"),
    };
    const email = buildSupportEmail(
      { ticket, user: { id: "u1", name: "Joan", discordId: "123", discordUsername: "joan" }, guild: null },
      { from: "f@x.test", to: ["t@x.test"] },
    );
    expect(email.subject).toBe("[Guildbook support] GB-0A1B2C3D Otro: Hello Bcc: victim@example.com");
    expect(email.subject).not.toMatch(/[\r\n]/);
    expect(email.html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("?q=&lt;b&gt;");
    expect(email.text).toContain(`<script>alert("x")</script> & more`);
    expect(email.text).toContain("Reply to: No email given; reply on Discord");
    expect(email.text).toContain("Joan @joan (123)");
    expect(email.replyTo).toBeNull();
  });

  it("chooses the transport and recipients from the environment", () => {
    expect(emailTransportFromEnv({})).toBeNull();
    expect(emailTransportFromEnv({ AUTH_TEST_MODE: "1", RESEND_API_KEY: "re_test" })?.name).toBe("mock");
    expect(emailTransportFromEnv({ EMAIL_MOCK: "1" })?.name).toBe("mock");
    expect(emailTransportFromEnv({ RESEND_API_KEY: "re_test" })?.name).toBe("resend");

    const resend = emailTransportFromEnv({ RESEND_API_KEY: "re_test" });
    expect(supportMailFromEnv(resend, {})).toBeNull();
    expect(supportMailFromEnv(resend, { SUPPORT_EMAIL_TO: "a@x.test, b@x.test", SUPPORT_EMAIL_FROM: "S <s@x.test>" })).toMatchObject({
      from: "S <s@x.test>",
      to: ["a@x.test", "b@x.test"],
    });
    expect(supportMailFromEnv(mockTransport([]), {})?.to).toEqual(["support@guildbook.test"]);
    expect(supportMailFromEnv(null, { SUPPORT_EMAIL_TO: "a@x.test" })).toBeNull();
  });
});
