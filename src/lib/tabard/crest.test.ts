import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { previewVersion } from "@/lib/brand";
import { DEFAULT_TABARD, ORDER_TABARD, tabardKey, tabardSchema } from "@/lib/tabard/config";
import { CREST_EMBLEMS, emblemSrc, isCrestEmblem, LEGACY_EMBLEM_MATCH } from "@/lib/tabard/crest";
import { type CrestInput, paletteIdFor, tabardFromCrest } from "@/lib/tabard/crest-import";
import { CREST_MANIFEST } from "@/lib/tabard/crest-manifest";
import { CREST_ART_VERSION } from "@/lib/tabard/crest-tone";
import { guildLook } from "@/lib/tabard/look";
import { PALETTES, type PaletteKind } from "@/lib/tabard/palette";

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** Reads width, height, bit depth and colour type from a PNG's IHDR. */
function pngHeader(file: string) {
  const b = readFileSync(file);
  expect(b.subarray(1, 4).toString()).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), depth: b[24], colorType: b[25] };
}

describe("the bundled crest manifest", () => {
  it("lists every bundled emblem, the files match their hashes, and no Blizzard borders ship", () => {
    const files = readdirSync("public/tabard/emblems").map((f) => Number(f.replace(".png", ""))).sort((a, b) => a - b);
    expect(files).toEqual(CREST_MANIFEST.emblems.map((e) => e.id));
    for (const e of CREST_MANIFEST.emblems) expect(sha(`public/tabard/emblems/${e.id}.png`).startsWith(e.sha)).toBe(true);
    expect(readdirSync("public/tabard").sort()).toEqual(["NOTICE", "emblems"]);
    expect(existsSync("public/tabard/borders")).toBe(false);
    expect(Object.keys(CREST_MANIFEST)).not.toContain("borders");
    expect(readFileSync("scripts/emblems-fetch.ts", "utf8")).not.toMatch(/border_|guild-crest\/border/);
  });

  it("stores levels-stretched single-colour masks: 8-bit grayscale with alpha at Blizzard's size", async () => {
    for (const e of CREST_MANIFEST.emblems) {
      const h = pngHeader(`public/tabard/emblems/${e.id}.png`);
      expect([h.width, h.height, h.depth, h.colorType]).toEqual([...CREST_MANIFEST.emblemSize, 8, 4]);
    }
    for (const file of ["emblems/0.png", "emblems/128.png", "emblems/195.png"]) {
      const { data, info } = await sharp(`public/tabard/${file}`).raw().toBuffer({ resolveWithObject: true });
      const gray: number[] = [];
      for (let i = 0; i < data.length; i += info.channels) if (data[i + info.channels - 1]! > 128) gray.push(data[i]!);
      expect([Math.min(...gray), Math.max(...gray)], file).toEqual([0, 255]);
    }
  });

  it("has unique, contiguous ids from 0 and a name for every one", () => {
    expect(CREST_EMBLEMS.map((e) => e.id)).toEqual(CREST_EMBLEMS.map((_, i) => i));
    for (const e of CREST_EMBLEMS) expect(e.name).not.toMatch(/^Emblema \d+$/);
    expect(new Set(CREST_EMBLEMS.map((e) => e.name.toLowerCase())).size).toBeGreaterThan(CREST_EMBLEMS.length * 0.9);
  });

  it("versions image URLs by content hash", () => {
    expect(emblemSrc(128)).toBe(`/tabard/emblems/128.png?v=${CREST_MANIFEST.emblems[128]!.sha}`);
  });

  it("uses the game's palettes: the same colour ids and raw values as the designer swatches", () => {
    for (const kind of ["background", "border", "emblem"] as PaletteKind[]) {
      const manifest = CREST_MANIFEST.palettes[kind];
      expect(manifest.map((c) => c.id)).toEqual(PALETTES[kind].map((s) => s.id));
      for (const c of manifest) expect(c.rgba.slice(0, 3)).toEqual(rgb(PALETTES[kind][c.id]!.raw));
    }
  });

  it("keeps a Blizzard notice beside the artwork, naming only emblems", () => {
    const notice = readFileSync("public/tabard/NOTICE", "utf8");
    expect(notice).toMatch(/Blizzard Entertainment[^]*Not covered by Guildbook's AGPL-3\.0 licence/);
    expect(notice).not.toMatch(/border/i);
  });
});

describe("migration 0018's emblem mapping", () => {
  const migration = readFileSync("drizzle/0018_guild_crest.sql", "utf8");

  it("is exactly LEGACY_EMBLEM_MATCH, with the lion for anything else", () => {
    const cases = Object.fromEntries([...migration.matchAll(/WHEN '([a-z-]+)' THEN (\d+)/g)].map((m) => [m[1]!, Number(m[2])]));
    expect(cases).toEqual(LEGACY_EMBLEM_MATCH);
    expect(migration).toMatch(/ELSE 128 END/);
    for (const id of Object.values(LEGACY_EMBLEM_MATCH)) expect(isCrestEmblem(id)).toBe(true);
    expect(DEFAULT_TABARD.emblemId).toBe(128);
  });
});

describe("guild rows", () => {
  const row = { tabardBackground: 25, tabardBorder: 14, tabardBorderStyle: "double", tabardEmblemColor: 15, themeBase: "tome" as const };

  it("keep the emblem id and the stored in-game border id", () => {
    expect(guildLook({ ...row, tabardEmblemId: 193, tabardBorderId: 2 }).tabard).toEqual({
      background: 25,
      border: 14,
      borderStyle: "double",
      emblemColor: 15,
      emblemId: 193,
      borderId: 2,
    });
  });

  it("fall back to the default emblem when the id is missing or unknown", () => {
    for (const ids of [{}, { tabardEmblemId: null }, { tabardEmblemId: 9999 }]) {
      expect(guildLook({ ...row, ...ids }).tabard).toEqual({ background: 25, border: 14, borderStyle: "double", emblemColor: 15, emblemId: 128 });
    }
  });

  it("key their icons by what is drawn: not the in-game border id", () => {
    const t = { background: 25, border: 14, borderStyle: "plain" as const, emblemColor: 15, emblemId: 193 };
    expect(tabardKey(t)).toBe(`25-14-plain-15-e193-t${CREST_ART_VERSION}`);
    expect(tabardKey({ ...t, borderId: 4 })).toBe(tabardKey(t));
    expect(CREST_ART_VERSION).toBe(3);
    expect(tabardKey(ORDER_TABARD)).toBe(`2-3-plain-14-e97-t${CREST_ART_VERSION}`);
  });
});

describe("the tabard form", () => {
  const schema = tabardSchema();
  const base = { background: "25", border: "14", borderStyle: "plain", emblemColor: "15" };

  it("requires an emblem from the bundled set", () => {
    expect(schema.parse({ ...base, emblemId: "193" })).toEqual({ background: 25, border: 14, borderStyle: "plain", emblemColor: 15, emblemId: 193 });
    for (const emblemId of [undefined, "", String(CREST_EMBLEMS.length), "1.5", "-1"]) {
      expect(schema.safeParse({ ...base, emblemId }).success, String(emblemId)).toBe(false);
    }
  });

  it("has no drawn emblem or border id field", () => {
    const parsed = schema.parse({ ...base, emblemId: "5", emblem: "star", borderId: "4" });
    expect(parsed).not.toHaveProperty("emblem");
    expect(parsed).not.toHaveProperty("borderId");
  });
});

describe("importing an in-game crest", () => {
  const color = (kind: PaletteKind, id: number) => ({ id, rgb: rgb(PALETTES[kind][id]!.raw) as [number, number, number] });
  const crest = (over: Partial<CrestInput> = {}): CrestInput => ({
    emblem: { id: 97, color: color("emblem", 14) },
    border: { id: 0, color: color("border", 3) },
    background: { color: color("background", 2) },
    ...over,
  });

  it("maps a colour by its exact RGB first, then its id, then the nearest colour", () => {
    expect(paletteIdFor("background", color("background", 40))).toBe(40);
    expect(paletteIdFor("background", { id: 3, rgb: rgb(PALETTES.background[40]!.raw) as [number, number, number] })).toBe(40);
    expect(paletteIdFor("emblem", { id: 5, rgb: [1, 2, 3] })).toBe(5);
    const [r, g, b] = rgb(PALETTES.border[7]!.raw);
    expect(paletteIdFor("border", { id: 99, rgb: [r! + 1, g!, b! - 1] })).toBe(7);
    expect(paletteIdFor("border", { id: 99, rgb: null })).toBe(0);
    expect(paletteIdFor("border", { id: 9, rgb: null })).toBe(9);
  });

  it("copies the emblem and the three colours, keeps the trim style, and stores the border shape", () => {
    const result = tabardFromCrest(crest(), { ...DEFAULT_TABARD, borderStyle: "studded" });
    expect(result).toEqual({ ok: true, tabard: { background: 2, border: 3, borderStyle: "studded", emblemColor: 14, emblemId: 97, borderId: 0 } });
  });

  it("ignores the border shape for drawing: any shape imports, and the tabard key doesn't change with it", () => {
    const shapes = [0, 5, 6, 12, 400].map((id) => tabardFromCrest(crest({ border: { id, color: color("border", 3) } }), DEFAULT_TABARD));
    for (const [i, r] of shapes.entries()) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.tabard.borderId).toBe([0, 5, 6, 12, 400][i]);
    }
    const keys = shapes.map((r) => (r.ok ? tabardKey(r.tabard) : ""));
    expect(new Set(keys).size).toBe(1);
    const odd = tabardFromCrest(crest({ border: { id: -1, color: color("border", 3) } }), DEFAULT_TABARD);
    expect(odd.ok && odd.tabard.borderId).toBeNull();
  });

  it("refuses an emblem Guildbook doesn't bundle", () => {
    expect(tabardFromCrest(crest({ emblem: { id: 500, color: color("emblem", 0) } }), DEFAULT_TABARD)).toEqual({ ok: false, reason: "unknown_emblem", id: 500 });
  });
});

describe("link preview versions", () => {
  const guild = {
    slug: "silver-dawn",
    name: "Silver Dawn",
    motto: null,
    faction: "alliance" as const,
    recruitmentOpen: true,
    tabardBackground: 25,
    tabardBorder: 14,
    tabardBorderStyle: "plain",
    tabardEmblemColor: 15,
    tabardEmblemId: 128,
    themeBase: "tome" as const,
  };
  const v = (over: object) => previewVersion({ ...guild, ...over }, "silver-dawn.guildbook.io");

  it("change with the emblem and colours, not with the undrawn in-game border id", () => {
    const crest = v({});
    expect(v({ tabardEmblemId: 129 })).not.toBe(crest);
    expect(v({ tabardEmblemColor: 3 })).not.toBe(crest);
    expect(v({ tabardBorder: 3 })).not.toBe(crest);
    expect(v({ tabardBorderId: 4 })).toBe(crest);
  });

  it("ignore crest ids on the Order, whose preview is fixed", () => {
    const order = { ...guild, slug: "osm", themeBase: "order" as const };
    expect(previewVersion(order, "osm.guildbook.io")).toBe(previewVersion({ ...order, tabardEmblemId: 5, tabardBorderId: 5 }, "osm.guildbook.io"));
  });
});
