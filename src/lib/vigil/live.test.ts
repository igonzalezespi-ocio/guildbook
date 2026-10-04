import { describe, expect, it } from "vitest";
import { PALADIN, paladinLog, WARRIOR, warriorLog } from "../../../tests/support/combatlog";
import { splitLines } from "@/lib/combatlog/lines";
import { analyzeText } from "./analyze";
import { LiveSession, type Callout, type CompletedFight } from "./live";
import { fightReportSchema } from "./report";

/** Feeds a log line by line, ticking on log time as a tailer would, and collects everything the session emits. */
function stream(text: string, session = new LiveSession({ fallbackYear: 2026 })) {
  const completed: CompletedFight[] = [];
  const callouts: Callout[] = [];
  for (const line of splitLines(text)) {
    session.pushLine(line);
    if (session.lastEventT !== null) {
      session.tick(session.lastEventT);
      session.current(session.lastEventT);
    }
    completed.push(...session.drainCompleted());
    callouts.push(...session.drainCallouts());
  }
  session.finish();
  completed.push(...session.drainCompleted());
  callouts.push(...session.drainCallouts());
  return { session, completed, callouts };
}

describe("LiveSession", () => {
  it("finds the recorder and the model on its own and yields the same fights as the batch upload", () => {
    const { session, completed } = stream(warriorLog());
    expect(session.player).toMatchObject({ guid: WARRIOR.guid, name: "Rhune", level: 30 });
    expect(session.model?.id).toBe("warrior-protection");

    const batch = analyzeText(warriorLog(), WARRIOR.guid, "warrior-protection", "Rhune");
    expect(completed.map((c) => c.report.fight)).toEqual(batch.map((r) => r.fight));
    expect(completed.map((c) => c.report.totals)).toEqual(batch.map((r) => r.totals));
    for (const c of completed) expect(() => fightReportSchema.parse(c.report)).not.toThrow();
  });

  it("reports the fight in progress with a running score, GCD usage, idle time and live uptimes", () => {
    const session = new LiveSession({ fallbackYear: 2026 });
    const lines = [...splitLines(warriorLog())];
    let now = 0;
    let fightStart: number | null = null;
    for (const line of lines) {
      session.pushLine(line);
      now = session.lastEventT ?? 0;
      fightStart ??= session.current(now)?.startT ?? null;
      if (fightStart !== null && now - fightStart >= 10_000) break;
    }
    const live = session.current(now + 500)!;
    expect(live).toMatchObject({ label: "Defias Pillager", kind: "trash", metric: "threat" });
    expect(live.elapsedMs).toBeGreaterThanOrEqual(10_000);
    expect(live.score).toBeGreaterThan(0);
    expect(live.gcdUsage).toBeGreaterThan(0.3);
    expect(live.idleNowMs).toBeGreaterThanOrEqual(0);
    expect(live.perSecond).toBeGreaterThan(0);
    const keys = live.uptimes.map((u) => u.key);
    expect(keys).toEqual(expect.arrayContaining(["shield-block", "sunder"]));
    expect(live.uptimes.find((u) => u.key === "sunder")!.active).toBe(true);
  });

  it("closes a fight on a quiet tick without waiting for the next event", () => {
    const session = new LiveSession({ fallbackYear: 2026 });
    const lines = [...splitLines(warriorLog())];
    const bossStart = lines.findIndex((l) => l.includes("ENCOUNTER_START"));
    session.pushLines(lines.slice(0, bossStart));
    expect(session.drainCompleted()).toEqual([]);
    session.tick(session.lastEventT! + 7000);
    expect(session.drainCompleted().map((c) => c.report.fight.label)).toEqual(["Defias Pillager"]);
    expect(session.current(session.lastEventT! + 7000)).toBeNull();
  });

  it("calls out a wasted Revenge window and rotation misses as they settle", () => {
    const { callouts, completed } = stream(warriorLog());
    const revenge = callouts.filter((c) => c.kind === "proc");
    expect(revenge.some((c) => /^Revenge estuvo disponible durante \d+,\d s y no se usó$/.test(c.text))).toBe(true);
    expect(new Set(callouts.map((c) => `${c.fightStartT}:${c.id}`)).size).toBe(callouts.length);
    expect(completed[0]!.callouts.length).toBeGreaterThan(0);
  });

  it("calls out time without a seal and idle time while Judgement was ready", () => {
    const { callouts, session } = stream(paladinLog());
    expect(session.model?.id).toBe("paladin-leveling");
    expect(callouts.map((c) => c.text)).toContain("Sin sello durante 5 s");
    expect(callouts.some((c) => /^Inactivo durante \d+,\d s con Judgement listo$/.test(c.text))).toBe(true);
  });

  it("honours an explicit player and model and starts over on a new file", () => {
    const session = new LiveSession({ fallbackYear: 2026, playerGuid: PALADIN.guid, modelId: "paladin-leveling" });
    session.pushLines(splitLines(paladinLog()));
    session.newFile();
    expect(session.drainCompleted().map((c) => c.report.fight.label)).toEqual(["Rockhide Boar", "Young Wolf"]);
    expect(session.header.version).toBeNull();
    session.pushLines(splitLines(paladinLog()));
    session.finish();
    expect(session.drainCompleted()).toHaveLength(2);
  });
});
