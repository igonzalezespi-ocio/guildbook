/** Ordered lowest to highest. "public" is never stored on a rank; it is the tier of anyone without a membership. */
export const TIERS = ["public", "applicant", "member", "raider", "officer", "admin"] as const;
export type Tier = (typeof TIERS)[number];

export const RANK_TIERS = ["applicant", "member", "raider", "officer", "admin"] as const;
export type RankTier = (typeof RANK_TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  public: "Público",
  applicant: "Aspirante",
  member: "Miembro",
  raider: "Raider",
  officer: "Oficial",
  admin: "Administrador",
};

export function tierLevel(tier: Tier): number {
  return TIERS.indexOf(tier);
}

export function tierAtLeast(tier: Tier, min: Tier): boolean {
  return tierLevel(tier) >= tierLevel(min);
}
