import { type Tier, TIER_LABELS, tierAtLeast, tierLevel } from "./tiers";

/**
 * Minimum tier for every protected action. This map is the single source of truth:
 * server actions call `assertCan`, and the UI uses `can` only to decide what to render.
 */
export const POLICY = {
  // Signed-in visitors (no membership needed; `requiresUser` is checked separately)
  "application.submit": "public",
  "application.viewOwn": "public",
  "battlenet.link": "public",

  // Member area
  "member.area": "member",
  "character.manageOwn": "member",
  "vigil.use": "member",
  "loot.view": "member",

  // Officer admin
  "admin.area": "officer",
  "application.review": "officer",
  "battlenet.sync": "officer",
  "member.assignRank": "officer",
  "content.edit": "officer",
  "schedule.edit": "officer",
  "recruitment.edit": "officer",
  "progression.edit": "officer",
  "addons.edit": "officer",
  "audit.view": "officer",
  "loot.award": "officer",
  "loot.reverse": "officer",
  "loot.import": "officer",

  // Admin
  "rank.manage": "admin",
  "guild.settings": "admin",
  "domain.manage": "admin",
} as const satisfies Record<string, Tier>;

export type Action = keyof typeof POLICY;

/** Actions that need a signed-in user even though their tier is "public". */
const REQUIRES_USER: ReadonlySet<Action> = new Set(["application.submit", "application.viewOwn", "battlenet.link"]);

export interface Actor {
  guildId: string;
  userId: string | null;
  membershipId: string | null;
  tier: Tier;
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: "unauthenticated" | "forbidden" = "forbidden",
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function resolveTier(
  membership: { status: "applicant" | "active" | "former"; rankTier: Tier } | null,
): Tier {
  if (!membership) return "public";
  switch (membership.status) {
    case "active":
      return membership.rankTier;
    case "applicant":
      return "applicant";
    case "former":
      return "public";
  }
}

export function can(actor: Actor, action: Action): boolean {
  if (REQUIRES_USER.has(action) && !actor.userId) return false;
  if (POLICY[action] !== "public" && !actor.userId) return false;
  return tierAtLeast(actor.tier, POLICY[action]);
}

export function assertCan(actor: Actor, action: Action): asserts actor is Actor & { userId: string } {
  if (!actor.userId && (REQUIRES_USER.has(action) || POLICY[action] !== "public")) {
    throw new AuthorizationError("Tienes que iniciar sesión con Discord.", "unauthenticated");
  }
  if (!can(actor, action)) {
    throw new AuthorizationError(`Necesitas permisos de ${TIER_LABELS[POLICY[action]]}.`);
  }
}

/**
 * Rank assignment rules on top of the tier check:
 * - nobody grants a tier above their own;
 * - non-admins cannot change members at or above their own tier.
 */
export function canAssignRank(actor: Actor, targetCurrentTier: Tier, newRankTier: Tier): boolean {
  if (!can(actor, "member.assignRank")) return false;
  if (tierLevel(newRankTier) > tierLevel(actor.tier)) return false;
  if (actor.tier !== "admin" && tierLevel(targetCurrentTier) >= tierLevel(actor.tier)) return false;
  return true;
}
