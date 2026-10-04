import { describe, expect, it } from "vitest";
import {
  findRealm,
  hasSurnames,
  isSupportedVersion,
  maxLevelFor,
  maxProfessionSkillFor,
  realmLabel,
  realmsFor,
  versionHasLaunched,
  versionLaunchLabel,
} from "@/lib/game-versions";

describe("game versions", () => {
  it("supports WoW: Forever and TBC Anniversary, and reserves the rest", () => {
    expect(isSupportedVersion("forever")).toBe(true);
    expect(isSupportedVersion("anniversary")).toBe(true);
    expect(isSupportedVersion("era")).toBe(false);
    expect(isSupportedVersion("retail")).toBe(false);
  });

  it("takes level and profession caps from the expansion", () => {
    expect([maxLevelFor("forever"), maxProfessionSkillFor("forever")]).toEqual([60, 300]);
    expect([maxLevelFor("anniversary"), maxProfessionSkillFor("anniversary")]).toEqual([70, 375]);
  });

  it("gives only WoW: Forever characters surnames", () => {
    expect(hasSurnames("forever")).toBe(true);
    expect(hasSurnames("anniversary")).toBe(false);
  });

  it("treats versions without a launch date as live", () => {
    const before = new Date("2026-11-03T23:59:00Z");
    const after = new Date("2026-11-04T00:00:00Z");
    expect(versionHasLaunched("forever", before)).toBe(false);
    expect(versionHasLaunched("forever", after)).toBe(true);
    expect(versionHasLaunched("anniversary", before)).toBe(true);
    expect(versionLaunchLabel("forever")).toBe("4 nov");
    expect(versionLaunchLabel("anniversary")).toBeNull();
  });

  it("lists Anniversary realms per region, without Hardcore realms", () => {
    expect(realmsFor("anniversary", "us").map((r) => r.slug)).toEqual(["dreamscythe", "nightslayer", "maladath"]);
    expect(realmsFor("anniversary", "eu").map((r) => r.slug)).toEqual(["thunderstrike", "spineshatter"]);
    expect(realmsFor("anniversary").some((r) => r.ruleset === "hardcore")).toBe(false);
    expect(realmsFor("forever")).toEqual([]);
    expect(findRealm("anniversary", "nightslayer")).toMatchObject({ region: "us", ruleset: "pvp" });
    expect(findRealm("forever", "dreamscythe")).toBeNull();
    expect(realmLabel("anniversary", "dreamscythe")).toBe("Dreamscythe (US)");
    expect(realmLabel("anniversary", "gone-realm", "eu")).toBe("gone-realm (EU)");
  });
});
