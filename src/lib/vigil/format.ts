export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

export const formatNumber = (n: number) => Math.round(n).toLocaleString("es-ES");

export const formatPct = (ratio: number) => `${Math.round(ratio * 100)}%`;

export const METRIC_LABELS = { damage: "Daño", threat: "Amenaza", healing: "Sanación" } as const;

/** Crimson below 60, gold from 60, bright gold from 85. */
export function scoreTone(score: number): string {
  if (score >= 85) return "text-gold-bright";
  if (score >= 60) return "text-gold";
  return "text-crimson-bright";
}

/** Spanish names for the resource a report stores in English ("Rage"). Logic keeps comparing the stored value. */
export const RESOURCE_LABELS: Record<string, string> = { Mana: "Maná", Rage: "Ira", Focus: "Concentración", Energy: "Energía", Power: "Poder" };
export const resourceLabel = (name: string) => RESOURCE_LABELS[name] ?? name;
