import { and, asc, count, eq, gte, ne } from "drizzle-orm";
import { version as packageVersion } from "../../../package.json";
import { guilds, memberships, ranks, supportTickets, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { type EmailMessage, type EmailOutcome, type EmailTransport, sendEmail } from "@/lib/email";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_RATE_LIMIT,
  SUPPORT_RATE_WINDOW_MS,
  type SupportCategory,
  type SupportTicketContext,
  supportTicketInput,
  ticketReference,
} from "@/lib/support";
import { DomainError } from "@/server/errors";

export type SupportTicket = typeof supportTickets.$inferSelect;

/** Where support email goes. Null when email isn't set up; tickets are still saved. */
export interface SupportMail {
  transport: EmailTransport;
  from: string;
  to: string[];
}

/** Resend's shared sender, which only delivers to the Resend account's own address; set SUPPORT_EMAIL_FROM in production. */
const FALLBACK_FROM = "Guildbook Support <onboarding@resend.dev>";

export function supportMailFromEnv(
  transport: EmailTransport | null,
  env: Record<string, string | undefined> = process.env,
): SupportMail | null {
  if (!transport) return null;
  const to = (env.SUPPORT_EMAIL_TO ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // The mock transport never delivers, so it doesn't need a real inbox configured.
  if (to.length === 0 && transport.name === "mock") to.push("support@guildbook.test");
  if (to.length === 0) return null;
  return { transport, from: env.SUPPORT_EMAIL_FROM?.trim() || FALLBACK_FROM, to };
}

/** The deployed version: package version plus the commit on Vercel. */
export function appVersion(env: Record<string, string | undefined> = process.env): string {
  const sha = env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7);
  return sha ? `${packageVersion}+${sha}` : packageVersion;
}

/** Guilds a user can attach to a ticket: those they belong to or have applied to. */
export async function listSupportGuilds(db: Db, userId: string) {
  return db
    .select({ id: guilds.id, slug: guilds.slug, name: guilds.name, status: memberships.status, rankName: ranks.name })
    .from(memberships)
    .innerJoin(guilds, eq(guilds.id, memberships.guildId))
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(and(eq(memberships.userId, userId), ne(memberships.status, "former")))
    .orderBy(asc(guilds.name));
}

/** What the support form shows and prefills for a user. */
export async function getSupportProfile(db: Db, userId: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email, discordUsername: users.discordUsername })
    .from(users)
    .where(eq(users.id, userId));
  return user ?? null;
}

/** A ticket, only if `userId` sent it. */
export async function getOwnSupportTicket(db: Db, userId: string, id: string): Promise<SupportTicket | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [ticket] = await db
    .select()
    .from(supportTickets)
    .where(and(eq(supportTickets.id, id), eq(supportTickets.userId, userId)));
  return ticket ?? null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const oneLine = (value: string) => value.replace(/[\r\n\t]+/g, " ").trim();

export interface SupportEmailDetails {
  ticket: SupportTicket;
  user: { id: string; name: string | null; discordId: string | null; discordUsername: string | null };
  guild: { id: string; name: string; slug: string } | null;
}

/** The operator's copy of a ticket: plain text plus simple HTML, with user content escaped. */
export function buildSupportEmail({ ticket, user, guild }: SupportEmailDetails, mail: { from: string; to: string[] }): EmailMessage {
  const reference = ticketReference(ticket.id);
  const category = SUPPORT_CATEGORIES[ticket.category as SupportCategory]?.label ?? ticket.category;
  const discord = [user.name, user.discordUsername && `@${user.discordUsername}`, user.discordId && `(${user.discordId})`].filter(Boolean).join(" ");
  const ctx = ticket.context;
  const rows: [string, string][] = [
    ["Ticket", `${reference} (${ticket.id})`],
    ["Category", category],
    ["From", discord || "Unknown"],
    ["User ID", user.id],
    ["Reply to", ticket.replyTo ?? "No email given; reply on Discord"],
    ["Guild", guild ? `${guild.name} (${guild.slug}, ${guild.id})` : "None"],
    ["Page", ctx.page ?? "Unknown"],
    ["Host", ctx.host ?? "Unknown"],
    ["Browser", ctx.userAgent ?? "Unknown"],
    ["App version", ctx.appVersion ?? "Unknown"],
    ["Sent", ticket.createdAt.toISOString()],
  ];

  const text = [
    `New Guildbook support request ${reference}`,
    "",
    `Subject: ${ticket.subject}`,
    "",
    ticket.message,
    "",
    "----",
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");

  const cell = "padding:4px 12px 4px 0;vertical-align:top;";
  const html = `<!doctype html>
<html><body style="font-family:system-ui,sans-serif;font-size:14px;color:#1a1a1a;">
<h2 style="margin:0 0 8px;">${escapeHtml(ticket.subject)}</h2>
<p style="margin:0 0 16px;color:#555;">Guildbook support request ${escapeHtml(reference)}</p>
<div style="white-space:pre-wrap;border-left:3px solid #c9a227;padding:8px 12px;margin:0 0 16px;background:#faf7ee;">${escapeHtml(ticket.message)}</div>
<table style="border-collapse:collapse;font-size:13px;">
${rows.map(([k, v]) => `<tr><th align="left" style="${cell}color:#555;">${escapeHtml(k)}</th><td style="${cell}">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>
</body></html>`;

  return {
    from: mail.from,
    to: mail.to,
    subject: oneLine(`[Guildbook support] ${reference} ${category}: ${ticket.subject}`),
    text,
    html,
    replyTo: ticket.replyTo,
  };
}

export interface SubmitSupportOptions {
  context?: SupportTicketContext;
  mail?: SupportMail | null;
  now?: Date;
}

/**
 * Validates and saves a ticket, then emails it to the operator. The ticket is kept whether or not the email goes
 * out; the outcome is logged and returned. Each user may send SUPPORT_RATE_LIMIT tickets per rolling hour.
 */
export async function submitSupportTicket(
  db: Db,
  userId: string,
  raw: Record<string, unknown>,
  { context = {}, mail = null, now = new Date() }: SubmitSupportOptions = {},
): Promise<{ ticket: SupportTicket; email: EmailOutcome }> {
  const input = supportTicketInput.parse(raw);

  const [user] = await db
    .select({ id: users.id, name: users.name, discordId: users.discordId, discordUsername: users.discordUsername })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new DomainError("Vuelve a iniciar sesión para enviar una solicitud de soporte.");

  let guild: SupportEmailDetails["guild"] = null;
  if (input.guildId) {
    const found = (await listSupportGuilds(db, userId)).find((g) => g.id === input.guildId);
    if (!found) throw new DomainError("Elige una de tus hermandades", { field: "guildId" });
    guild = { id: found.id, name: found.name, slug: found.slug };
  }

  const [{ recent } = { recent: 0 }] = await db
    .select({ recent: count() })
    .from(supportTickets)
    .where(and(eq(supportTickets.userId, userId), gte(supportTickets.createdAt, new Date(now.getTime() - SUPPORT_RATE_WINDOW_MS))));
  if (recent >= SUPPORT_RATE_LIMIT) {
    throw new DomainError(`Has enviado ${SUPPORT_RATE_LIMIT} solicitudes de soporte en la última hora. Espera un rato antes de enviar otra.`);
  }

  const [ticket] = await db
    .insert(supportTickets)
    .values({
      userId,
      guildId: guild?.id ?? null,
      category: input.category,
      subject: input.subject,
      message: input.message,
      replyTo: input.replyTo,
      context: {
        ...context,
        discordId: user.discordId,
        discordUsername: user.discordUsername,
        displayName: user.name,
      },
      createdAt: now,
    })
    .returning();

  const reference = ticketReference(ticket!.id);
  const email: EmailOutcome = mail
    ? await sendEmail(mail.transport, buildSupportEmail({ ticket: ticket!, user, guild }, mail))
    : { status: "skipped", reason: "Support email is not configured" };
  if (email.status === "sent") console.info(`[support] ${reference} emailed via ${email.transport}`);
  else if (email.status === "skipped") console.info(`[support] ${reference} saved; email skipped: ${email.reason}`);
  else console.error(`[support] ${reference} saved; email failed via ${email.transport}: ${email.error}`);

  return { ticket: ticket!, email };
}
