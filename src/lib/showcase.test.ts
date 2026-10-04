import { describe, expect, it } from "vitest";
import { currentTier, hasLaunched, launchLabel, nextScheduleSlot } from "./showcase";

const slots = [
  { id: "sun", dayOfWeek: 0, startTime: "19:00" },
  { id: "tue", dayOfWeek: 2, startTime: "20:00" },
  { id: "thu", dayOfWeek: 4, startTime: "20:00" },
];
const NY = "America/New_York";

describe("nextScheduleSlot", () => {
  it("picks the next slot in the guild's time zone", () => {
    // Monday Sep 28, 2026, 9:27 AM Pacific is 12:27 PM Eastern.
    expect(nextScheduleSlot(slots, NY, new Date("2026-09-28T16:27:00Z"))?.id).toBe("tue");
  });

  it("uses the guild's zone, not UTC, to decide the day", () => {
    // Tuesday 01:00 UTC is still Monday 9 PM in New York.
    expect(nextScheduleSlot(slots, NY, new Date("2026-09-29T01:00:00Z"))?.id).toBe("tue");
  });

  it("moves on once a slot has started and wraps round the week", () => {
    expect(nextScheduleSlot(slots, NY, new Date("2026-09-30T00:00:00Z"))?.id).toBe("thu"); // Tue 8:00 PM EDT
    expect(nextScheduleSlot(slots, NY, new Date("2026-10-03T16:00:00Z"))?.id).toBe("sun"); // Saturday
  });

  it("returns null with no schedule", () => {
    expect(nextScheduleSlot([], NY, new Date())).toBeNull();
  });
});

describe("currentTier", () => {
  const boss = (...dates: string[]) => ({ kills: dates.map((d) => ({ killedAt: new Date(d) })) });
  const progression = [
    { name: "Molten Core", bosses: [boss("2026-12-08T20:00:00Z"), boss("2026-12-10T20:00:00Z"), boss()] },
    { name: "Onyxia's Lair", bosses: [boss("2026-12-08T19:00:00Z")] },
    { name: "Empty", bosses: [] },
  ];

  it("shows the first raid not yet cleared, counting only kills that have happened", () => {
    expect(currentTier(progression, new Date("2026-09-28T00:00:00Z"))).toEqual({ name: "Molten Core", killed: 0, total: 3 });
    expect(currentTier(progression, new Date("2026-12-09T00:00:00Z"))).toEqual({ name: "Molten Core", killed: 1, total: 3 });
  });

  it("falls back to the last raid once everything is cleared, and null with none", () => {
    const cleared = [{ name: "Molten Core", bosses: [boss("2026-12-08T20:00:00Z")] }, ...progression.slice(1)];
    expect(currentTier(cleared, new Date("2027-01-01T00:00:00Z"))).toEqual({ name: "Onyxia's Lair", killed: 1, total: 1 });
    expect(currentTier([], new Date())).toBeNull();
  });
});

describe("launch", () => {
  it("knows when WoW: Forever opens", () => {
    expect(hasLaunched(new Date("2026-09-28T00:00:00Z"))).toBe(false);
    expect(hasLaunched(new Date("2026-11-04T12:00:00Z"))).toBe(true);
    expect(launchLabel()).toBe("4 nov");
  });
});
