import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/types";
import { guilds } from "@/db/schema";
import { AuthorizationError } from "@/lib/authz/policy";
import { discordId } from "@/lib/validation";
import { DomainError, NotFoundError } from "@/server/errors";
import { createRateLimiter } from "@/server/rate-limit";
import { listBotMembers } from "@/server/services/bot-members";
import {
  actorForDiscord,
  createGroup,
  type GroupView,
  getGroup,
  listActiveGroups,
  removeSignup,
  setBench,
  signUp,
  updateGroup,
} from "@/server/services/groups";

/**
 * HTTP handlers behind /api/bot/*, for the guild's Discord bot. The bot authenticates with `Bearer $BOT_API_TOKEN`
 * and names the guild and the Discord user it acts for; the services check what that user may do. Without the
 * variable the API does not exist (404). The bot never gets database access: what it reads comes from here.
 */

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const MAX_BODY_BYTES = 16 * 1024;
/** A bot answering button presses stays far below this; more is a loop or a leaked key being used. */
const botLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

export function botAuthorized(request: Request): boolean {
  const secret = process.env.BOT_API_TOKEN;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function errorResponse(err: unknown): Response {
  if (err instanceof z.ZodError) return json({ error: "La petición no tiene el formato esperado.", issues: err.issues.map((i) => i.message) }, 400);
  if (err instanceof AuthorizationError) return json({ error: err.message, code: err.code }, err.code === "unauthenticated" ? 401 : 403);
  if (err instanceof NotFoundError) return json({ error: "No encuentro ese grupo." }, 404);
  if (err instanceof DomainError) return json({ error: err.message }, 400);
  throw err;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new DomainError("Petición demasiado grande.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new DomainError("Petición demasiado grande.");
  try {
    const body = text ? JSON.parse(text) : {};
    return typeof body === "object" && body !== null ? body : {};
  } catch {
    throw new DomainError("El cuerpo de la petición no es un JSON válido.");
  }
}

const envelope = z.object({ guild: z.string().min(1).max(64), actorDiscordId: discordId.nullish() });

async function findGuild(db: Db, slug: string) {
  const [row] = await db.select({ id: guilds.id, slug: guilds.slug, name: guilds.name, timezone: guilds.timezone }).from(guilds).where(eq(guilds.slug, slug));
  if (!row) throw new DomainError(`La web no tiene la hermandad «${slug}».`);
  return row;
}

type Guild = Awaited<ReturnType<typeof findGuild>>;
type Handler = (ctx: { db: Db; guild: Guild; guildId: string; actorDiscordId: string | null; body: Record<string, unknown> }) => Promise<unknown>;

/** Checks the bot's key, reads the body (or the query string for GET), and runs one operation. */
async function handle(db: Db, request: Request, fn: Handler, status = 200): Promise<Response> {
  if (!botAuthorized(request)) return json({ error: "Not found" }, 404);
  const limit = botLimiter("bot");
  if (!limit.ok) return json({ error: "Demasiadas peticiones seguidas." }, 429, { "Retry-After": String(limit.retryAfterS) });
  try {
    const url = new URL(request.url);
    const body = request.method === "GET" ? Object.fromEntries(url.searchParams) : await readJson(request);
    const { guild: slug, actorDiscordId } = envelope.parse(body);
    const guild = await findGuild(db, slug);
    return json(await fn({ db, guild, guildId: guild.id, actorDiscordId: actorDiscordId ?? null, body }), status);
  } catch (err) {
    return errorResponse(err);
  }
}

async function requireActor(db: Db, guildId: string, actorDiscordId: string | null) {
  if (!actorDiscordId) throw new DomainError("Falta el usuario de Discord que hace esto.");
  return actorForDiscord(db, guildId, actorDiscordId);
}

const view = (group: GroupView) => ({ group });

/** Active members who signed in with Discord, their rank tier and characters: what the bot needs for Discord roles. */
export const handleListMembers = (db: Db, request: Request) =>
  handle(db, request, async ({ db, guild }) => ({
    guild: { slug: guild.slug, name: guild.name, timezone: guild.timezone },
    members: await listBotMembers(db, guild.id),
  }));

export const handleListGroups = (db: Db, request: Request) =>
  handle(db, request, async ({ db, guildId }) => ({ groups: await listActiveGroups(db, guildId) }));

export const handleCreateGroup = (db: Db, request: Request) =>
  handle(db, request, async ({ db, guildId, actorDiscordId, body }) => view(await createGroup(db, await requireActor(db, guildId, actorDiscordId), body)), 201);

export const handleGetGroup = (db: Db, request: Request, id: string) =>
  handle(db, request, async ({ db, guildId }) => view(await getGroup(db, guildId, id)));

export const handleUpdateGroup = (db: Db, request: Request, id: string) =>
  handle(db, request, async ({ db, guildId, actorDiscordId, body }) =>
    view(await updateGroup(db, guildId, actorDiscordId ? await actorForDiscord(db, guildId, actorDiscordId) : null, id, body)),
  );

export const handleSignUp = (db: Db, request: Request, id: string) =>
  handle(db, request, async ({ db, guildId, actorDiscordId, body }) => view(await signUp(db, await requireActor(db, guildId, actorDiscordId), id, body)));

export const handleBench = (db: Db, request: Request, id: string) =>
  handle(db, request, async ({ db, guildId, actorDiscordId, body }) => view(await setBench(db, await requireActor(db, guildId, actorDiscordId), id, body)));

export const handleRemoveSignup = (db: Db, request: Request, id: string) =>
  handle(db, request, async ({ db, guildId, actorDiscordId, body }) => view(await removeSignup(db, await requireActor(db, guildId, actorDiscordId), id, body)));
