/** Why an item went to its recipient. Imports map each tool's own wording onto these. */
export const LOOT_RESPONSES = [
  "main_spec",
  "off_spec",
  "soft_reserve",
  "council",
  "roll",
  "disenchant",
  "bank",
  "other",
] as const;
export type LootResponse = (typeof LOOT_RESPONSES)[number];

export const LOOT_RESPONSE_LABELS: Record<LootResponse, string> = {
  main_spec: "Especialización principal",
  off_spec: "Especialización secundaria",
  soft_reserve: "Reserva (SR)",
  council: "Consejo de botín",
  roll: "Tirada",
  disenchant: "Desencantado",
  bank: "Banco de la hermandad",
  other: "Otro",
};

/** Responses where nobody receives the item as a player. */
export const NO_RECIPIENT_RESPONSES: ReadonlySet<LootResponse> = new Set(["disenchant", "bank"]);

/** Where a ledger entry came from. Imports dedupe on (source, external id). */
export const LOOT_SOURCES = ["manual", "gargul", "rclc"] as const;
export type LootSource = (typeof LOOT_SOURCES)[number];

export const LOOT_SOURCE_LABELS: Record<LootSource, string> = {
  manual: "Registrado a mano",
  gargul: "Gargul",
  rclc: "RCLootCouncil",
};

/** Where cached item data came from. Blizzard API data must be refreshed or dropped within 30 days. */
export const ITEM_DATA_SOURCES = ["import", "addon", "blizzard", "manual"] as const;
export type ItemDataSource = (typeof ITEM_DATA_SOURCES)[number];

export const ITEM_QUALITIES = [0, 1, 2, 3, 4, 5, 6] as const;
export type ItemQuality = (typeof ITEM_QUALITIES)[number];

export const ITEM_QUALITY_INFO: Record<ItemQuality, { label: string; color: string }> = {
  0: { label: "Pobre", color: "#9d9d9d" },
  1: { label: "Común", color: "#ffffff" },
  2: { label: "Poco común", color: "#1eff00" },
  3: { label: "Raro", color: "#0070dd" },
  4: { label: "Épico", color: "#a335ee" },
  5: { label: "Legendario", color: "#ff8000" },
  6: { label: "Artefacto", color: "#e6cc80" },
};

/** Item link colour codes (`|cffa335ee`) to quality. */
const QUALITY_BY_HEX: Record<string, ItemQuality> = Object.fromEntries(
  ITEM_QUALITIES.map((q) => [ITEM_QUALITY_INFO[q].color.slice(1), q]),
) as Record<string, ItemQuality>;

export function qualityFromHex(hex: string | null | undefined): ItemQuality | null {
  if (!hex) return null;
  const key = hex.toLowerCase().replace(/^#/, "").slice(-6);
  return QUALITY_BY_HEX[key] ?? null;
}

export function isItemQuality(n: unknown): n is ItemQuality {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;
}

/** Rows one import may hold, and the most text an officer may paste. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1_000_000;
