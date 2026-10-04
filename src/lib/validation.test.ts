import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applicationInputFor,
  bossKillInput,
  bossKillInputFor,
  characterInputFor,
  guildSettingsInput,
  lootAwardInputFor,
  resolveGuildWorld,
} from "@/lib/validation";

const base = { name: "Order", timezone: "America/New_York", region: "us", faction: "alliance", ruleset: "normal" };

describe("guild settings Discord invite", () => {
  it.each(["https://discord.gg/abc123", "https://discord.com/invite/abc123", "https://www.discord.com/invite/abc"])(
    "accepts %s",
    (url) => {
      expect(guildSettingsInput.parse({ ...base, discordInviteUrl: url }).discordInviteUrl).toBe(url);
    },
  );

  it("treats an empty value as no invite", () => {
    expect(guildSettingsInput.parse({ ...base, discordInviteUrl: "" }).discordInviteUrl).toBeNull();
  });

  it.each(["http://discord.gg/abc", "https://discord.com/channels/1/2", "https://evil.example/discord.gg"])(
    "rejects %s",
    (url) => {
      expect(guildSettingsInput.safeParse({ ...base, discordInviteUrl: url }).success).toBe(false);
    },
  );
});

describe("boss kill date", () => {
  const kill = (killedOn: string) => bossKillInput.safeParse({ bossId: crypto.randomUUID(), killedOn });
  const message = (killedOn: string) => kill(killedOn).error?.issues[0]?.message;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-15T03:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it.each(["2026-11-04", "2027-01-14"])("accepts %s", (killedOn) => {
    expect(kill(killedOn).success).toBe(true);
  });

  it("accepts today's date in the furthest-ahead time zone", () => {
    expect(kill("2027-01-15").success).toBe(true);
  });

  it.each(["2026-11-03", "2004-11-23"])("rejects %s as before launch", (killedOn) => {
    expect(message(killedOn)).toBe("Una muerte de jefe no puede tener fecha anterior al lanzamiento de World of Warcraft: Forever, el 4 de noviembre de 2026");
  });

  it("rejects a date in the future", () => {
    expect(message("2027-01-16")).toBe("Una muerte de jefe no puede tener fecha futura");
  });
});

describe("dates in a game without a launch date", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("accepts TBC Anniversary kills and loot before WoW: Forever launches", () => {
    expect(bossKillInputFor("anniversary").safeParse({ bossId: crypto.randomUUID(), killedOn: "2026-09-01" }).success).toBe(true);
    expect(bossKillInputFor("forever").safeParse({ bossId: crypto.randomUUID(), killedOn: "2026-09-01" }).success).toBe(false);
    const award = { item: "Warglaive of Azzinoth", characterId: crypto.randomUUID(), response: "main_spec", awardedOn: "2026-09-01" };
    expect(lootAwardInputFor("anniversary").safeParse(award).error?.issues.some((i) => i.path[0] === "awardedOn")).not.toBe(true);
    expect(lootAwardInputFor("forever").safeParse(award).error?.issues.some((i) => i.path[0] === "awardedOn")).toBe(true);
  });
});

describe("characters per game version", () => {
  const character = { name: "Gorza", wowClass: "shaman", spec: "Enhancement", role: "melee", professions: [] };

  it("caps levels and profession skill by expansion", () => {
    expect(characterInputFor("forever").safeParse({ ...character, surname: "Stone", level: 70 }).success).toBe(false);
    expect(characterInputFor("anniversary").safeParse({ ...character, level: 70 }).success).toBe(true);
    expect(characterInputFor("anniversary").safeParse({ ...character, level: 71 }).success).toBe(false);
    const skill = (version: "forever" | "anniversary", n: number) =>
      characterInputFor(version).safeParse({ ...character, surname: "Stone", level: 60, professions: [{ profession: "mining", skill: n }] }).success;
    expect(skill("forever", 375)).toBe(false);
    expect(skill("anniversary", 375)).toBe(true);
  });

  it("requires surnames only in WoW: Forever and stores none elsewhere", () => {
    expect(characterInputFor("forever").safeParse({ ...character, level: 60 }).success).toBe(false);
    expect(characterInputFor("anniversary").parse({ ...character, surname: "Stone", level: 70 }).surname).toBe("");
    const application = {
      characterName: "Gorza",
      wowClass: "shaman",
      spec: "Enhancement",
      role: "melee",
      level: 70,
      raidExperience: "Karazhan",
      availability: "Tue",
      whyThisGuild: "Friends",
      discordHandle: "gorza",
      respectsFaith: "on",
    };
    expect(applicationInputFor({ preset: "standard", gameVersion: "anniversary" }).parse(application).characterSurname).toBe("");
    expect(applicationInputFor({ preset: "standard", gameVersion: "forever" }).safeParse(application).success).toBe(false);
  });
});

describe("where a guild lives in its version", () => {
  it("needs a ruleset for WoW: Forever and a realm in the region for Anniversary", () => {
    expect(resolveGuildWorld("forever", { region: "us", ruleset: "pvp", realmSlug: "dreamscythe" })).toEqual({ ok: true, realmSlug: null, ruleset: "pvp" });
    expect(resolveGuildWorld("forever", { region: "us" })).toMatchObject({ ok: false, field: "ruleset" });
    expect(resolveGuildWorld("anniversary", { region: "eu", realmSlug: "spineshatter" })).toEqual({ ok: true, realmSlug: "spineshatter", ruleset: "pvp" });
    expect(resolveGuildWorld("anniversary", { region: "us", realmSlug: "spineshatter" })).toMatchObject({ ok: false, field: "realmSlug" });
    expect(resolveGuildWorld("anniversary", { region: "us", ruleset: "rp" })).toMatchObject({ ok: false, field: "realmSlug" });
  });
});
