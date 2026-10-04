import { describe, expect, it } from "vitest";
import type { BattlenetScan } from "@/db/schema";
import { emptySnapshotMessage, type EmptySnapshotInput, refreshSummary } from "./battlenet-empty-state";

describe("refreshSummary", () => {
  it("counts only the characters this guild accepts, in its game version", () => {
    expect(refreshSummary(0)).toBe("Personajes actualizados: ningún personaje de WoW: Forever puede unirse a esta hermandad.");
    expect(refreshSummary(1)).toBe("Hemos encontrado 1 personaje de WoW: Forever para esta hermandad.");
    expect(refreshSummary(5, "anniversary")).toBe("Hemos encontrado 5 personajes de TBC Anniversary para esta hermandad.");
  });
});

const beforeLaunch = new Date("2026-09-28T17:18:00Z");
const afterLaunch = new Date("2026-11-10T12:00:00Z");

const namespaces: BattlenetScan["namespaces"] = [
  { namespace: "profile-classic1x-us", status: "empty", httpStatus: 404, characters: 0 },
  { namespace: "profile-classicann-us", status: "ok", httpStatus: 200, characters: 3 },
  { namespace: "profile-classic-us", status: "empty", httpStatus: 404, characters: 0 },
  { namespace: "profile-us", status: "empty", httpStatus: 404, characters: 0 },
];

const anniversaryScan: BattlenetScan = {
  foreverNamespace: "profile-classic1x-us",
  namespaces,
  excluded: [
    {
      version: "anniversary",
      faction: "alliance",
      count: 2,
      examples: [
        { name: "Elowen", realmName: "Dreamscythe" },
        { name: "Tamsin", realmName: "Dreamscythe" },
      ],
    },
    { version: "anniversary", faction: "horde", count: 1, examples: [{ name: "Gorza", realmName: "Nightslayer" }] },
  ],
};

const base: EmptySnapshotInput = {
  battletag: "Pilgrim#1234",
  status: "empty",
  scan: anniversaryScan,
  foreverCharacters: [],
  guildFaction: "alliance",
  now: beforeLaunch,
};

describe("emptySnapshotMessage", () => {
  it("says what was found per game and faction, and why it was left out", () => {
    expect(emptySnapshotMessage(base)).toBe(
      "No hemos encontrado personajes de WoW: Forever en Pilgrim#1234. Sí hemos encontrado 2 personajes de la Alianza en TBC Anniversary " +
        "(Elowen en Dreamscythe, Tamsin en Dreamscythe) y 1 personaje de la Horda en TBC Anniversary (Gorza en Nightslayer), " +
        "pero solo pueden unirse a esta hermandad personajes de WoW: Forever. World of Warcraft: Forever sale el 4 de noviembre de 2026. " +
        "Cuando hayas creado allí tu personaje, actualiza tus personajes o vuelve a conectar.",
    );
  });

  it("asks a link read before Anniversary imports to refresh, on an Anniversary guild", () => {
    const text = emptySnapshotMessage({ ...base, version: "anniversary", guildRegion: "us" });
    expect(text).toContain("se leyeron antes de que Guildbook pudiera importar personajes de TBC Anniversary");
    expect(text).toContain("actualiza tus personajes (o vuelve a conectar Battle.net) para importarlos");
    expect(text).not.toContain("4 de noviembre");
  });

  it("names the guild's version when its characters are elsewhere", () => {
    const text = emptySnapshotMessage({
      ...base,
      version: "anniversary",
      guildRegion: "eu",
      foreverCharacters: [{ faction: "horde", region: "us" }],
    });
    expect(text).toBe(
      "Tus personajes de TBC Anniversary en Pilgrim#1234 están en América, pero esta hermandad está en la región de Europa. Las regiones son mundos separados, así que solo pueden unirse personajes de Europa.",
    );
  });

  it("counts characters beyond the examples", () => {
    const scan: BattlenetScan = {
      ...anniversaryScan,
      excluded: [{ version: "era", faction: "alliance", count: 7, examples: [{ name: "A", realmName: "Whitemane" }] }],
    };
    expect(emptySnapshotMessage({ ...base, scan })).toContain("7 personajes de la Alianza en Classic Era (A en Whitemane y 6 más)");
  });

  it("says nothing was listed when every game was empty, and flags incomplete reads", () => {
    const empty: BattlenetScan = { ...anniversaryScan, excluded: [] };
    expect(emptySnapshotMessage({ ...base, scan: empty })).toMatch(/^Battle.net no muestra ningún personaje de World of Warcraft en Pilgrim#1234\. World/);
    const partial: BattlenetScan = {
      ...empty,
      namespaces: [...namespaces.slice(0, 3), { namespace: "profile-us", status: "error", httpStatus: 503, characters: 0 }],
    };
    expect(emptySnapshotMessage({ ...base, scan: partial })).toContain("no ha respondido para todos los juegos");
  });

  it("explains a faction mismatch among Forever characters", () => {
    expect(emptySnapshotMessage({ ...base, foreverCharacters: [{ faction: "horde" }] })).toBe(
      "Tus personajes de WoW: Forever en Pilgrim#1234 son de la Horda; esta hermandad solo acepta personajes de la Alianza.",
    );
    expect(emptySnapshotMessage({ ...base, foreverCharacters: [{ faction: "alliance" }] })).toMatch(/los reinos/);
  });

  it("mentions the guild's region, and explains Forever characters in the other region", () => {
    expect(emptySnapshotMessage({ ...base, guildRegion: "us" })).toMatch(/^No hemos encontrado personajes de WoW: Forever en la región de América en Pilgrim#1234\./);
    expect(emptySnapshotMessage({ ...base, guildRegion: "us", foreverCharacters: [{ faction: "alliance", region: "eu" }] })).toBe(
      "Tus personajes de WoW: Forever en Pilgrim#1234 están en Europa, pero esta hermandad está en la región de América. " +
        "Las regiones son mundos separados, así que solo pueden unirse personajes de América.",
    );
    // Characters from snapshots taken before regions are US.
    expect(emptySnapshotMessage({ ...base, guildRegion: "eu", foreverCharacters: [{ faction: "alliance" }] })).toMatch(/están en América, pero esta hermandad está en la región de Europa/);
    const euDown: BattlenetScan = {
      ...anniversaryScan,
      namespaces: [...namespaces.map((n) => ({ ...n, region: "us" as const })), { namespace: "profile-classic1x-eu", region: "eu", status: "error", httpStatus: 503, characters: 0 }],
    };
    expect(emptySnapshotMessage({ ...base, guildRegion: "eu", scan: euDown })).toContain("no ha respondido para todos los juegos en Europa");
  });

  it("asks older links, which have no scan, to refresh", () => {
    expect(emptySnapshotMessage({ ...base, scan: null })).toMatch(/Actualiza tus personajes o vuelve a conectar/);
  });

  it("keeps the refused and failed messages", () => {
    expect(emptySnapshotMessage({ ...base, status: "forbidden" })).toMatch(/no ha compartido tu lista de personajes/);
    expect(emptySnapshotMessage({ ...base, status: "error" })).toMatch(/no ha respondido al leer/);
  });

  it("drops the launch-date note after launch", () => {
    const text = emptySnapshotMessage({ ...base, now: afterLaunch });
    expect(text).not.toContain("sale el");
    expect(text).toContain("puede tardar un rato en mostrarlo");
  });
});
