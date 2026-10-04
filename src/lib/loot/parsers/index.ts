import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "../constants";
import type { LootParser, ParseContext, ParseResult } from "../types";
import { gargulCustom, gargulJson, gargulTmb } from "./gargul";
import { rclcCsv, rclcJson } from "./rclc";

export { GARGUL_DEFAULT_TEMPLATE, compileTemplate } from "./gargul";

/** Every supported export format. Add a parser here to support a new tool. */
export const LOOT_PARSERS: readonly LootParser[] = [gargulJson, gargulTmb, gargulCustom, rclcCsv, rclcJson];

export type LootParserId = (typeof LOOT_PARSERS)[number]["id"];

export function getLootParser(id: string): LootParser | null {
  return LOOT_PARSERS.find((p) => p.id === id) ?? null;
}

/** The parser most confident about `raw`, or null when none recognises it. */
export function detectLootParser(raw: string): LootParser | null {
  let best: { parser: LootParser; score: number } | null = null;
  for (const parser of LOOT_PARSERS) {
    const score = parser.detect(raw);
    if (score > 0 && (!best || score > best.score)) best = { parser, score };
  }
  return best?.parser ?? null;
}

export class LootParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LootParseError";
  }
}

/** Parses an export with the named parser (or the detected one), enforcing the size limits. */
export function parseLootExport(raw: string, ctx: ParseContext & { parserId?: string | null }): ParseResult & { parser: LootParser } {
  if (!raw.trim()) throw new LootParseError("Pega primero una exportación.");
  if (new TextEncoder().encode(raw).length > MAX_IMPORT_BYTES) {
    throw new LootParseError("Esa exportación es demasiado grande. Exporta una noche de banda o unas pocas semanas cada vez.");
  }
  const parser = ctx.parserId ? getLootParser(ctx.parserId) : detectLootParser(raw);
  if (!parser) {
    throw new LootParseError(
      "Eso no parece una exportación de Gargul ni de RCLootCouncil. Elige el formato a mano si es una plantilla propia de Gargul.",
    );
  }
  const result = parser.parse(raw, ctx);
  if (result.rows.length > MAX_IMPORT_ROWS) {
    throw new LootParseError(`That export has ${result.rows.length} awards; import at most ${MAX_IMPORT_ROWS} at a time.`);
  }
  return { ...result, parser };
}
