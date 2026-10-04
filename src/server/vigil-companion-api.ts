import { z } from "zod";
import type { Db } from "@/db/types";
import { AuthorizationError } from "@/lib/authz/policy";
import { guildHref } from "@/lib/paths";
import { MAX_REPORT_BYTES } from "@/lib/vigil/report";
import { DomainError, NotFoundError } from "@/server/errors";
import { guildOrigin, hostFromRequest } from "@/server/hosts";
import { clientIp, createRateLimiter } from "@/server/rate-limit";
import { primaryCustomDomain } from "@/server/services/domains";
import {
  authenticateDevice,
  companionProfile,
  exchangePairingCode,
  takeUploadQuota,
  uploadCompanionReport,
} from "@/server/services/vigil-companion";
import { VersionMismatchError } from "@/server/services/vigil";

/**
 * HTTP handlers behind /api/vigil/companion/*. They take the database as an argument so the integration
 * tests can drive them with real Requests against PGlite.
 */

const pairLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function errorResponse(err: unknown): Response {
  if (err instanceof z.ZodError) return json({ error: "La petición no tiene el formato esperado." }, 400);
  if (err instanceof AuthorizationError) return json({ error: err.message }, err.code === "unauthenticated" ? 401 : 403);
  if (err instanceof NotFoundError) return json({ error: err.message }, 404);
  if (err instanceof VersionMismatchError) return json({ error: err.message, code: err.code }, 409);
  if (err instanceof DomainError) return json({ error: err.message }, 400);
  throw err;
}

const bearer = (request: Request) => {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
};

async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new PayloadTooLarge();
  const text = await request.text();
  if (text.length > maxBytes) throw new PayloadTooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("El cuerpo de la petición no es un JSON válido.");
  }
}

class PayloadTooLarge extends Error {}

/**
 * The guild's canonical site as seen from this request: its verified custom domain, else its subdomain (local
 * hosts stay local). The companion calls the apex for everything and uses this for links, so it can trust a
 * custom domain it could not verify itself.
 */
async function companionSiteUrl(db: Db, guild: { id: string; slug: string }, request: Request): Promise<string> {
  const [current, customDomain] = await Promise.all([hostFromRequest(request), primaryCustomDomain(db, guild.id)]);
  return guildOrigin(guild.slug, current, customDomain);
}

export async function handlePair(db: Db, request: Request): Promise<Response> {
  const limit = pairLimiter(clientIp(request));
  if (!limit.ok) return json({ error: "Demasiados intentos de emparejamiento. Espera un minuto." }, 429, { "Retry-After": String(limit.retryAfterS) });
  try {
    const { guildId, ...result } = await exchangePairingCode(db, await readJson(request, 4096));
    return json({ ...result, siteUrl: await companionSiteUrl(db, { id: guildId, slug: result.guild.slug }, request) }, 201);
  } catch (err) {
    if (err instanceof PayloadTooLarge) return json({ error: "Petición demasiado grande." }, 413);
    return errorResponse(err);
  }
}

export async function handleProfile(db: Db, request: Request): Promise<Response> {
  try {
    const auth = await authenticateDevice(db, bearer(request));
    return json({ ...(await companionProfile(db, auth)), siteUrl: await companionSiteUrl(db, auth.guild, request) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleUpload(db: Db, request: Request): Promise<Response> {
  try {
    const auth = await authenticateDevice(db, bearer(request));
    const body = await readJson(request, MAX_REPORT_BYTES + 4096);
    const quota = await takeUploadQuota(db, auth.device.id);
    if (!quota.ok) {
      return json({ error: "Subidas demasiado rápidas. La app lo volverá a intentar." }, 429, { "Retry-After": String(quota.retryAfterS) });
    }
    const { id, gameVersion, versionMismatch, warning } = await uploadCompanionReport(db, auth, body);
    const url = new URL(guildHref(auth.guild.slug, `/vigil/reports/${id}`), await companionSiteUrl(db, auth.guild, request)).toString();
    return json({ id, url, gameVersion, versionMismatch, warning }, 201);
  } catch (err) {
    if (err instanceof PayloadTooLarge) return json({ error: "El informe de este combate es demasiado grande para subirlo." }, 413);
    return errorResponse(err);
  }
}
