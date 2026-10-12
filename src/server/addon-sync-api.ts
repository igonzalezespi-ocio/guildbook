import { z } from "zod";
import type { Db } from "@/db/types";
import { AuthorizationError } from "@/lib/authz/policy";
import { DomainError } from "@/server/errors";
import { createRateLimiter } from "@/server/rate-limit";
import { authenticateSyncToken, ingestProfessions } from "@/server/services/addon-sync";

/**
 * HTTP handlers behind /api/addon/*, used by the addon sync app. They take the database as an argument so the
 * integration tests can drive them with real Requests against PGlite.
 */

/** A guild of a few hundred characters is a few tens of kilobytes; this leaves plenty of room. */
export const MAX_UPLOAD_BYTES = 512 * 1024;
/** The app sends when the game saves (logout, /reload); more than this per minute is a loop. */
const uploadLimiter = createRateLimiter({ limit: 12, windowMs: 60_000 });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

class PayloadTooLarge extends Error {}

function errorResponse(err: unknown): Response {
  if (err instanceof PayloadTooLarge) return json({ error: "Los datos son demasiado grandes." }, 413);
  if (err instanceof z.ZodError) return json({ error: "Los datos no tienen el formato esperado." }, 400);
  if (err instanceof AuthorizationError) return json({ error: err.message }, err.code === "unauthenticated" ? 401 : 403);
  if (err instanceof DomainError) return json({ error: err.message }, 400);
  throw err;
}

const bearer = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get("content-length") ?? 0) > maxBytes) throw new PayloadTooLarge();
  const text = await request.text();
  if (text.length > maxBytes) throw new PayloadTooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("Los datos no son un JSON válido.");
  }
}

/** Lets the app check its key when it is set up: which guild and whose key. */
export async function handleMe(db: Db, request: Request): Promise<Response> {
  try {
    const auth = await authenticateSyncToken(db, bearer(request));
    return json({ guild: { slug: auth.guild.slug, name: auth.guild.name }, key: { name: auth.token.name } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleProfessions(db: Db, request: Request): Promise<Response> {
  try {
    const auth = await authenticateSyncToken(db, bearer(request));
    const limit = uploadLimiter(auth.token.id);
    if (!limit.ok) {
      return json({ error: "Demasiados envíos seguidos. El sincronizador lo volverá a intentar." }, 429, { "Retry-After": String(limit.retryAfterS) });
    }
    const result = await ingestProfessions(db, auth, await readJson(request, MAX_UPLOAD_BYTES));
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
