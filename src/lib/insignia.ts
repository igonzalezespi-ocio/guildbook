import type { RankTier } from "@/lib/authz/tiers";

export const INSIGNIA = [
  "archangel",
  "keys",
  "banner",
  "laurel",
  "chalice",
  "cross-pattee",
  "chevron",
  "helm",
  "cross",
  "candle",
] as const;
export type Insignia = (typeof INSIGNIA)[number];

export const INSIGNIA_INFO: Record<Insignia, { label: string; meaning: string }> = {
  archangel: { label: "Arcángel", meaning: "La espada coronada de san Miguel entre sus alas" },
  keys: { label: "Llaves cruzadas", meaning: "El mayordomo que guarda las llaves de la casa, bajo la cruz" },
  banner: { label: "Espada y estandarte", meaning: "Porta el estandarte de la Orden y guía a la hueste en el campo" },
  laurel: { label: "Espada y laurel", meaning: "Manda una compañía" },
  chalice: { label: "Cáliz y hostia", meaning: "Custodio de la vida de oración de la Orden" },
  "cross-pattee": { label: "Cruz patada", meaning: "La cruz de las órdenes de caballería" },
  chevron: { label: "Galón", meaning: "La marca de un sargento de armas" },
  helm: { label: "Yelmo", meaning: "Lleva el yelmo y las armas de un caballero" },
  cross: { label: "Cruz", meaning: "Empieza su formación en la Orden" },
  candle: { label: "Vela", meaning: "Pide entrar: una luz en la ventana" },
};

/** The meanings above are the Order's; other guilds read these where the Order's mention it. */
const GENERIC_MEANINGS: Partial<Record<Insignia, string>> = {
  archangel: "Una espada coronada entre dos alas",
  keys: "El mayordomo que guarda las llaves de la casa",
  banner: "Porta el estandarte de la hermandad y guía a la hueste en el campo",
  chalice: "Custodio de la camaradería y las tradiciones de la hermandad",
  "cross-pattee": "La marca del núcleo de bandas",
  chevron: "Una marca de servicio constante",
  helm: "Lleva el yelmo y las armas de un raider",
  cross: "Da sus primeros pasos en la hermandad",
};

export function insigniaMeaning(insignia: Insignia, guild: { preset: string }) {
  return (guild.preset !== "order" && GENERIC_MEANINGS[insignia]) || INSIGNIA_INFO[insignia].meaning;
}

/** Used when a rank has no insignia chosen. */
export const DEFAULT_INSIGNIA_BY_TIER: Record<RankTier, Insignia> = {
  admin: "archangel",
  officer: "banner",
  raider: "cross-pattee",
  member: "cross",
  applicant: "candle",
};

export function insigniaFor(rank: { insignia: string | null; tier: RankTier }): Insignia {
  return (INSIGNIA as readonly string[]).includes(rank.insignia ?? "")
    ? (rank.insignia as Insignia)
    : DEFAULT_INSIGNIA_BY_TIER[rank.tier];
}
