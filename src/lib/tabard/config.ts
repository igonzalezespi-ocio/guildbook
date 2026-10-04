import { z } from "zod";
import { isCrestEmblem } from "@/lib/tabard/crest";
import { CREST_ART_VERSION } from "@/lib/tabard/crest-tone";
import { BACKGROUND_COLORS, BORDER_COLORS, EMBLEM_COLORS } from "@/lib/tabard/palette";

export const BORDER_STYLES = [
  { id: "plain", name: "Lisa" },
  { id: "double", name: "Doble" },
  { id: "wide", name: "Ancha" },
  { id: "studded", name: "Tachonada" },
  { id: "stitched", name: "Cosida" },
] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number]["id"];
export const BORDER_STYLE_IDS = BORDER_STYLES.map((s) => s.id) as [BorderStyle, ...BorderStyle[]];

/**
 * A guild's tabard: the game's colour ids for the three colours, Blizzard's emblem (lib/tabard/crest.ts) and the
 * style of Guildbook's drawn banner trim, which takes the border colour. `borderId` is the in-game border shape as
 * last imported from the game: kept for reference, never drawn.
 */
export interface TabardConfig {
  background: number;
  border: number;
  borderStyle: BorderStyle;
  emblemColor: number;
  emblemId: number;
  borderId?: number | null;
}

/**
 * The Order of Saint Michael's tabard: crimson field, gold border, white cross pattee. Stored for reference; the
 * Order renders its locked hand-drawn crest (components/crest.tsx), not the generic renderer.
 */
export const ORDER_TABARD: TabardConfig = { background: 2, border: 3, borderStyle: "plain", emblemColor: 14, emblemId: 97 };

/** What a new guild starts with until an officer designs its tabard: a gold lion on navy with a plain gold trim. */
export const DEFAULT_TABARD: TabardConfig = { background: 32, border: 3, borderStyle: "plain", emblemColor: 3, emblemId: 128 };

/** A short stable key for a tabard, used to version icon URLs so browsers refetch after a change. */
export function tabardKey(t: TabardConfig): string {
  return [t.background, t.border, t.borderStyle, t.emblemColor, `e${t.emblemId}`, `t${CREST_ART_VERSION}`].join("-");
}

/** Validates palette indexes, the trim style and the emblem id against the bundled set. */
export function tabardSchema() {
  const index = (max: number) => z.coerce.number().int().min(0).max(max);
  return z.object({
    background: index(BACKGROUND_COLORS.length - 1),
    border: index(BORDER_COLORS.length - 1),
    borderStyle: z.enum(BORDER_STYLE_IDS),
    emblemColor: index(EMBLEM_COLORS.length - 1),
    emblemId: z.coerce
      .string()
      .regex(/^\d+$/, "Elige un emblema de la lista.")
      .transform(Number)
      .refine(isCrestEmblem, "Elige un emblema de la lista."),
  });
}
