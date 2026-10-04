import { parseCsv } from "../csv";
import { positiveInt, stripBrackets } from "../items";
import { derivedExternalId, lootRecipient } from "../names";
import { responseFromText } from "../responses";
import { fullYear, zonedTime } from "../time";
import type { LootParser, ParseContext, ParsedAward, ParseResult, ParseWarning } from "../types";

const HEADER = /^\s*player\s*,\s*date\s*,\s*time\s*,\s*id\s*,/i;

const nil = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "nil" || s === "Unknown" ? null : s;
};

/** RCLootCouncil's `id` is `<unix seconds>-<counter>`, which gives the exact award time regardless of date format. */
function timeFromId(id: string | null): Date | null {
  const m = id?.match(/^(\d{9,11})-\d+$/);
  return m ? new Date(Number(m[1]) * 1000) : null;
}

/** Old exports write `d/m/yy`, newer ones `yyyy/m/d`; the time is the exporter's local time. */
function timeFromDate(date: string | null, time: string | null, timeZone: string): Date | null {
  const d = date?.match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,4})$/);
  if (!d) return null;
  const [a, b, c] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const ymd = d[1]!.length === 4 ? { year: a, month: b, day: c } : { year: fullYear(c), month: b, day: a };
  const t = time?.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  return zonedTime({ ...ymd, hour: t ? +t[1]! : 12, minute: t ? +t[2]! : 0, second: t?.[3] ? +t[3] : 0 }, timeZone);
}

/** "Molten Core-Normal" or "Uldir-Heroic": the instance without its difficulty. */
function instanceName(raw: string | null): string | null {
  if (!raw) return null;
  const m = raw.match(/^(.*\S)\s*-\s*(normal|heroic|mythic|lfr|raid finder|looking for raid|\d+\s*player|10|20|25|40)$/i);
  return m ? m[1]! : raw;
}

function toAward(r: Record<string, unknown>, line: number, ctx: ParseContext, warnings: ParseWarning[]): ParsedAward | null {
  const player = nil(r.player);
  const itemId = positiveInt(r.itemID) ?? positiveInt(nil(r.itemString)?.match(/item:(\d+)/)?.[1]);
  const id = nil(r.id);
  const exact = timeFromId(id);
  const awardedAt = exact ?? timeFromDate(nil(r.date), nil(r.time), ctx.timezone);
  if (!player || !itemId || !awardedAt) {
    warnings.push({ line, message: "Se ha omitido una fila sin jugador, ID de objeto o fecha." });
    return null;
  }
  const responseText = nil(r.response);
  const votes = positiveInt(r.votes) ?? (String(r.votes).trim() === "0" ? 0 : null);
  return {
    externalId: id ?? derivedExternalId(itemId, player, awardedAt),
    itemId,
    itemName: stripBrackets(nil(r.item)),
    itemQuality: null,
    recipient: lootRecipient(player, nil(r.class)),
    awardedAt,
    timePrecision: exact || nil(r.time)?.split(":").length === 3 ? "exact" : "minute",
    response: responseFromText(responseText, "council"),
    responseText,
    votes,
    instance: instanceName(nil(r.instance)),
    boss: nil(r.boss),
    note: nil(r.note),
  };
}

export const rclcCsv: LootParser = {
  id: "rclc-csv",
  label: "RCLootCouncil (CSV)",
  source: "rclc",
  detect(raw) {
    return HEADER.test(raw.trimStart().split(/\r?\n/, 1)[0] ?? "") ? 0.95 : 0;
  },
  parse(raw, ctx): ParseResult {
    const records = parseCsv(raw.trim());
    const header = records.shift();
    if (!header || !HEADER.test(header.cells.join(","))) {
      return { rows: [], warnings: [{ line: 1, message: "La primera línea debería ser la cabecera CSV de RCLootCouncil (player,date,time,id,...)." }] };
    }
    const columns = header.cells.map((c) => c.trim());
    const rows: ParsedAward[] = [];
    const warnings: ParseWarning[] = [];
    for (const { line, cells } of records) {
      const record = Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? ""]));
      const award = toAward(record, line, ctx, warnings);
      if (award) rows.push(award);
    }
    return { rows, warnings };
  },
};

export const rclcJson: LootParser = {
  id: "rclc-json",
  label: "RCLootCouncil (JSON)",
  source: "rclc",
  detect(raw) {
    const t = raw.trimStart();
    if (!t.startsWith("[") && !t.startsWith("{")) return 0;
    return /"player"\s*:/.test(t) && /"responseID"\s*:/.test(t) ? 0.95 : 0;
  },
  parse(raw, ctx): ParseResult {
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { rows: [], warnings: [{ line: 1, message: "Esto no es un JSON válido." }] };
    }
    const list = Array.isArray(json) ? json : [json];
    const rows: ParsedAward[] = [];
    const warnings: ParseWarning[] = [];
    list.forEach((entry, i) => {
      if (!entry || typeof entry !== "object") {
        warnings.push({ line: i + 1, message: "Se ha omitido una entrada que no es un objeto." });
        return;
      }
      const award = toAward(entry as Record<string, unknown>, i + 1, ctx, warnings);
      if (award) rows.push(award);
    });
    return { rows, warnings };
  },
};
