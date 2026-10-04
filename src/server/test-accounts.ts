import "server-only";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { applications, characters, memberships, ranks, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { APPLICATION_STATUS_LABELS, fullName } from "@/lib/game";

export type TestAccount = {
  discordId: string;
  /** Sent as the test-login name, so signing in leaves the stored user name unchanged. */
  name: string;
  displayName: string;
  standing: string;
  group: "member" | "applicant" | "other";
};

const GROUP_ORDER = { member: 0, applicant: 1, other: 2 } as const;

/** Seeded (`seed-*`) accounts for the test-mode login, described by their standing in this guild. */
export async function listTestAccounts(db: Db, guildId: string): Promise<TestAccount[]> {
  const rows = await db
    .select({
      discordId: users.discordId,
      userName: users.name,
      status: memberships.status,
      rankName: ranks.name,
      rankOrder: ranks.sortOrder,
      charName: characters.name,
      charSurname: characters.surname,
    })
    .from(users)
    .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.guildId, guildId)))
    .leftJoin(ranks, eq(ranks.id, memberships.rankId))
    .leftJoin(
      characters,
      and(
        eq(characters.membershipId, memberships.id),
        eq(characters.guildId, guildId),
        eq(characters.isMain, true),
        isNull(characters.archivedAt),
      ),
    )
    .where(like(users.discordId, "seed-%"));

  const apps = await db
    .select({
      discordId: users.discordId,
      name: applications.characterName,
      surname: applications.characterSurname,
      status: applications.status,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.userId))
    .where(and(eq(applications.guildId, guildId), like(users.discordId, "seed-%")))
    .orderBy(desc(applications.createdAt));
  const latestApp = new Map<string, (typeof apps)[number]>();
  for (const a of apps) if (!latestApp.has(a.discordId!)) latestApp.set(a.discordId!, a);

  const accounts = rows.map((r) => {
    const discordId = r.discordId!;
    const app = latestApp.get(discordId);
    const name = r.userName || discordId;
    const displayName = r.charName ? fullName(r.charName, r.charSurname!) : app ? fullName(app.name, app.surname) : name;
    let standing: string;
    let group: TestAccount["group"];
    if (r.status === "active") {
      standing = r.rankName!;
      group = "member";
    } else if (r.status === "applicant") {
      standing = "Aspirante";
      group = "applicant";
    } else if (app) {
      standing = `Solicitud ${APPLICATION_STATUS_LABELS[app.status] ?? app.status}`;
      group = "applicant";
    } else {
      standing = r.status === "former" ? "Antiguo miembro" : "No está en esta hermandad";
      group = "other";
    }
    return { discordId, name, displayName, standing, group, rankOrder: r.rankOrder ?? Number.MAX_SAFE_INTEGER };
  });

  return accounts
    .sort(
      (a, b) =>
        GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
        a.rankOrder - b.rankOrder ||
        a.displayName.localeCompare(b.displayName),
    )
    .map(({ rankOrder: _rankOrder, ...account }) => account);
}

/** The next unused `recruit-<n>` Discord ID, for testing the application flow as a brand-new user. */
export async function nextRecruitId(db: Db): Promise<string> {
  const rows = await db.select({ discordId: users.discordId }).from(users).where(like(users.discordId, "recruit-%"));
  const max = rows.reduce((m, r) => {
    const n = Number(r.discordId!.slice("recruit-".length));
    return Number.isInteger(n) && n > m ? n : m;
  }, 0);
  return `recruit-${max + 1}`;
}
