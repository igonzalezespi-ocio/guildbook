import { describe, expect, it } from "vitest";
import { buildRoster, canPlayRole, type GroupRole } from "./groups";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 4, 20, minute));
const signup = (name: string, role: GroupRole, minute: number, bench = false) => ({ name, role, bench, queuedAt: at(minute) });
const names = (list: { name: string }[]) => list.map((s) => s.name);

describe("buildRoster", () => {
  it("fills each role in sign-up order and benches the rest", () => {
    const roster = buildRoster([signup("b", "tank", 2), signup("a", "tank", 1), signup("c", "dps", 3)], { tank: 1, healer: 1, dps: 3 });
    expect(names(roster.confirmed.tank)).toEqual(["a"]);
    expect(names(roster.confirmed.dps)).toEqual(["c"]);
    expect(names(roster.reserves)).toEqual(["b"]);
  });

  it("keeps chosen benches out and moves the next one up when someone leaves", () => {
    const all = [signup("a", "tank", 1, true), signup("b", "tank", 2), signup("c", "tank", 3)];
    expect(names(buildRoster(all, { tank: 1, healer: 0, dps: 0 }).confirmed.tank)).toEqual(["b"]);
    expect(names(buildRoster([all[0]!, all[2]!], { tank: 1, healer: 0, dps: 0 }).confirmed.tank)).toEqual(["c"]);
  });
});

describe("canPlayRole", () => {
  it("follows the classes of WoW: Forever", () => {
    expect(canPlayRole("druid", "tank")).toBe(true);
    expect(canPlayRole("rogue", "healer")).toBe(false);
    expect(canPlayRole("paladin", "tank")).toBe(true);
    expect(canPlayRole("mage", "tank")).toBe(false);
  });
});
