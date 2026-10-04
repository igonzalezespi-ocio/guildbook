import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { parseItemLink, parseItemRef } from "./items";
import { derivedExternalId, normalizeLootName } from "./names";
import { compileTemplate, detectLootParser, getLootParser, LootParseError, parseLootExport } from "./parsers";
import { responseFromText } from "./responses";
import { dateInZone, zonedTime } from "./time";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/loot", name), "utf8");
const ctx = { timezone: "America/New_York" };
const at = (iso: string) => new Date(iso).toISOString();

describe("CSV", () => {
  it("handles quoted commas, doubled quotes, CRLF and trailing tabs", () => {
    const rows = parseCsv('a,b,c \t\r\n"x, y","say ""hi""",3\r\n\r\nlast,,\n');
    expect(rows.map((r) => r.cells)).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "3"],
      ["last", "", ""],
    ]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 4]);
  });
});

describe("time zones", () => {
  it("turns an Eastern wall-clock time into the right instant across DST", () => {
    expect(zonedTime({ year: 2026, month: 12, day: 8, hour: 20, minute: 47 }, "America/New_York")!.toISOString()).toBe(
      "2026-12-09T01:47:00.000Z",
    );
    expect(zonedTime({ year: 2026, month: 7, day: 1, hour: 20 }, "America/New_York")!.toISOString()).toBe("2026-07-02T00:00:00.000Z");
    expect(zonedTime({ year: 2026, month: 2, day: 30 }, "UTC")).toBeNull();
  });

  it("dates a late-night award on the raid night in the guild's zone", () => {
    expect(dateInZone(new Date("2026-12-09T03:30:00Z"), "America/New_York")).toBe("2026-12-08");
  });
});

describe("names and items", () => {
  it("drops the realm and normalises case and spacing", () => {
    expect(normalizeLootName("Cassian-Forever")).toBe("cassian");
    expect(normalizeLootName("  Ambrose   Duskmantle-Forever ")).toBe("ambrose duskmantle");
  });

  it("derives the same external ID for the same item, player and minute", () => {
    const a = derivedExternalId(18203, "Cassian-Forever", new Date("2026-12-09T01:47:10Z"));
    expect(a).toBe(derivedExternalId(18203, "cassian", new Date("2026-12-09T01:47:59Z")));
    expect(a).not.toBe(derivedExternalId(18203, "cassian", new Date("2026-12-09T01:48:00Z")));
  });

  it("reads item links, IDs, Wowhead URLs and names", () => {
    expect(parseItemLink("|cffa335ee|Hitem:18203::::|h[Eskhandar's Right Claw]|h|r")).toEqual({
      itemId: 18203,
      name: "Eskhandar's Right Claw",
      quality: 4,
    });
    expect(parseItemRef("19019")).toEqual({ itemId: 19019, name: null });
    expect(parseItemRef("https://www.wowhead.com/classic/item=19019/thunderfury")).toEqual({ itemId: 19019, name: null });
    expect(parseItemRef("Earthshaker (17073)")).toEqual({ itemId: 17073, name: "Earthshaker" });
    expect(parseItemRef("Earthshaker")).toEqual({ itemId: null, name: "Earthshaker" });
  });

  it("maps free-text responses", () => {
    expect(responseFromText("Upgrade", "council")).toBe("main_spec");
    expect(responseFromText("Offspec", "council")).toBe("off_spec");
    expect(responseFromText("Disenchant", "council")).toBe("disenchant");
    expect(responseFromText("SR", "roll")).toBe("soft_reserve");
    expect(responseFromText("nil", "council")).toBe("council");
  });
});

describe("detection", () => {
  it.each([
    ["gargul.json", "gargul-json"],
    ["gargul-tmb.csv", "gargul-tmb"],
    ["gargul-custom.txt", "gargul-custom"],
    ["rclc.csv", "rclc-csv"],
    ["rclc.json", "rclc-json"],
  ])("recognises %s as %s", (file, id) => {
    expect(detectLootParser(fixture(file))?.id).toBe(id);
  });

  it("recognises nothing in unrelated text", () => {
    expect(detectLootParser("hello world")).toBeNull();
    expect(() => parseLootExport("hello world", ctx)).toThrow(LootParseError);
    expect(() => parseLootExport("   ", ctx)).toThrow("Pega primero una exportación.");
  });
});

describe("Gargul JSON", () => {
  const { rows, warnings } = parseLootExport(fixture("gargul.json"), ctx);

  it("reads awards with exact times, checksums and item details from the link", () => {
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      externalId: "a1b2c3d4e5f6a7b8c9d0",
      itemId: 18203,
      itemName: "Eskhandar's Right Claw",
      itemQuality: 4,
      recipient: { raw: "Cassian-Forever", name: "Cassian", wowClass: "rogue" },
      timePrecision: "exact",
      response: "main_spec",
      responseText: "MS",
    });
    expect(at(rows[0]!.awardedAt.toISOString())).toBe("2026-12-09T01:47:00.000Z");
  });

  it("maps soft reserves, off-spec and disenchants", () => {
    expect(rows[1]).toMatchObject({ response: "soft_reserve", recipient: { name: "Ambrose Duskmantle" } });
    expect(rows[2]).toMatchObject({ response: "off_spec" });
    expect(rows[3]).toMatchObject({ response: "disenchant", recipient: null, itemQuality: 3 });
  });

  it("derives an external ID when the checksum is missing and skips broken entries", () => {
    expect(rows[4]).toMatchObject({ itemId: 16863, itemName: "Gauntlets of Might" });
    expect(rows[4]!.externalId).toMatch(/^h:/);
    expect(warnings).toEqual([{ line: 6, message: "Se ha omitido una entrega sin objeto, jugador u hora." }]);
  });
});

describe("Gargul TMB", () => {
  const { rows, warnings } = parseLootExport(fixture("gargul-tmb.csv"), ctx);

  it("dates each award at noon on its day in the guild's zone and keeps the checksum", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ externalId: "a1b2c3d4e5f6a7b8c9d0", itemId: 18203, timePrecision: "day", response: "main_spec" });
    expect(rows[0]!.awardedAt.toISOString()).toBe("2026-12-08T17:00:00.000Z");
    expect(rows[2]).toMatchObject({ response: "off_spec" });
    expect(rows[3]!.externalId).toMatch(/^h:/);
    expect(warnings).toHaveLength(1);
  });
});

describe("Gargul custom", () => {
  it("parses the default template in the guild's zone", () => {
    const { rows, warnings } = parseLootExport(fixture("gargul-custom.txt"), ctx);
    expect(warnings).toEqual([]);
    expect(rows.map((r) => [r.itemId, r.recipient?.name, r.awardedAt.toISOString(), r.timePrecision])).toEqual([
      [18203, "Cassian", "2026-12-09T01:47:00.000Z", "minute"],
      [16805, "Ambrose", "2026-12-09T02:31:00.000Z", "minute"],
      [17073, "Athanasius", "2026-12-09T03:20:00.000Z", "minute"],
    ]);
  });

  it("uses an officer-supplied template, skipping a header line", () => {
    const raw = "Item,Player,Date\nEarthshaker,17073,Athanasius-Forever,2026-12-08,true\n";
    const { rows, warnings } = parseLootExport(raw, { ...ctx, parserId: "gargul-custom", template: "@ITEM,@ID,@WINNER,@DATE,@OS" });
    expect(warnings).toEqual([]);
    expect(rows[0]).toMatchObject({ itemId: 17073, itemName: "Earthshaker", response: "off_spec", timePrecision: "day" });
  });

  it("rejects a template with no item or player", () => {
    expect(compileTemplate("@DATE @TIME")).toBeNull();
    const { rows, warnings } = getLootParser("gargul-custom")!.parse("x", { ...ctx, template: "@DATE" });
    expect(rows).toEqual([]);
    expect(warnings[0]!.message).toMatch(/plantilla necesita/);
  });
});

describe("RCLootCouncil CSV", () => {
  const { rows, warnings } = parseLootExport(fixture("rclc.csv"), ctx);

  it("takes the time from the id, strips difficulty from the instance and keeps votes and notes", () => {
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      externalId: "1796780820-1",
      itemName: "Eskhandar's Right Claw",
      recipient: { name: "Cassian", wowClass: "rogue" },
      response: "main_spec",
      responseText: "Upgrade",
      votes: 3,
      instance: "Onyxia's Lair",
      boss: "Onyxia",
      note: "Council agreed",
      timePrecision: "exact",
    });
    expect(rows[0]!.awardedAt.toISOString()).toBe("2026-12-09T01:47:00.000Z");
  });

  it("reads quoted item names with commas and old d/m/yy dates", () => {
    expect(rows[1]).toMatchObject({ response: "off_spec", votes: 0, note: null, instance: "Molten Core" });
    expect(rows[2]).toMatchObject({ itemName: "Thunderfury, Blessed Blade of the Windseeker", note: "Bindings, both halves", instance: "Molten Core" });
  });

  it("falls back to the date columns and a derived id, and skips rows with no player", () => {
    expect(rows[3]).toMatchObject({ response: "disenchant", votes: null, recipient: { name: "Anselm" } });
    expect(rows[3]!.awardedAt.toISOString()).toBe("2026-12-09T03:25:00.000Z");
    expect(rows[3]!.externalId).toMatch(/^h:/);
    expect(warnings).toHaveLength(1);
  });
});

describe("RCLootCouncil JSON", () => {
  it("reads the same fields without item names", () => {
    const { rows, warnings } = parseLootExport(fixture("rclc.json"), ctx);
    expect(warnings).toEqual([]);
    expect(rows.map((r) => [r.externalId, r.itemId, r.itemName, r.response, r.note])).toEqual([
      ["1796780820-1", 18203, null, "main_spec", null],
      ["1796954940-7", 16863, null, "off_spec", "Tank set"],
    ]);
  });
});
