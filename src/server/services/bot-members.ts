import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/types";
import { characterProfessions, characters, memberships, ranks, users } from "@/db/schema";
import type { RankTier } from "@/lib/authz/tiers";
import { fullName, type Profession, type WowClass } from "@/lib/game";

/**
 * What the guild's Discord bot needs to hand out Discord roles: each active member who has signed in with Discord,
 * their rank tier and their characters. Only these fields leave the site; never e-mails, names or Battle.net data.
 */
export interface BotMember {
  discordId: string;
  tier: RankTier;
  characters: {
    id: string;
    name: string;
    surname: string;
    fullName: string;
    class: WowClass;
    spec: string;
    role: (typeof characters.$inferSelect)["role"];
    level: number;
    isMain: boolean;
    verified: boolean;
    professions: { profession: Profession; skill: number | null }[];
  }[];
}

export async function listBotMembers(db: Db, guildId: string): Promise<BotMember[]> {
  const members = await db
    .select({ membershipId: memberships.id, discordId: users.discordId, tier: ranks.tier })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(ranks, eq(ranks.id, memberships.rankId))
    .where(and(eq(memberships.guildId, guildId), eq(memberships.status, "active"), isNotNull(users.discordId)))
    .orderBy(asc(users.discordId));
  if (members.length === 0) return [];

  const chars = await db
    .select({
      id: characters.id,
      membershipId: characters.membershipId,
      name: characters.name,
      surname: characters.surname,
      wowClass: characters.wowClass,
      spec: characters.spec,
      role: characters.role,
      level: characters.level,
      isMain: characters.isMain,
      verified: characters.verified,
    })
    .from(characters)
    .where(
      and(
        eq(characters.guildId, guildId),
        inArray(
          characters.membershipId,
          members.map((m) => m.membershipId),
        ),
        isNull(characters.archivedAt),
      ),
    )
    .orderBy(asc(characters.name));
  const profs = chars.length
    ? await db
        .select({ characterId: characterProfessions.characterId, profession: characterProfessions.profession, skill: characterProfessions.skill })
        .from(characterProfessions)
        .where(and(eq(characterProfessions.guildId, guildId), inArray(characterProfessions.characterId, chars.map((c) => c.id))))
    : [];

  return members.map((m) => ({
    discordId: m.discordId!,
    tier: m.tier,
    characters: chars
      .filter((c) => c.membershipId === m.membershipId)
      .map(({ membershipId: _membershipId, wowClass, ...c }) => ({
        ...c,
        class: wowClass,
        fullName: fullName(c.name, c.surname),
        professions: profs.filter((p) => p.characterId === c.id).map(({ characterId: _characterId, ...p }) => p),
      })),
  }));
}
