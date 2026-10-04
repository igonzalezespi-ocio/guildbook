import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeText, scanText } from "@/lib/vigil/analyze";
import { detectGameVersion } from "@/lib/vigil/game-version";
import { fightReportSchema } from "@/lib/vigil/report";
import { detectModel } from "@/lib/vigil/rotations";

/**
 * Trimmed from a WoW: Forever beta (1.60.1) log with names anonymised: a low-level Paladin in Elwynn Forest among
 * other players. The header says ADVANCED_LOG_ENABLED,0 yet every line carries a 19-field advanced block, players'
 * level column holds item level, and damage lines end with ST/AOE.
 */
const text = readFileSync(join(__dirname, "../fixtures/logs/forever-1.60.1.txt"), "utf8");
const PALADIN = "Player-4620-0000A001";

describe("WoW: Forever beta combat log", () => {
  const scan = scanText(text, 2026);

  it("parses every line, detects Forever and finds the recording player", () => {
    expect(scan.header).toMatchObject({ version: 22, advanced: true, build: "1.60.1", projectId: 18 });
    expect(detectGameVersion(scan.header)).toEqual({ version: "forever", source: "header" });
    expect(scan.lines).toBeGreaterThan(250);
    expect(scan.unparsed).toBe(0);
    const me = scan.players.find((p) => p.isLogger)!;
    expect(me).toMatchObject({ guid: PALADIN, name: "Paladin", level: null });
  });

  it("builds valid Forever reports with the damage the log records", () => {
    const player = scan.players.find((p) => p.isLogger)!;
    const model = detectModel(player.spells);
    const reports = analyzeText(text, player.guid, model?.id ?? null, player.name);
    expect(reports.map((r) => [r.fight.label, r.totals.damage])).toEqual([
      ["Mangy Wolf", 127],
      ["Forest Spider +1", 246],
      ["Murloc +1", 275],
      ["Murloc", 150],
    ]);
    for (const r of reports) {
      expect(r.gameVersion).toBe("forever");
      expect(r.log.advanced).toBe(true);
      expect(r.player.level).toBeNull();
      expect(r.totals.dps).toBeGreaterThan(5);
      expect(r.totals.dps).toBeLessThan(40);
      expect(r.notes.join(" ")).not.toMatch(/El registro de combate avanzado estaba desactivado/);
      expect(() => fightReportSchema.parse(r)).not.toThrow();
    }
  });

  it("offers both recorders when a second character logged into the same file", () => {
    const both = text + readFileSync(join(__dirname, "../fixtures/logs/forever-1.60.1-relog.txt"), "utf8");
    const loggers = scanText(both, 2026).players.filter((p) => p.isLogger);
    expect(loggers.map((p) => p.name).sort()).toEqual(["Paladin", "Warrior"]);
    const warrior = loggers.find((p) => p.name === "Warrior")!;
    const reports = analyzeText(both, warrior.guid, "warrior-protection", warrior.name);
    expect(reports.map((r) => [r.fight.label, r.totals.damage, r.gameVersion])).toEqual([["Prairie Stalker", 246, "forever"]]);
    for (const r of reports) expect(() => fightReportSchema.parse(r)).not.toThrow();
  });
});
