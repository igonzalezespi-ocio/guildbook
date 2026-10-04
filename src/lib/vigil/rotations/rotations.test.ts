import { describe, expect, it } from "vitest";
import { LogBuilder, mobUnit, PALADIN, paladinLog, playerUnit, WARRIOR, warriorLog } from "../../../../tests/support/combatlog";
import { analyzeText, scanText } from "../analyze";
import { fightReportSchema, MAX_REPORT_BYTES } from "../report";
import { detectModel, getModel } from ".";
import { levelValue, observedGcd } from "./engine";

describe("model registry", () => {
  it("detects models from the spells a player cast", () => {
    expect(detectModel(scanText(paladinLog()).players[0]!.spells)?.id).toBe("paladin-leveling");
    expect(detectModel(scanText(warriorLog()).players[0]!.spells)?.id).toBe("warrior-protection");
    expect(detectModel(["Fireball", "Frostbolt"])).toBeNull();
    expect(detectModel(["Sunder Armor"], "paladin")).toBeNull();
    expect(getModel("nope")).toBeNull();
  });

  it("looks up values by level and infers the GCD", () => {
    expect(levelValue([[10, 100], [22, 140]], 8)).toBe(100);
    expect(levelValue([[10, 100], [22, 140]], 30)).toBe(140);
    expect(levelValue([[10, 100], [22, 140]], null)).toBe(140);
    const casts = [0, 1500, 3000, 4500, 6000].map((t) => ({ t, gcd: true }));
    expect(observedGcd(casts)).toBe(1500);
    expect(observedGcd([{ t: 0, gcd: true }])).toBe(1500);
  });
});

describe("paladin levelling model", () => {
  const [boar, wolf] = analyzeText(paladinLog(), PALADIN.guid, "paladin-leveling", "Tor");

  it("produces reports that pass the upload schema and size cap", () => {
    for (const r of [boar!, wolf!]) {
      expect(() => fightReportSchema.parse(r)).not.toThrow();
      expect(JSON.stringify(r).length).toBeLessThan(MAX_REPORT_BYTES);
    }
  });

  it("credits a seal that was up before the pull and reads that Judgement keeps it", () => {
    expect(boar!.uptimes.find((u) => u.key === "seal-of-righteousness")?.pct).toBe(1);
    expect(boar!.extras.seal).toMatchObject({ judgements: 3, consumesSeal: false, timeWithoutSealMs: 0 });
  });

  it("finds the lull where Judgement was ready and the lost auto-attacks", () => {
    expect(boar!.swings).toMatchObject({ medianIntervalMs: 2800, lostSwings: 3 });
    expect(boar!.activity.readyIdleMs).toBeGreaterThan(1000);
    expect(boar!.adherence).toMatchObject({ pct: 1, decisions: 5 });
    expect(boar!.estimate!.gains.map((g) => g.label)).toContain("Continuidad del ataque automático");
    expect(boar!.estimate!.estimated).toBeGreaterThan(boar!.estimate!.actual);
  });

  it("counts time without a seal and the unused Holy Strike", () => {
    expect(wolf!.extras.seal!.timeWithoutSealMs).toBe(5000);
    expect(wolf!.uptimes.find((u) => u.key === "seal-of-righteousness")!.pct).toBeCloseTo(11.8 / 16.8, 2);
    expect(wolf!.cooldowns.find((c) => c.key === "holy-strike")).toMatchObject({ casts: 0 });
    expect(wolf!.estimate!.simCasts.find((c) => c.label === "Holy Strike")).toMatchObject({ actual: 0, simulated: 2 });
  });

  it("detects when Judgement consumes the seal (Classic behaviour)", () => {
    const me = playerUnit("Tor");
    const mob = mobUnit("Kobold Vermin", 6, 1);
    const b = new LogBuilder();
    b.level = 8;
    b.cast(0, me, null, 21084, "Seal of Righteousness");
    b.aura(0, "APPLIED", me, me, 21084, "Seal of Righteousness");
    for (let t = 500; t < 20_000; t += 2800) b.swing(t, me, mob, 15);
    b.cast(2000, me, mob, 20271, "Judgement");
    b.aura(2005, "REMOVED", me, me, 21084, "Seal of Righteousness");
    b.damage(2010, me, mob, 20187, "Judgement of Righteousness", 30);
    b.cast(3500, me, null, 21084, "Seal of Righteousness");
    b.aura(3500, "APPLIED", me, me, 21084, "Seal of Righteousness");
    const [r] = analyzeText(b.text(), me.guid, "paladin-leveling", "Tor");
    expect(r!.extras.seal!.consumesSeal).toBe(true);
    expect(r!.adherence!.pct).toBe(1);
  });
});

describe("protection warrior model", () => {
  const [trash, boss] = analyzeText(warriorLog(), WARRIOR.guid, "warrior-protection", "Rhune");

  it("produces reports that pass the upload schema", () => {
    for (const r of [trash!, boss!]) expect(() => fightReportSchema.parse(r)).not.toThrow();
  });

  it("estimates threat with stance and ability bonuses", () => {
    const sunder = trash!.spells.find((s) => s.name === "Sunder Armor")!;
    // Level 30: 140 bonus threat per Sunder, x1.3 in Defensive Stance.
    expect(sunder.threat).toBe(Math.round(sunder.casts * 140 * 1.3));
    const bloodrage = trash!.spells.find((s) => s.name === "Bloodrage")!;
    expect(bloodrage.threat).toBe(50);
    expect(trash!.totals.tps).toBeGreaterThan(0);
    expect(trash!.model?.metric).toBe("threat");
  });

  it("scores Revenge usage against the most it could have been used", () => {
    const revenge = trash!.procs.find((p) => p.key === "revenge")!;
    expect(revenge.used).toBeLessThan(revenge.usable);
    expect(boss!.procs.find((p) => p.key === "revenge")!.used).toBeGreaterThan(0);
  });

  it("tracks Sunder and Shield Block uptime, rage and Heroic Strike on high rage", () => {
    expect(trash!.uptimes.find((u) => u.key === "sunder")!.pct).toBeGreaterThan(0.9);
    expect(trash!.uptimes.find((u) => u.key === "shield-block")!.pct).toBeGreaterThan(0.4);
    expect(trash!.resource).toMatchObject({ name: "Rage", max: 100 });
    expect(boss!.extras.rageDump).toMatchObject({ threshold: 60 });
    expect(boss!.extras.rageDump!.opportunities).toBeGreaterThan(0);
  });

  it("labels the replay as an estimate and never goes below actual", () => {
    for (const r of [trash!, boss!]) {
      expect(r.estimate!.estimated).toBeGreaterThanOrEqual(r.estimate!.actual);
      expect(r.estimate!.assumptions[0]).toMatch(/^Estimate/);
      expect(r.score.overall).toBeGreaterThan(0);
      expect(r.score.overall).toBeLessThanOrEqual(100);
    }
  });
});

describe("generic report", () => {
  it("works for any class without a model", () => {
    const me = playerUnit("Mage");
    const mob = mobUnit("Kobold Vermin", 6, 1);
    const b = new LogBuilder();
    for (let t = 0; t < 9000; t += 1500) {
      b.cast(t, me, mob, 133, "Fireball");
      b.damage(t + 100, me, mob, 133, "Fireball", 40);
    }
    const [r] = analyzeText(b.text(), me.guid, null, "Mage");
    expect(r!.model).toBeNull();
    expect(r!.adherence).toBeNull();
    expect(r!.estimate).toBeNull();
    expect(r!.totals.damage).toBe(240);
    expect(r!.score.parts.map((p) => p.label)).toEqual(["Uso del GCD"]);
    expect(() => fightReportSchema.parse(r)).not.toThrow();
  });
});
