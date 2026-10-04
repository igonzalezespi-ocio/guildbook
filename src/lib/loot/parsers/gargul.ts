import type { LootResponse } from "../constants";
import { parseCsv } from "../csv";
import { parseItemLink, positiveInt } from "../items";
import { derivedExternalId, lootRecipient } from "../names";
import { responseFromText } from "../responses";
import { zonedTime } from "../time";
import type { LootParser, ParseContext, ParsedAward, ParseResult, ParseWarning } from "../types";

/** Gargul writes this in place of a player for disenchanted items. */
const DISENCHANT_ID = /^\|{1,2}de\|{1,2}$/i;

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";

function gargulResponse(flags: { os?: unknown; sr?: unknown; wl?: unknown; pl?: unknown; tmb?: unknown }, rollType: string | null): LootResponse {
  if (truthy(flags.sr)) return "soft_reserve";
  if (truthy(flags.os)) return "off_spec";
  if (truthy(flags.wl) || truthy(flags.pl) || truthy(flags.tmb)) return "main_spec";
  return responseFromText(rollType, "roll");
}

function isoDateParts(date: string): { year: number; month: number; day: number } | null {
  const m = date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? { year: +m[1]!, month: +m[2]!, day: +m[3]! } : null;
}

// --- JSON: the raw award history, with Unix timestamps ----------------------------------------------------------

type GargulEntry = Record<string, unknown>;

function gargulEntries(raw: string): GargulEntry[] | null {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const list = Array.isArray(json) ? json : json && typeof json === "object" ? Object.values(json) : null;
  return list?.filter((e): e is GargulEntry => Boolean(e) && typeof e === "object" && !Array.isArray(e)) ?? null;
}

export const gargulJson: LootParser = {
  id: "gargul-json",
  label: "Gargul (JSON)",
  source: "gargul",
  detect(raw) {
    const t = raw.trimStart();
    if (!t.startsWith("[") && !t.startsWith("{")) return 0;
    return /"awardedTo"\s*:/.test(t) && /"timestamp"\s*:/.test(t) ? 0.95 : 0;
  },
  parse(raw) {
    const entries = gargulEntries(raw);
    if (!entries) return { rows: [], warnings: [{ line: 1, message: "Esto no es un JSON válido." }] };
    const rows: ParsedAward[] = [];
    const warnings: ParseWarning[] = [];
    entries.forEach((e, i) => {
      const line = i + 1;
      const link = parseItemLink(typeof e.itemLink === "string" ? e.itemLink : null);
      const itemId = positiveInt(e.itemID) ?? link?.itemId ?? null;
      const ts = typeof e.timestamp === "number" ? e.timestamp : positiveInt(e.timestamp);
      const awardedTo = typeof e.awardedTo === "string" ? e.awardedTo.trim() : "";
      if (!itemId || !ts || !awardedTo) {
        warnings.push({ line, message: "Se ha omitido una entrega sin objeto, jugador u hora." });
        return;
      }
      const awardedAt = new Date(ts * 1000);
      const disenchanted = DISENCHANT_ID.test(awardedTo);
      const rollType = typeof e.winningRollType === "string" && e.winningRollType !== "-" ? e.winningRollType : null;
      const recipient = disenchanted ? null : lootRecipient(awardedTo, typeof e.winnerClass === "string" ? e.winnerClass : null);
      rows.push({
        externalId: typeof e.checksum === "string" && e.checksum ? e.checksum : derivedExternalId(itemId, awardedTo, awardedAt),
        itemId,
        itemName: link?.name ?? null,
        itemQuality: link?.quality ?? null,
        recipient,
        awardedAt,
        timePrecision: "exact",
        response: disenchanted ? "disenchant" : gargulResponse({ os: e.OS, sr: e.SR, wl: e.WL, pl: e.PL, tmb: e.TMB }, rollType),
        responseText: rollType,
        votes: null,
        instance: null,
        boss: null,
        note: null,
      });
    });
    return { rows, warnings };
  },
};

// --- TMB CSV: dateTime,character,itemID,offspec,id ---------------------------------------------------------------

const TMB_HEADER = /^\s*datetime\s*,\s*character\s*,\s*itemid\s*,\s*offspec\s*,\s*id\s*$/i;

export const gargulTmb: LootParser = {
  id: "gargul-tmb",
  label: "Gargul (exportación TMB)",
  source: "gargul",
  detect(raw) {
    const first = raw.trimStart().split(/\r?\n/, 1)[0] ?? "";
    return TMB_HEADER.test(first) ? 0.9 : 0;
  },
  parse(raw, ctx) {
    const records = parseCsv(raw.trim());
    const rows: ParsedAward[] = [];
    const warnings: ParseWarning[] = [];
    for (const { line, cells } of records) {
      if (TMB_HEADER.test(cells.join(","))) continue;
      const [dateTime = "", character = "", itemIdText = "", offspec = "", id = ""] = cells.map((c) => c.trim());
      const date = isoDateParts(dateTime.split(" ")[0] ?? "");
      const itemId = positiveInt(itemIdText);
      const awardedAt = date && zonedTime({ ...date, hour: 12 }, ctx.timezone);
      if (!awardedAt || !itemId || !character) {
        warnings.push({ line, message: "Se ha omitido una fila sin fecha, jugador o ID de objeto." });
        continue;
      }
      const disenchanted = DISENCHANT_ID.test(character);
      rows.push({
        externalId: id || derivedExternalId(itemId, character, awardedAt),
        itemId,
        itemName: null,
        itemQuality: null,
        recipient: disenchanted ? null : lootRecipient(character, null),
        awardedAt,
        timePrecision: "day",
        response: disenchanted ? "disenchant" : truthy(offspec) ? "off_spec" : "main_spec",
        responseText: null,
        votes: null,
        instance: null,
        boss: null,
        note: null,
      });
    }
    return { rows, warnings };
  },
};

// --- Custom template, e.g. @ID;@DATE @TIME;@WINNER ---------------------------------------------------------------

export const GARGUL_DEFAULT_TEMPLATE = "@ID;@DATE @TIME;@WINNER";
const RROBIN_TEMPLATE = "@ID,@DATE @TIME,@WINNER-@REALM";

const TOKEN_PATTERNS: Record<string, string> = {
  "@NORMALIZED": "(.+?)",
  "@CHECKSUM": "([^\\s,;]*)",
  "@ROLLTYPE": "(.*?)",
  "@QUALITY": "(\\d?)",
  "@WOWHEAD": "(.*?)",
  "@MINUTE": "(\\d{1,2})",
  "@WINNER": "(.+?)",
  "@MONTH": "(\\d{1,2})",
  "@REALM": "(.*?)",
  "@LINK": "(.*?)",
  "@ITEM": "(.*?)",
  "@ILVL": "(\\d*)",
  "@YEAR": "(\\d{4})",
  "@HOUR": "(\\d{1,2})",
  "@DATE": "(\\d{4}-\\d{1,2}-\\d{1,2})",
  "@TIME": "(\\d{1,2}:\\d{2})",
  "@DAY": "(\\d{1,2})",
  "@TMB": "(true|false|1|0|nil)?",
  "@ID": "(\\d+)",
  "@OS": "(true|false|1|0|nil)?",
  "@SR": "(true|false|1|0|nil)?",
  "@WL": "(true|false|1|0|nil)?",
  "@PL": "(true|false|1|0|nil)?",
  "@YY": "(\\d{2})",
};
const TOKEN_RE = new RegExp(
  Object.keys(TOKEN_PATTERNS)
    .sort((a, b) => b.length - a.length)
    .join("|"),
  "g",
);

export function compileTemplate(template: string): { regex: RegExp; tokens: string[] } | null {
  const tokens: string[] = [];
  let pattern = "";
  let last = 0;
  for (const m of template.matchAll(TOKEN_RE)) {
    pattern += template.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    pattern += TOKEN_PATTERNS[m[0]];
    tokens.push(m[0]);
    last = m.index + m[0].length;
  }
  pattern += template.slice(last).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const hasItem = tokens.includes("@ID") || tokens.includes("@LINK");
  const hasPlayer = tokens.includes("@WINNER") || tokens.includes("@NORMALIZED");
  if (!hasItem || !hasPlayer) return null;
  return { regex: new RegExp(`^${pattern}$`), tokens };
}

function matchShare(raw: string, template: string): number {
  const compiled = compileTemplate(template);
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 20);
  if (!compiled || lines.length === 0) return 0;
  return lines.filter((l) => compiled.regex.test(l)).length / lines.length;
}

function parseTemplated(raw: string, template: string, ctx: ParseContext): ParseResult {
  const compiled = compileTemplate(template);
  if (!compiled) {
    return { rows: [], warnings: [{ line: 1, message: "La plantilla necesita @ID o @LINK, y @WINNER o @NORMALIZED." }] };
  }
  const rows: ParsedAward[] = [];
  const warnings: ParseWarning[] = [];
  raw.split(/\r?\n/).forEach((text, i) => {
    const line = i + 1;
    const trimmed = text.trim();
    if (!trimmed) return;
    const m = trimmed.match(compiled.regex);
    if (!m) {
      // Gargul can put a header line above the rows.
      if (rows.length > 0 || warnings.length > 0 || line > 1) warnings.push({ line, message: "Se ha omitido una línea que no encaja con la plantilla." });
      return;
    }
    const v: Record<string, string> = {};
    compiled.tokens.forEach((t, j) => (v[t] = m[j + 1]?.trim() ?? ""));
    const link = parseItemLink(v["@LINK"]);
    const itemId = positiveInt(v["@ID"]) ?? link?.itemId ?? null;
    const player = v["@WINNER"] || v["@NORMALIZED"] || "";
    const date = v["@DATE"]
      ? isoDateParts(v["@DATE"])
      : v["@YEAR"] || v["@YY"]
        ? { year: v["@YEAR"] ? +v["@YEAR"] : 2000 + +v["@YY"]!, month: +(v["@MONTH"] || 0), day: +(v["@DAY"] || 0) }
        : null;
    const [hh, mm] = v["@TIME"] ? v["@TIME"].split(":").map(Number) : [v["@HOUR"], v["@MINUTE"]].map((x) => (x ? Number(x) : undefined));
    const hasTime = hh !== undefined && mm !== undefined;
    const awardedAt = date && zonedTime({ ...date, hour: hasTime ? hh : 12, minute: hasTime ? mm : 0 }, ctx.timezone);
    if (!itemId || !player || !awardedAt) {
      warnings.push({ line, message: "Se ha omitido una línea sin ID de objeto, jugador o fecha." });
      return;
    }
    const disenchanted = DISENCHANT_ID.test(player);
    const rollType = v["@ROLLTYPE"] && v["@ROLLTYPE"] !== "-" ? v["@ROLLTYPE"] : null;
    rows.push({
      externalId: v["@CHECKSUM"] || derivedExternalId(itemId, player, awardedAt),
      itemId,
      itemName: v["@ITEM"] || link?.name || null,
      itemQuality: link?.quality ?? (v["@QUALITY"] ? (Number(v["@QUALITY"]) as ParsedAward["itemQuality"]) : null),
      recipient: disenchanted ? null : lootRecipient(player, null),
      awardedAt,
      timePrecision: hasTime ? "minute" : "day",
      response: disenchanted
        ? "disenchant"
        : gargulResponse({ os: v["@OS"], sr: v["@SR"], wl: v["@WL"], pl: v["@PL"], tmb: v["@TMB"] }, rollType),
      responseText: rollType,
      votes: null,
      instance: null,
      boss: null,
      note: null,
    });
  });
  return { rows, warnings };
}

export const gargulCustom: LootParser = {
  id: "gargul-custom",
  label: "Gargul (formato propio o RRobin)",
  source: "gargul",
  detect(raw) {
    const share = Math.max(matchShare(raw, GARGUL_DEFAULT_TEMPLATE), matchShare(raw, RROBIN_TEMPLATE));
    return share >= 0.5 ? 0.6 + share * 0.2 : 0;
  },
  parse(raw, ctx) {
    const template =
      ctx.template?.trim() ||
      (matchShare(raw, RROBIN_TEMPLATE) > matchShare(raw, GARGUL_DEFAULT_TEMPLATE) ? RROBIN_TEMPLATE : GARGUL_DEFAULT_TEMPLATE);
    return parseTemplated(raw, template, ctx);
  },
};
