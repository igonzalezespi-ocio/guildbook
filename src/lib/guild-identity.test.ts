import { describe, expect, it } from "vitest";
import { cleanGuildName, describeIdentity, sameGuildName, unverifiedName } from "@/lib/guild-identity";
import { createGuildInput } from "@/lib/validation";
import { parseRealmType } from "@/server/blizzard/client";

describe("guild names", () => {
  it("cleans whitespace and typographic apostrophes", () => {
    expect(cleanGuildName("  Knights \u2019 of   Dawn ")).toBe("Knights ' of Dawn");
    expect(cleanGuildName("Ｏｒｄｅｒ")).toBe("Order");
  });

  it("compares case-insensitively after cleaning", () => {
    expect(sameGuildName("The Silver Hand", "the  silver HAND")).toBe(true);
    expect(sameGuildName("Kel\u2019Thuzad Fans", "kel'thuzad fans")).toBe(true);
    expect(sameGuildName("Silver Hand", "Silver Hands")).toBe(false);
  });

  it("names unverified guilds that lost their name", () => {
    expect(unverifiedName("Dawn", 1)).toBe("Dawn (sin verificar)");
    expect(unverifiedName("Dawn", 3)).toBe("Dawn (sin verificar 3)");
  });

  it("describes an identity", () => {
    expect(describeIdentity({ region: "eu", faction: "horde", ruleset: "rp" })).toBe("Europa, Horda, Rol");
    expect(describeIdentity({ gameVersion: "forever", realmSlug: null, region: "us", faction: "horde", ruleset: "pvp" })).toBe(
      "América, Horda, JcJ",
    );
    expect(describeIdentity({ gameVersion: "anniversary", realmSlug: "dreamscythe", region: "us", faction: "horde", ruleset: "normal" })).toBe(
      "TBC Anniversary, Dreamscythe (US), Horda",
    );
  });
});

describe("guild creation input per game version", () => {
  const base = { name: "Mirkwood", slug: "mirkwood", timezone: "America/New_York", region: "us", faction: "horde" };

  it("defaults to WoW: Forever, which needs a ruleset and has no realm", () => {
    expect(createGuildInput.parse({ ...base, ruleset: "pvp" })).toMatchObject({ gameVersion: "forever", ruleset: "pvp", realmSlug: null });
    expect(createGuildInput.parse({ ...base, gameVersion: "forever", ruleset: "rp", realmSlug: "dreamscythe" })).toMatchObject({
      realmSlug: null,
    });
    expect(createGuildInput.safeParse({ ...base, gameVersion: "forever" }).success).toBe(false);
  });

  it("takes an Anniversary guild's ruleset from its realm, which must be in its region", () => {
    expect(createGuildInput.parse({ ...base, gameVersion: "anniversary", realmSlug: "Nightslayer", ruleset: "rp" })).toMatchObject({
      gameVersion: "anniversary",
      realmSlug: "nightslayer",
      ruleset: "pvp",
    });
    const noRealm = createGuildInput.safeParse({ ...base, gameVersion: "anniversary" });
    expect(noRealm.success).toBe(false);
    expect(noRealm.error?.issues[0]?.path).toEqual(["realmSlug"]);
    const wrongRegion = createGuildInput.safeParse({ ...base, gameVersion: "anniversary", realmSlug: "thunderstrike" });
    expect(wrongRegion.error?.issues[0]).toMatchObject({ path: ["realmSlug"], message: expect.stringContaining("otra región") });
    expect(createGuildInput.safeParse({ ...base, gameVersion: "anniversary", realmSlug: "doomhowl" }).success).toBe(false);
  });

  it("rejects versions that can't be chosen yet", () => {
    const era = createGuildInput.safeParse({ ...base, gameVersion: "era", realmSlug: "whitemane", ruleset: "pvp" });
    expect(era.success).toBe(false);
    expect(era.error?.issues[0]?.path).toEqual(["gameVersion"]);
  });
});

describe("guild creation input", () => {
  const base = { name: "Dawn", slug: "dawn", timezone: "America/New_York", region: "us" };

  it("requires a supported region", () => {
    const { region: _region, ...noRegion } = base;
    expect(createGuildInput.safeParse({ ...noRegion, faction: "horde", ruleset: "normal" }).success).toBe(false);
    expect(createGuildInput.safeParse({ ...base, region: "kr", faction: "horde", ruleset: "normal" }).success).toBe(false);
    expect(createGuildInput.parse({ ...base, region: "eu", faction: "horde", ruleset: "normal" }).region).toBe("eu");
  });

  it("requires one faction and a ruleset", () => {
    expect(createGuildInput.safeParse({ ...base, ruleset: "normal" }).success).toBe(false);
    expect(createGuildInput.safeParse({ ...base, faction: "both", ruleset: "normal" }).success).toBe(false);
    expect(createGuildInput.safeParse({ ...base, faction: "horde" }).success).toBe(false);
    expect(createGuildInput.parse({ ...base, name: " Dawn  Watch ", faction: "horde", ruleset: "pvp" })).toMatchObject({
      name: "Dawn Watch",
      faction: "horde",
      ruleset: "pvp",
    });
  });
});

describe("realm type to ruleset", () => {
  it.each([
    [{ type: { type: "NORMAL" } }, "normal"],
    [{ type: { type: "PVP" } }, "pvp"],
    [{ type: { type: "RP" } }, "rp"],
    [{ type: { type: "NORMAL" }, category: "Hardcore" }, "hardcore"],
    [{ type: { type: "RPPVP" } }, null],
    [{}, null],
  ])("maps %j to %s", (json, ruleset) => {
    expect(parseRealmType(json).ruleset).toBe(ruleset);
  });
});
