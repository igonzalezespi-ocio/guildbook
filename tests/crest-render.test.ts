import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { emblemRect, TabardArt } from "@/components/tabard-art";
import { TabardCrest } from "@/components/tabard-crest";
import { BORDER_STYLE_IDS, DEFAULT_TABARD, type TabardConfig } from "@/lib/tabard/config";
import { CREST_EMBLEMS, emblemSrc } from "@/lib/tabard/crest";
import type { TabardDetail } from "@/lib/tabard/emblem-types";
import { svgToString } from "@/lib/tabard/svg-string";
import { crestTone, crestToneLut, crestToneTables } from "@/lib/tabard/crest-tone";
import { EMBLEM_COLORS, PALETTES } from "@/lib/tabard/palette";
import { decodeGrayAlpha, encodeRgba, tintPixels } from "@/lib/tabard/tint-png";
import { crestImages, tintedMask } from "@/server/tabard-tint";

const crest: TabardConfig = { ...DEFAULT_TABARD, emblemId: 128, borderId: 3 };

describe("crests", () => {
  it("give each crest on a page its own emblem tint filter, and every reference resolves", () => {
    const html = renderToStaticMarkup(
      createElement("div", {}, createElement(TabardCrest, { tabard: crest, label: "a" }), createElement(TabardCrest, { tabard: crest, label: "b" })),
    );
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const refs = [...html.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
    expect(refs).toHaveLength(6);
    for (const ref of refs) expect(ids).toContain(ref);
    expect(html).toContain(emblemSrc(128).replace(/&/g, "&amp;"));
  });

  it("never draw a Blizzard border: the drawn trim in the border colour, whatever the stored in-game border", () => {
    for (const borderId of [undefined, null, 0, 4, 6]) {
      for (const borderStyle of BORDER_STYLE_IDS) {
        const tabard = { ...crest, borderId, borderStyle };
        const html = renderToStaticMarkup(createElement(TabardCrest, { tabard, label: "x" }));
        expect(html).not.toContain("/tabard/borders/");
        expect([...html.matchAll(/<image /g)]).toHaveLength(3);
        expect([...html.matchAll(/<filter /g)]).toHaveLength(1);
        expect(html).toBe(renderToStaticMarkup(createElement(TabardCrest, { tabard: { ...tabard, borderId: 5 }, label: "x" })));
      }
    }
  });

  it("render every bundled emblem at every detail", () => {
    for (const e of CREST_EMBLEMS) {
      const html = renderToStaticMarkup(createElement(TabardCrest, { tabard: { ...DEFAULT_TABARD, emblemId: e.id }, label: e.name }));
      expect(html).toContain(`/tabard/emblems/${e.id}.png`);
    }
    expect(emblemRect("full")).toEqual([20, 25, 60, 60]);
  });

  it("serialize for the icon routes exactly as React renders them, with the tinted emblem", async () => {
    const images = await crestImages(crest);
    expect(images).toEqual({ mode: "tinted", emblem: expect.stringMatching(/^data:image\/png;base64,/) });
    const normalize = (s: string) => s.replace(/><\/(path|circle|rect|ellipse|line|polygon|polyline|image)>/g, "/>");
    for (const detail of ["tiny", "mark", "full"] as TabardDetail[]) {
      const el = createElement(TabardArt, { tabard: crest, detail, width: 100, height: 120, images });
      const svg = svgToString(el);
      expect(normalize(svg)).toBe(normalize(renderToStaticMarkup(el)));
      expect(svg).not.toMatch(/ id=|filter=|\/tabard\/borders\//);
      expect([...svg.matchAll(/<image /g)]).toHaveLength(1);
      const bare = svgToString(createElement(TabardArt, { tabard: crest, detail, images: { mode: "bare" } }));
      expect(bare).not.toContain("<image");
    }
  });
});

describe("server-side tinting", () => {
  const png = readFileSync("public/tabard/emblems/128.png");

  it("decodes the masks exactly as a reference decoder does", async () => {
    const mask = decodeGrayAlpha(png);
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    expect([mask.width, mask.height]).toEqual([info.width, info.height]);
    const gray = Buffer.alloc(info.width * info.height * 2);
    for (let i = 0; i < info.width * info.height; i++) {
      expect(data[i * info.channels]).toBe(data[i * info.channels + 1]);
      gray[i * 2] = data[i * info.channels]!;
      gray[i * 2 + 1] = data[i * info.channels + info.channels - 1]!;
    }
    expect(Buffer.from(mask.pixels).equals(gray)).toBe(true);
  });

  it("tints on the shared tone curve and keeps alpha, in a PNG a reference decoder reads back", async () => {
    const mask = decodeGrayAlpha(png);
    const rgba = tintPixels(mask, "#ff8000");
    for (let i = 0, j = 0; i < mask.pixels.length; i += 2, j += 4) {
      const t = crestTone("#ff8000", mask.pixels[i]! / 255).map((v) => Math.round(v * 255));
      expect([rgba[j], rgba[j + 1], rgba[j + 2], rgba[j + 3]]).toEqual([...t, mask.pixels[i + 1]]);
    }
    const out = encodeRgba(mask.width, mask.height, rgba);
    const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([mask.width, mask.height, 4]);
    expect(data.equals(Buffer.from(rgba))).toBe(true);
  });

  it("caches tinted masks", async () => {
    const a = tintedMask("tabard/emblems/7.png", "#123456");
    expect(tintedMask("tabard/emblems/7.png", "#123456")).toBe(a);
    expect(await a).toMatch(/^data:image\/png;base64,/);
  });
});

describe("the crest tone curve", () => {
  const luma = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  const hex = (name: string) => EMBLEM_COLORS.find((s) => s.name === name)!.hex;

  it("gives every palette colour its full colour at the brightest pixels, and shading below", () => {
    for (const s of PALETTES.emblem) {
      const top = crestTone(s.hex, 1);
      const base = [1, 3, 5].map((i) => parseInt(s.hex.slice(i, i + 2), 16) / 255);
      for (let c = 0; c < 3; c++) expect(top[c]!, s.name).toBeGreaterThanOrEqual(base[c]! - 1e-9);
      expect(luma(crestTone(s.hex, 0)), s.name).toBeLessThan(luma(top));
    }
  });

  it("keeps white white, gold gold and black dark with visible relief", () => {
    const white = crestTone(hex("Blanco"), 0.5);
    expect(Math.min(...white)).toBeGreaterThan(0.85);
    const gold = crestTone(hex("Oro"), 0.5);
    expect(gold[0]).toBeGreaterThan(gold[2]! + 0.4);
    const black = [0, 1].map((v) => luma(crestTone(hex("Negro"), v)));
    expect(black[0]).toBeLessThan(0.15);
    expect(black[1]! - black[0]!).toBeGreaterThan(0.1);
  });

  it("gives the browser filter tables the same curve as the server's lookup tables", () => {
    const lut = crestToneLut(hex("Canela"));
    const tables = crestToneTables(hex("Canela")).map((t) => t.split(" ").map(Number));
    for (let c = 0; c < 3; c++) {
      tables[c]!.forEach((v, i) => expect(Math.abs(v * 255 - lut[c]![Math.round((i / (tables[c]!.length - 1)) * 255)]!)).toBeLessThan(1.5));
    }
  });
});
