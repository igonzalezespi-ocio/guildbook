import type { Actor } from "@/lib/authz/policy";
import { tierAtLeast } from "@/lib/authz/tiers";

export const VISIBILITIES = ["private", "officers", "guild"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VISIBILITY_LABELS: Record<Visibility, string> = {
  private: "Privado",
  officers: "Compartido con los oficiales",
  guild: "Compartido con la hermandad",
};

/**
 * Who may read a report: the owner always; otherwise only while the owner is still an active member,
 * officers for "officers" and "guild", and members for "guild". Private means private, officers included.
 */
export function canViewReport(
  actor: Pick<Actor, "membershipId" | "tier">,
  report: { membershipId: string; visibility: Visibility; ownerActive: boolean },
): boolean {
  if (actor.membershipId && actor.membershipId === report.membershipId) return true;
  if (!report.ownerActive) return false;
  switch (report.visibility) {
    case "guild":
      return tierAtLeast(actor.tier, "member");
    case "officers":
      return tierAtLeast(actor.tier, "officer");
    case "private":
      return false;
  }
}
