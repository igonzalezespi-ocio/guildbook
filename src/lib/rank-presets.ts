import type { RankTier } from "@/lib/authz/tiers";
import type { Insignia } from "@/lib/insignia";

export type RankTemplate = { name: string; description: string; tier: RankTier; insignia: Insignia; inGame: boolean };

export interface RankPreset {
  label: string;
  summary: string;
  ranks: RankTemplate[];
  /** Rank names used for website applicants, accepted applicants and trial members. */
  applicantRank: string;
  acceptRank: string;
  trialRank: string;
}

/**
 * Starter rank ladders for guilds created on Guildbook, each covering every permission tier. Officers rename,
 * reorder and extend them freely under Admin, then Ranks. The Order of Saint Michael keeps its own ladder.
 */
export const RANK_PRESETS = {
  raiding: {
    label: "Bandas",
    summary: "Un equipo de bandas con un núcleo fijo y pruebas.",
    ranks: [
      { name: "Maestro de hermandad", description: "Líder de la hermandad", tier: "admin", insignia: "banner", inGame: true },
      { name: "Oficial", description: "Organiza las bandas, el reclutamiento y el banco de la hermandad", tier: "officer", insignia: "laurel", inGame: true },
      { name: "Raider", description: "Raider del núcleo", tier: "raider", insignia: "helm", inGame: true },
      { name: "Miembro", description: "Miembro, social o subiendo de nivel", tier: "member", insignia: "chevron", inGame: true },
      { name: "A prueba", description: "Miembro a prueba", tier: "member", insignia: "chevron", inGame: true },
      { name: "Aspirante", description: "Aspirante en la web; no es un rango de la hermandad en el juego", tier: "applicant", insignia: "candle", inGame: false },
    ],
    applicantRank: "Aspirante",
    acceptRank: "Miembro",
    trialRank: "A prueba",
  },
  social: {
    label: "Social",
    summary: "Una hermandad de comunidad para subir de nivel, hacer mazmorras y estar con amigos.",
    ranks: [
      { name: "Maestro de hermandad", description: "Líder de la hermandad", tier: "admin", insignia: "banner", inGame: true },
      { name: "Oficial", description: "Mantiene la hermandad en marcha y da la bienvenida a los nuevos", tier: "officer", insignia: "laurel", inGame: true },
      { name: "Veterano", description: "Miembro de toda la vida", tier: "raider", insignia: "helm", inGame: true },
      { name: "Miembro", description: "Miembro de la hermandad", tier: "member", insignia: "chevron", inGame: true },
      { name: "Iniciado", description: "Miembro nuevo que está conociendo la hermandad", tier: "member", insignia: "chevron", inGame: true },
      { name: "Aspirante", description: "Aspirante en la web; no es un rango de la hermandad en el juego", tier: "applicant", insignia: "candle", inGame: false },
    ],
    applicantRank: "Aspirante",
    acceptRank: "Miembro",
    trialRank: "Iniciado",
  },
  roleplay: {
    label: "Rol",
    summary: "Títulos dentro del personaje para una compañía de rol.",
    ranks: [
      { name: "Comandante", description: "Dirige la compañía", tier: "admin", insignia: "banner", inGame: true },
      { name: "Capitán", description: "Dirige eventos y tramas", tier: "officer", insignia: "laurel", inGame: true },
      { name: "Veterano", description: "Miembro de confianza de la compañía", tier: "raider", insignia: "helm", inGame: true },
      { name: "Juramentado", description: "Miembro de pleno derecho de la compañía", tier: "member", insignia: "chevron", inGame: true },
      { name: "Recluta", description: "Recién llegado, aún demostrando su valía", tier: "member", insignia: "chevron", inGame: true },
      { name: "Peticionario", description: "Aspirante en la web; no es un rango de la hermandad en el juego", tier: "applicant", insignia: "candle", inGame: false },
    ],
    applicantRank: "Peticionario",
    acceptRank: "Juramentado",
    trialRank: "Recluta",
  },
} as const satisfies Record<string, RankPreset>;

export type RankPresetKey = keyof typeof RANK_PRESETS;
export const RANK_PRESET_KEYS = Object.keys(RANK_PRESETS) as RankPresetKey[];
export const DEFAULT_RANK_PRESET: RankPresetKey = "raiding";

export function isRankPresetKey(value: unknown): value is RankPresetKey {
  return typeof value === "string" && Object.hasOwn(RANK_PRESETS, value);
}
