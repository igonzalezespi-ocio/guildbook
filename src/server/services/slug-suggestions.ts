import { eq, inArray } from "drizzle-orm";
import { guilds } from "@/db/schema";
import type { Db } from "@/db/types";
import { slugProblem } from "@/lib/hosts";
import { distinguishingSlugs, numberedSlugs, type SlugIdentity } from "@/lib/slug-suggestions";
import { DomainError } from "@/server/errors";

async function takenSlugs(db: Db, slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const rows = await db.select({ slug: guilds.slug }).from(guilds).where(inArray(guilds.slug, slugs));
  return new Set(rows.map((r) => r.slug));
}

async function firstFreeNumbered(db: Db, base: string): Promise<string | null> {
  const all = [...numberedSlugs(base)];
  for (let i = 0; i < all.length; i += 50) {
    const batch = all.slice(i, i + 50);
    const taken = await takenSlugs(db, batch);
    const free = batch.find((s) => !taken.has(s));
    if (free) return free;
  }
  return null;
}

/**
 * Free subdomains for `subject` when `base` is taken: ones naming what sets it apart from the guild on `base`
 * (`oathbound-pvp`, `oathbound-horde`, `oathbound-eu`), or the first free `base-2` style slug if those are all taken.
 * Empty when `base` is free or can't be a subdomain.
 */
export async function suggestSlugs(db: Db, base: string, subject: SlugIdentity): Promise<string[]> {
  const slug = base.trim().toLowerCase();
  if (slugProblem(slug) === "characters" || slugProblem(slug) === "length") return [];
  const [holder] = await db
    .select({ gameVersion: guilds.gameVersion, realmSlug: guilds.realmSlug, region: guilds.region, faction: guilds.faction, ruleset: guilds.ruleset })
    .from(guilds)
    .where(eq(guilds.slug, slug));
  if (!holder && !slugProblem(slug)) return [];
  const candidates = distinguishingSlugs(slug, subject, holder ?? null);
  const taken = await takenSlugs(db, candidates);
  const free = candidates.filter((s) => !taken.has(s));
  if (free.length > 0) return free;
  const numbered = await firstFreeNumbered(db, slug);
  return numbered ? [numbered] : [];
}

/**
 * Where an unverified guild on `base` moves when a verified guild claims it: the first free subdomain naming what
 * sets the moved guild apart from the claimer, else the first free numbered one.
 */
export async function relocationSlug(db: Db, base: string, moved: SlugIdentity, claimer: SlugIdentity): Promise<string> {
  const candidates = distinguishingSlugs(base, moved, claimer);
  const taken = await takenSlugs(db, candidates);
  const free = candidates.find((s) => !taken.has(s)) ?? (await firstFreeNumbered(db, base));
  if (!free) throw new DomainError("No se ha encontrado un subdominio libre para la hermandad sin verificar. Contacta con el equipo de Guildbook.");
  return free;
}
