"use server";

import { redirect } from "next/navigation";
import { db } from "@/db";
import { setupUrl } from "@/lib/guild-setup";
import { type ActionResult, actionError } from "@/server/action";
import { getSessionUser } from "@/server/context";
import { sessionReachUrl } from "@/server/handoff";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { createRateLimiter } from "@/server/rate-limit";
import { FACTIONS, REGIONS, RULESETS } from "@/lib/game";
import { findRealm, SUPPORTED_GUILD_VERSIONS } from "@/lib/game-versions";
import { getBlizzardClient } from "@/server/blizzard";
import { recordFounderStanding } from "@/server/services/guild-verification";
import { checkSlugAvailability, createGuildForUser, type SlugAvailability } from "@/server/services/platform";

const createLimiter = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 });
const slugCheckLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

const oneOf = <T extends string>(values: readonly T[], v: unknown): T | null =>
  (values as readonly unknown[]).includes(v) ? (v as T) : null;

/** Live availability for the create form; `identity` is what's chosen so far, for meaningful suggestions. */
export async function checkSlugAction(
  slug: string,
  identity: { gameVersion?: string; realmSlug?: string; region?: string; faction?: string; ruleset?: string } = {},
): Promise<SlugAvailability> {
  const user = await getSessionUser();
  if (!user) return { available: false, reason: "Inicia sesión para comprobar la disponibilidad" };
  if (!slugCheckLimiter(user.id).ok) return { available: false, reason: "Demasiadas comprobaciones. Espera un momento." };
  const gameVersion = oneOf(SUPPORTED_GUILD_VERSIONS, identity?.gameVersion);
  const realm = gameVersion ? findRealm(gameVersion, String(identity?.realmSlug ?? "")) : null;
  return checkSlugAvailability(db, String(slug ?? "").slice(0, 64), {
    gameVersion,
    realmSlug: realm?.slug ?? null,
    region: oneOf(REGIONS, identity?.region),
    faction: oneOf(FACTIONS, identity?.faction),
    ruleset: realm?.ruleset ?? oneOf(RULESETS, identity?.ruleset),
  });
}

export async function createGuildAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Inicia sesión con Discord para crear una hermandad." };
  const limited = createLimiter(user.id);
  if (!limited.ok) return { ok: false, error: `Demasiados intentos. Vuelve a intentarlo en ${limited.retryAfterS} segundos.` };

  let slug: string;
  try {
    const created = await createGuildForUser(db, user.id, Object.fromEntries(fd.entries()));
    slug = created.guild.slug;
    await recordFounderStanding(db, created.guild.id, user.id, getBlizzardClient()).catch((err) => {
      console.warn(`[guild.create] founder standing check failed: ${err instanceof Error ? err.message : "unknown error"}`);
    });
  } catch (err) {
    return actionError(err);
  }
  const current = await getRequestHost();
  redirect(await sessionReachUrl(db, user, setupUrl(guildOrigin(slug, current)), current));
}
