import { eq } from "drizzle-orm";
import type { Db } from "@/db/types";
import { guilds } from "@/db/schema";
import { type Faction, FACTION_LABELS } from "@/lib/game";
import { DomainError, NotFoundError } from "@/server/errors";

export async function getGuildFaction(tx: Db, guildId: string): Promise<Faction> {
  const [guild] = await tx.select({ faction: guilds.faction }).from(guilds).where(eq(guilds.id, guildId));
  if (!guild) throw new NotFoundError("Guild");
  return guild.faction;
}

/** Every guild has one faction: characters, applications and kills always take it, and another faction is refused. */
export async function resolveFaction(tx: Db, guildId: string, requested: Faction | null | undefined): Promise<Faction> {
  const locked = await getGuildFaction(tx, guildId);
  if (requested && requested !== locked) throw new DomainError(`Esta hermandad es solo de la ${FACTION_LABELS[locked]}.`);
  return locked;
}

/** For rows where faction is optional (schedule, recruitment): they store the guild's faction too. */
export async function resolveOptionalFaction(
  tx: Db,
  guildId: string,
  requested: Faction | null | undefined,
): Promise<Faction> {
  return resolveFaction(tx, guildId, requested);
}
