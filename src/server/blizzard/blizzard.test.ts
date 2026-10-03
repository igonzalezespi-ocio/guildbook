import { describe, expect, it } from "vitest";
import { BlizzardClient, describeScanForLog, type FetchLike, parseAccountCharacters, parseGuildCrest } from "./client";
import anniversaryAccount from "./fixtures/profile-user-wow.classicann.json";
import { blizzardConfigFromEnv, configuredRealmRuleset, namespaceFor, namespaceTemplate, realmSlugsFor } from "./config";
import { decryptToken, encryptToken, tokenKeyFromEnv } from "./crypto";
import { charactersForGuild } from "./filter";
import { createMockFetch } from "./mock";

const config = { ...blizzardConfigFromEnv({}), clientId: "id", clientSecret: "secret" };
/** The same client config reading only US profiles, for tests about one region's namespaces. */
const usConfig = { ...config, regions: ["us" as const] };

function fetchReturning(status: number, body: unknown = {}): FetchLike {
  return async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("blizzardConfigFromEnv", () => {
  it("defaults to the Classic Era profile namespace template, both regions and US as the default region", () => {
    expect(blizzardConfigFromEnv({})).toMatchObject({
      region: "us",
      regions: ["us", "eu"],
      profileNamespace: "profile-classic1x-{region}",
      dynamicNamespace: "dynamic-classic1x-{region}",
      guildRegion: "us",
    });
    const eu = blizzardConfigFromEnv({ BATTLENET_REGION: "EU", BATTLENET_REGIONS: "eu, kr", BATTLENET_PROFILE_NAMESPACE: "profile-{region}" });
    expect(eu).toMatchObject({ region: "eu", regions: ["eu"], profileNamespace: "profile-{region}" });
  });

  it("accepts namespace templates, region-agnostic bases and pre-region concrete names", () => {
    expect(namespaceTemplate("profile-classic1x-{region}")).toBe("profile-classic1x-{region}");
    expect(namespaceTemplate("profile-classic1x")).toBe("profile-classic1x-{region}");
    expect(namespaceTemplate(" Profile-Classic1x-US ")).toBe("profile-classic1x-{region}");
    expect(namespaceTemplate("static-classic-eu")).toBe("static-classic-{region}");
    expect(namespaceTemplate("profile-us")).toBe("profile-{region}");
    expect(namespaceFor("profile-classic1x-{region}", "eu")).toBe("profile-classic1x-eu");
    // Existing US-only env values keep working and now cover Europe too.
    const legacy = blizzardConfigFromEnv({
      BATTLENET_PROFILE_NAMESPACE: "profile-classic1x-us",
      BATTLENET_STATIC_NAMESPACE: "static-classic-us",
      BATTLENET_DYNAMIC_NAMESPACE: "dynamic-classic1x-us",
    });
    expect(legacy).toMatchObject({
      profileNamespace: "profile-classic1x-{region}",
      staticNamespace: "static-classic-{region}",
      dynamicNamespace: "dynamic-classic1x-{region}",
    });
  });

  it("scans every Classic namespace and retail by default, always including the Forever namespace", () => {
    expect(blizzardConfigFromEnv({}).scanNamespaces).toEqual([
      "profile-classic1x-{region}",
      "profile-classicann-{region}",
      "profile-classic-{region}",
      "profile-{region}",
    ]);
    expect(
      blizzardConfigFromEnv({
        BATTLENET_PROFILE_NAMESPACE: "profile-classicforever-{region}",
        BATTLENET_SCAN_NAMESPACES: "profile-classicann-us",
      }).scanNamespaces,
    ).toEqual(["profile-classicforever-{region}", "profile-classicann-{region}"]);
  });

  it("parses realm filters, optionally per region, and refuses mock mode in production", () => {
    const config = blizzardConfigFromEnv({ BATTLENET_REALMS: " Crusaders-Reach, eu:hollowmere, kr:nope, us:silverpine ," });
    expect(config.realmSlugs).toEqual(["crusaders-reach", "eu:hollowmere", "us:silverpine"]);
    expect(realmSlugsFor(config, "us")).toEqual(["crusaders-reach", "silverpine"]);
    expect(realmSlugsFor(config, "eu")).toEqual(["crusaders-reach", "hollowmere"]);
    expect(() => blizzardConfigFromEnv({ BATTLENET_MOCK: "1", VERCEL_ENV: "production" })).toThrow(/production/);
    expect(() => blizzardConfigFromEnv({ BATTLENET_MOCK: "1", NODE_ENV: "production" })).toThrow(/production/);
  });

  it("parses realm rulesets for every region or one region", () => {
    const config = blizzardConfigFromEnv({ BATTLENET_REALM_RULESETS: "ashen:pvp, eu:ashen:rp, eu:frost:normal, xx:bad:pvp, odd:nope" });
    expect(config.realmRulesets).toEqual({ ashen: "pvp", "eu:ashen": "rp", "eu:frost": "normal" });
    expect(configuredRealmRuleset(config, "us", "Ashen")).toBe("pvp");
    expect(configuredRealmRuleset(config, "eu", "ashen")).toBe("rp");
    expect(configuredRealmRuleset(config, "us", "frost")).toBeUndefined();
  });
});

describe("BlizzardClient.getAccountCharacters", () => {
  it("parses the account list, dropping classes WoW: Forever doesn't have, and reads guilds from profiles", async () => {
    const client = new BlizzardClient({ ...config, mock: true }, createMockFetch());
    const { accessToken } = await client.exchangeCode("mock-someone", "http://localhost/cb");
    const result = await client.getAccountCharacters(accessToken);
    expect(result.status).toBe("ok");
    expect(result.characters.map((c) => `${c.name} ${c.region}`)).toEqual([
      "Aldric us",
      "Brenna us",
      "Corwin us",
      "Grukk us",
      "Elowen us",
      "Isolde eu",
    ]);
    expect(result.characters[0]).toMatchObject({
      level: 60,
      wowClass: "paladin",
      faction: "alliance",
      race: "Human",
      realmSlug: "crusaders-reach",
      realmName: "Crusader's Reach",
      guildName: "Order of Saint Michael",
      surname: null,
    });
  });

  it("reads the account list in the Forever namespace and every scan namespace, with the locale", async () => {
    const urls: string[] = [];
    const client = new BlizzardClient({ ...config, profileNamespace: "profile-classic-{region}" }, async (url) => {
      urls.push(url);
      return new Response("{}", { status: 404 });
    });
    await client.getAccountCharacters("token");
    expect(urls[0]).toBe("https://us.api.blizzard.com/profile/user/wow?namespace=profile-classic-us&locale=en_US");
    expect(urls.map((u) => `${new URL(u).host} ${new URL(u).searchParams.get("namespace")}`)).toEqual([
      "us.api.blizzard.com profile-classic-us",
      "us.api.blizzard.com profile-classicann-us",
      "us.api.blizzard.com profile-classic1x-us",
      "us.api.blizzard.com profile-us",
      "eu.api.blizzard.com profile-classic-eu",
      "eu.api.blizzard.com profile-classicann-eu",
      "eu.api.blizzard.com profile-classic1x-eu",
      "eu.api.blizzard.com profile-eu",
    ]);
  });

  it("keeps the characters of a region that answers when the other refuses or fails", async () => {
    const mock = createMockFetch();
    const failing = (status: number): FetchLike => async (url, init) =>
      new URL(url).host.startsWith("eu.") ? new Response("{}", { status }) : mock(url, init);
    for (const status of [403, 404, 503]) {
      const client = new BlizzardClient({ ...config, mock: true }, failing(status));
      const { accessToken } = await client.exchangeCode("mock-regions", "http://localhost/cb");
      const result = await client.getAccountCharacters(accessToken);
      expect(result.status).toBe("ok");
      expect(result.characters.map((c) => c.region)).toEqual(["us", "us", "us", "us", "us"]);
      expect(result.scan.namespaces.filter((n) => n.region === "eu").every((n) => n.httpStatus === status)).toBe(true);
    }

    // Europe answers, the Americas are down: the EU character still comes through, and profiles are read on the EU host.
    const urls: string[] = [];
    const usDown = new BlizzardClient({ ...config, mock: true }, async (url, init) => {
      urls.push(url);
      return new URL(url).host.startsWith("us.") ? new Response("{}", { status: 503 }) : mock(url, init);
    });
    const { accessToken } = await usDown.exchangeCode("mock-regions", "http://localhost/cb");
    const result = await usDown.getAccountCharacters(accessToken);
    expect(result).toMatchObject({ status: "ok", characters: [{ name: "Isolde", region: "eu", realmSlug: "hollowmere", ruleset: "normal" }] });
    expect(urls.some((u) => u.startsWith("https://eu.api.blizzard.com/profile/wow/character/hollowmere/isolde"))).toBe(true);
  });

  it("with no characters anywhere, reports an error when a region's Forever namespace failed", async () => {
    const client = new BlizzardClient(config, async (url) =>
      new Response("{}", { status: new URL(url).host.startsWith("eu.") && url.includes("profile-classic1x-eu") ? 503 : 404 }),
    );
    expect((await client.getAccountCharacters("token")).status).toBe("error");
  });

  it.each([
    [403, {}, "forbidden"],
    [401, {}, "forbidden"],
    [404, {}, "empty"],
    [200, { wow_accounts: [] }, "empty"],
    [200, {}, "empty"],
    [500, {}, "error"],
  ] as const)("maps HTTP %i %j to %s", async (status, body, expected) => {
    const client = new BlizzardClient(usConfig, fetchReturning(status, body));
    const result = await client.getAccountCharacters("token");
    expect(result).toMatchObject({ status: expected, characters: [], scan: { excluded: [] } });
    expect(result.scan.namespaces.every((n) => n.httpStatus === status)).toBe(true);
  });

  it("reports a network failure as an error, not a crash", async () => {
    const client = new BlizzardClient(config, async () => {
      throw new Error("offline");
    });
    expect((await client.getAccountCharacters("token")).status).toBe("error");
  });

  it("reads localized names and falls back to race for faction", () => {
    const [c] = parseAccountCharacters({
      wow_accounts: [
        {
          characters: [
            {
              id: 7,
              name: { en_US: "Elowen" },
              level: 12,
              realm: { slug: "silverpine", name: { en_US: "Silverpine" } },
              playable_class: { id: 8 },
              playable_race: { id: 7, name: { en_US: "Gnome" } },
            },
          ],
        },
      ],
    });
    expect(c).toMatchObject({ id: "7", name: "Elowen", realmName: "Silverpine", wowClass: "mage", faction: "alliance", race: "Gnome" });
  });
});

/** A fake Blizzard answering `/profile/user/wow` per namespace; anything unlisted is a 404. */
function fetchByNamespace(responses: Record<string, { status: number; body?: unknown }>): FetchLike {
  return async (url) => {
    const u = new URL(url);
    const r = u.pathname === "/profile/user/wow" ? responses[u.searchParams.get("namespace") ?? ""] : undefined;
    return new Response(JSON.stringify(r?.body ?? { code: 404 }), { status: r?.status ?? 404 });
  };
}

function account(characters: { id: number; name: string; realm: string; classId?: number; raceId?: number; faction?: string }[]) {
  return {
    wow_accounts: [
      {
        id: 1,
        characters: characters.map((c) => ({
          id: c.id,
          name: c.name,
          level: 20,
          realm: { slug: c.realm, name: c.realm },
          playable_class: { id: c.classId ?? 1 },
          playable_race: { id: c.raceId ?? 1 },
          faction: { type: c.faction ?? "ALLIANCE" },
        })),
      },
    ],
  };
}

describe("BlizzardClient.getAccountCharacters across game versions", () => {
  it("keeps TBC Anniversary characters on listed realms, tagged with their version", async () => {
    const client = new BlizzardClient(
      usConfig,
      fetchByNamespace({
        "profile-classic1x-us": { status: 404 },
        "profile-classicann-us": { status: 200, body: anniversaryAccount },
      }),
    );
    const result = await client.getAccountCharacters("token");
    expect(result.status).toBe("ok");
    expect(result.characters.map((c) => [c.name, c.gameVersion, c.faction, c.realmSlug])).toEqual([
      ["Elowen", "anniversary", "alliance", "dreamscythe"],
      ["Tamsin", "anniversary", "alliance", "dreamscythe"],
      ["Gorza", "anniversary", "horde", "nightslayer"],
    ]);
    expect(result.scan.foreverNamespace).toBe("profile-classic1x-us");
    expect(result.scan.namespaces).toEqual([
      { namespace: "profile-classic1x-us", region: "us", status: "empty", httpStatus: 404, characters: 0 },
      { namespace: "profile-classicann-us", region: "us", status: "ok", httpStatus: 200, characters: 3 },
      { namespace: "profile-classic-us", region: "us", status: "empty", httpStatus: 404, characters: 0 },
      { namespace: "profile-us", region: "us", status: "empty", httpStatus: 404, characters: 0 },
    ]);
    expect(result.scan.excluded).toEqual([]);
    expect(describeScanForLog(result.scan, result.characters)).toMatch(/forever=0 anniversary=3 excluded=0$/);
  });

  it("never treats Classic Era, Hardcore or Season of Discovery characters in the Forever namespace as Forever", async () => {
    const client = new BlizzardClient(
      config,
      fetchByNamespace({
        "profile-classic1x-us": {
          status: 200,
          body: account([
            { id: 1, name: "Eraone", realm: "whitemane" },
            { id: 2, name: "Hcone", realm: "skull-rock" },
            { id: 3, name: "Sodone", realm: "crusader-strike", raceId: 2, faction: "HORDE" },
            { id: 4, name: "Newone", realm: "brand-new-forever-realm" },
          ]),
        },
      }),
    );
    const result = await client.getAccountCharacters("token");
    expect(result.status).toBe("ok");
    expect(result.characters.map((c) => c.name)).toEqual(["Newone"]);
    expect(result.scan.excluded.map((g) => [g.version, g.faction, g.count])).toEqual([
      ["era", "alliance", 1],
      ["hardcore", "alliance", 1],
      ["seasonal", "horde", 1],
    ]);
  });

  it("with a Forever realm allowlist, takes exactly those realms, even known Classic ones (pre-launch testing)", async () => {
    const client = new BlizzardClient(
      { ...config, profileNamespace: "profile-classicann-{region}", realmSlugs: ["us:dreamscythe"] },
      fetchByNamespace({ "profile-classicann-us": { status: 200, body: anniversaryAccount } }),
    );
    const result = await client.getAccountCharacters("token");
    expect(result.characters.map((c) => [c.name, c.gameVersion ?? "forever"])).toEqual([
      ["Elowen", "forever"],
      ["Tamsin", "forever"],
      ["Gorza", "anniversary"],
    ]);
    expect(result.scan.excluded).toEqual([]);
  });

  it("classifies each character once: progression stays progression whether Forever reads classic1x or classic", async () => {
    const anniversary = account([1, 2, 3, 4, 5].map((id) => ({ id, name: `Ann${"abcde"[id - 1]}`, realm: id % 2 ? "dreamscythe" : "nightslayer" })));
    const progression = account([
      ...["Valandor", "Vaelidor", "Maniala", "Wurgen", "Pim", "Six", "Seven", "Eight"].map((name, i) => ({ id: 10 + i, name, realm: "atiesh" })),
      { id: 20, name: "Liontusk", realm: "bloodsail-buccaneers", raceId: 2, faction: "HORDE" },
    ]);
    const responses = {
      "profile-classic1x-us": { status: 404 },
      "profile-classicann-us": { status: 200, body: anniversary },
      "profile-classic-us": { status: 200, body: progression },
    };
    for (const profileNamespace of ["profile-classic1x-{region}", "profile-classic-{region}"]) {
      const result = await new BlizzardClient({ ...usConfig, profileNamespace }, fetchByNamespace(responses)).getAccountCharacters("token");
      expect(result.characters.map((c) => c.gameVersion)).toEqual(Array(5).fill("anniversary"));
      expect(result.scan.excluded.map((g) => [g.version, g.faction, g.count])).toEqual([
        ["progression", "alliance", 8],
        ["progression", "horde", 1],
      ]);
      expect(describeScanForLog(result.scan, result.characters)).toMatch(/forever=0 anniversary=5 excluded=9$/);
      const forForever = charactersForGuild(result.characters, { gameVersion: "forever", region: "us", faction: "alliance", realmSlugs: [] });
      expect(forForever).toEqual([]);
    }
  });

  it("counts retail characters, including classes Forever lacks, without importing them", async () => {
    const client = new BlizzardClient(
      config,
      fetchByNamespace({
        "profile-us": { status: 200, body: account([{ id: 9, name: "Deathy", realm: "area-52", classId: 6 }]) },
      }),
    );
    const result = await client.getAccountCharacters("token");
    expect(result.characters).toEqual([]);
    expect(result.scan.excluded).toMatchObject([{ version: "retail", faction: "alliance", count: 1 }]);
  });

  it("treats a 403 on the Forever namespace alone as an unserved namespace, not a refused grant", async () => {
    const client = new BlizzardClient(
      { ...config, profileNamespace: "profile-classicforever-{region}" },
      fetchByNamespace({ "profile-classicforever-us": { status: 403 }, "profile-classicforever-eu": { status: 403 } }),
    );
    expect((await client.getAccountCharacters("token")).status).toBe("empty");
  });

  it("reports an error only when the Forever namespace fails", async () => {
    const failsElsewhere = new BlizzardClient(config, fetchByNamespace({ "profile-us": { status: 503 } }));
    const elsewhere = await failsElsewhere.getAccountCharacters("token");
    expect(elsewhere.status).toBe("empty");
    expect(elsewhere.scan.namespaces.find((n) => n.namespace === "profile-us")).toMatchObject({ status: "error", httpStatus: 503 });

    const failsForever = new BlizzardClient(config, fetchByNamespace({ "profile-classic1x-us": { status: 503 } }));
    expect((await failsForever.getAccountCharacters("token")).status).toBe("error");
  });

  it("mock mode serves the fixtures in the Forever namespace and an Anniversary character", async () => {
    const client = new BlizzardClient({ ...config, mock: true }, createMockFetch("profile-classic1x-us"));
    const { accessToken } = await client.exchangeCode("mock-scan", "http://localhost/cb");
    const result = await client.getAccountCharacters(accessToken);
    expect(result.characters.map((c) => `${c.name} ${c.gameVersion ?? "forever"}`)).toEqual([
      "Aldric forever",
      "Brenna forever",
      "Corwin forever",
      "Grukk forever",
      "Elowen anniversary",
      "Isolde forever",
    ]);
    expect(result.scan.excluded).toEqual([]);
  });

  it("mock mode adds the Anniversary role characters a seed asks for", async () => {
    const client = new BlizzardClient({ ...config, mock: true }, createMockFetch("profile-classic1x-us"));
    for (const [seed, name, realmSlug] of [
      ["mock-u.ann-gm", "Thranduil", "dreamscythe"],
      ["mock-u.ann-member", "Mattaeis", "dreamscythe"],
      ["mock-u.ann-realm", "Galadhon", "nightslayer"],
    ] as const) {
      const { accessToken } = await client.exchangeCode(seed, "http://localhost/cb");
      const result = await client.getAccountCharacters(accessToken);
      const role = result.characters.find((c) => c.name === name);
      expect(role, seed).toMatchObject({ gameVersion: "anniversary", faction: "horde", realmSlug, guildName: "Mirkwood" });
    }
    const { accessToken } = await client.exchangeCode("mock-u2.ann-gm.ann-guild-x1", "http://localhost/cb");
    const tagged = (await client.getAccountCharacters(accessToken)).characters.find((c) => c.name === "Thranduil");
    expect(tagged?.guildName).toBe("Mirkwood x1");
    expect(await client.lookupGuildRoster("us", "dreamscythe", "mirkwood-x1", "anniversary")).toMatchObject({ status: "ok" });
  });
});

describe("charactersForGuild", () => {
  const chars = parseAccountCharacters({
    wow_accounts: [
      {
        characters: [
          { id: 1, name: "Aldric", level: 60, realm: { slug: "a" }, playable_class: { id: 2 }, playable_race: { id: 1 } },
          { id: 2, name: "Corwin", level: 27, realm: { slug: "b" }, playable_class: { id: 11 }, playable_race: { id: 4 } },
          { id: 3, name: "Grukk", level: 60, realm: { slug: "a" }, playable_class: { id: 1 }, playable_race: { id: 2 } },
        ],
      },
    ],
  });

  it("keeps only the guild's region, treating characters without one as US", () => {
    const tagged = chars.map((c) => (c.name === "Corwin" ? { ...c, region: "eu" as const } : c));
    expect(charactersForGuild(tagged, { region: "us", faction: "alliance", realmSlugs: [] }).map((c) => c.name)).toEqual(["Aldric"]);
    expect(charactersForGuild(tagged, { region: "eu", faction: "alliance", realmSlugs: [] }).map((c) => c.name)).toEqual(["Corwin"]);
  });

  it("keeps only the guild's faction", () => {
    expect(charactersForGuild(chars, { faction: "alliance", realmSlugs: [] }).map((c) => c.name)).toEqual(["Aldric", "Corwin"]);
    expect(charactersForGuild(chars, { faction: "horde", realmSlugs: [] }).map((c) => c.name)).toEqual(["Grukk"]);
  });

  it("keeps only the guild's ruleset when the realm's ruleset is known", () => {
    const tagged = chars.map((c) => ({ ...c, ruleset: c.realmSlug === "b" ? ("pvp" as const) : null }));
    expect(charactersForGuild(tagged, { faction: "alliance", ruleset: "normal", realmSlugs: [] }).map((c) => c.name)).toEqual(["Aldric"]);
    expect(charactersForGuild(tagged, { faction: "alliance", ruleset: "pvp", realmSlugs: [] }).map((c) => c.name)).toEqual(["Aldric", "Corwin"]);
  });

  it("applies the realm filter when configured", () => {
    expect(charactersForGuild(chars, { faction: "alliance", realmSlugs: ["a"] }).map((c) => c.name)).toEqual(["Aldric"]);
  });
});

describe("token encryption", () => {
  const key = Buffer.alloc(32, 3);

  it("round-trips and never stores the plaintext", () => {
    const enc = encryptToken("secret-token", key);
    expect(enc).not.toContain("secret-token");
    expect(decryptToken(enc, key)).toBe("secret-token");
    expect(encryptToken("secret-token", key)).not.toBe(enc);
  });

  it("rejects a tampered token or the wrong key", () => {
    const enc = encryptToken("secret-token", key);
    const parts = enc.split(".");
    parts[3] = Buffer.from("xxxxxxxxxxxx").toString("base64url");
    expect(() => decryptToken(parts.join("."), key)).toThrow();
    expect(() => decryptToken(enc, Buffer.alloc(32, 4))).toThrow();
  });

  it("requires a 32-byte key", () => {
    expect(() => tokenKeyFromEnv({})).toThrow(/not set/);
    expect(() => tokenKeyFromEnv({ BATTLENET_TOKEN_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
    expect(tokenKeyFromEnv({ BATTLENET_TOKEN_KEY: key.toString("base64") })).toEqual(key);
  });
});

describe("item lookups", () => {
  it("uses the configurable static namespace template", () => {
    expect(blizzardConfigFromEnv({}).staticNamespace).toBe("static-classic1x-{region}");
    expect(blizzardConfigFromEnv({ BATTLENET_STATIC_NAMESPACE: "static-{region}" }).staticNamespace).toBe("static-{region}");
  });

  it("reads an item and its icon, and reports missing items", async () => {
    const urls: string[] = [];
    const client = new BlizzardClient(config, async (url) => {
      urls.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes("/token")) return json({ access_token: "app", expires_in: 3600 });
      if (url.includes("/data/wow/media/item/19019")) {
        return json({ assets: [{ key: "icon", value: "https://render.worldofwarcraft.com/classic1x-us/icons/56/INV_Sword_39.jpg" }] });
      }
      if (url.includes("/data/wow/item/19019")) {
        return json({ id: 19019, name: "Thunderfury, Blessed Blade of the Windseeker", quality: { type: "LEGENDARY" }, level: 80 });
      }
      return json({ code: 404 }, 404);
    });
    expect(await client.getItem(19019)).toEqual({
      status: "ok",
      item: { itemId: 19019, name: "Thunderfury, Blessed Blade of the Windseeker", quality: 5, itemLevel: 80, icon: "inv_sword_39" },
    });
    expect(urls.find((u) => u.includes("/data/wow/item/"))).toContain("namespace=static-classic1x-us");
    expect(await client.getItem(1)).toEqual({ status: "missing" });
  });
});

describe("guild tabards", () => {
  const crest = {
    emblem: { id: 97, media: { id: 97 }, color: { id: 14, rgba: { r: 177, g: 184, b: 177, a: 1 } } },
    border: { id: 0, media: { id: 0 }, color: { id: 3, rgba: { r: 103, g: 86, b: 0, a: 1 } } },
    background: { color: { id: 2, rgba: { r: 158, g: 0, b: 54, a: 1 } } },
  };

  it("parses the guild endpoint's crest, and nothing from an incomplete one", () => {
    expect(parseGuildCrest({ name: "x", crest })).toEqual({
      emblem: { id: 97, color: { id: 14, rgb: [177, 184, 177] } },
      border: { id: 0, color: { id: 3, rgb: [103, 86, 0] } },
      background: { color: { id: 2, rgb: [158, 0, 54] } },
    });
    expect(parseGuildCrest({ name: "x" })).toBeNull();
    expect(parseGuildCrest({ crest: { ...crest, border: { color: crest.border.color } } })).toBeNull();
  });

  it("reads a guild in its region's profile namespace with the app token", async () => {
    const urls: string[] = [];
    const client = new BlizzardClient(config, async (url, init) => {
      urls.push(url);
      if (url.includes("/token")) return new Response(JSON.stringify({ access_token: "app", expires_in: 3600 }));
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer app");
      if (url.includes("/data/wow/guild/hollowmere/iron-oath")) return new Response(JSON.stringify({ name: "Iron Oath", crest }));
      return new Response("{}", { status: url.includes("/gone") ? 404 : 503 });
    });
    expect(await client.lookupGuild("eu", "hollowmere", "iron-oath")).toMatchObject({ status: "ok", name: "Iron Oath", crest: { emblem: { id: 97 } } });
    expect(urls.at(-1)).toMatch(/^https:\/\/eu\.api\.blizzard\.com\/data\/wow\/guild\/hollowmere\/iron-oath\?namespace=profile-classic1x-eu/);
    expect(await client.lookupGuild("us", "x", "gone")).toEqual({ status: "not_found" });
    expect(await client.lookupGuild("us", "x", "down")).toEqual({ status: "error" });
  });

  it("mock mode serves the Order's in-game tabard", async () => {
    const client = new BlizzardClient({ ...config, mock: true }, createMockFetch());
    const lookup = await client.lookupGuild("us", "crusaders-reach", "order-of-saint-michael");
    expect(lookup).toMatchObject({ status: "ok", name: "Order of Saint Michael", crest: { emblem: { id: 97 }, border: { id: 0 }, background: { color: { id: 2 } } } });
    expect(await client.lookupGuild("us", "crusaders-reach", "nobody")).toEqual({ status: "not_found" });
  });
});
