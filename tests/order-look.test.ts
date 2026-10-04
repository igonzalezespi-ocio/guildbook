import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Crest, CrestArt } from "@/components/crest";
import { GuildEmblem } from "@/components/guild-emblem";
import { GuildThemeStyle } from "@/components/guild-theme";
import { TabardArt, TabardCrest } from "@/components/tabard-crest";
import { brandFile, brandIcons, brandPreviewImage, guildBrand, guildPreviewImage, type PreviewGuild, previewVersion } from "@/lib/brand";
import { STATIC_PREVIEW_VERSIONS } from "@/lib/brand-versions";
import { BORDER_STYLE_IDS, DEFAULT_TABARD, ORDER_TABARD, tabardKey, type TabardConfig } from "@/lib/tabard/config";
import type { TabardDetail } from "@/lib/tabard/emblem-types";
import { svgToString } from "@/lib/tabard/svg-string";

/** Captured from components/crest.tsx before tabard theming existed. */
const BASELINE = JSON.parse(readFileSync("tests/fixtures/order-crest.json", "utf8")) as Record<"crest" | "full" | "mark" | "tiny", string>;

const orderGuild = {
  slug: "osm",
  name: "Order of Saint Michael",
  tabardBackground: ORDER_TABARD.background,
  tabardBorder: ORDER_TABARD.border,
  tabardBorderStyle: ORDER_TABARD.borderStyle,
  tabardEmblemColor: ORDER_TABARD.emblemColor,
  tabardEmblemId: null,
  themeBase: "order" as const,
  themeOverrides: {},
};
const standardGuild = { ...orderGuild, slug: "silver-dawn", name: "Silver Dawn", tabardEmblemId: ORDER_TABARD.emblemId, themeBase: "tome" as const };

/** On-page crests prefix their gradient ids per instance; drop the prefix to compare with the baseline's fixed ids. */
const CREST_ID = /(id="|url\(#)crest-[A-Za-z0-9_-]+?-(gold|white|field|fold)(?=[")])/g;
const withBaselineIds = (html: string) => html.replace(CREST_ID, "$1crest-$2");

describe("the Order of Saint Michael's look is unchanged", () => {
  it("renders the crest byte for byte as before, at every detail level", () => {
    expect(withBaselineIds(renderToStaticMarkup(createElement(Crest, {})))).toBe(BASELINE.crest);
    expect(renderToStaticMarkup(createElement(CrestArt, { detail: "full", width: 100, height: 120 }))).toBe(BASELINE.full);
    expect(renderToStaticMarkup(createElement(CrestArt, { detail: "mark", width: 40, height: 48 }))).toBe(BASELINE.mark);
    expect(renderToStaticMarkup(createElement(CrestArt, { detail: "tiny", width: 16, height: 19.2 }))).toBe(BASELINE.tiny);
  });

  it("shows the locked crest (not the generic renderer) even though its tabard is stored", () => {
    expect(withBaselineIds(renderToStaticMarkup(createElement(GuildEmblem, { guild: orderGuild })))).toBe(BASELINE.crest);
  });

  it("gives each crest on a page its own gradient ids, so a hidden copy can't blank the others", () => {
    const html = renderToStaticMarkup(createElement("div", {}, createElement(Crest, {}), createElement(Crest, {})));
    const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
    for (const [, ref] of html.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref);
  });

  it("injects no theme CSS, so globals.css stays exactly as written", () => {
    expect(renderToStaticMarkup(createElement(GuildThemeStyle, { guild: orderGuild }))).toBe("");
    expect(renderToStaticMarkup(createElement(GuildThemeStyle, { guild: standardGuild }))).toContain("--color-crimson:");
  });

  it("keeps its static icon set, byte for byte", () => {
    expect(brandIcons(guildBrand(orderGuild))).toEqual({
      icon: [
        { url: "/brand/osm/icon.svg", type: "image/svg+xml" },
        { url: "/brand/osm/favicon.ico", sizes: "48x48" },
      ],
      apple: "/brand/osm/apple-icon.png",
    });
    const sha = (f: string) => createHash("sha1").update(readFileSync(`public/brand/${f}`)).digest("hex");
    expect(sha("osm/favicon.ico")).toBe("27edbcb2c6f8eeaf35756cd2c196f75cf5d065aa");
    expect(sha("osm/icon-512.png")).toBe("e72b4a23a62c6d5de1860eb2cd285782937beb2c");
    expect(sha("discord-icon.png")).toBe("d30845c46d06e265a696b4ebc841e8e7da2f81c2");
  });

  it("versions the platform's static link previews by the image's content hash", () => {
    for (const preview of ["guildbook", "vigil"] as const) {
      const hash = createHash("sha1").update(readFileSync(`public/brand/${preview}/og.png`)).digest("hex");
      expect(hash.startsWith(STATIC_PREVIEW_VERSIONS[preview])).toBe(true);
      expect(brandPreviewImage(preview)).toMatchObject({ url: `/brand/${preview}/og.png?v=${STATIC_PREVIEW_VERSIONS[preview]}`, width: 1200, height: 630 });
    }
  });

  it("draws its link preview per request with its locked crest, versioned by what the card shows", () => {
    const guild: PreviewGuild = { ...orderGuild, motto: "Quis ut Deus", faction: "alliance", recruitmentOpen: true };
    const image = guildPreviewImage(guild, "orderofsaintmichael.com", "charter");
    expect(image).toMatchObject({ width: 1200, height: 630 });
    expect(image.url).toBe(`/api/brand/osm/og.png?v=${previewVersion(guild, "orderofsaintmichael.com")}&page=charter`);
    expect(image.alt).toContain("estandarte carmesí");
    const v = (g: PreviewGuild, host = "orderofsaintmichael.com") => previewVersion(g, host);
    expect(v({ ...guild, recruitmentOpen: false })).not.toBe(v(guild));
    expect(v({ ...guild, name: "Order of Saint Michael the Archangel" })).not.toBe(v(guild));
    expect(v(guild, "osm.guildbook.io")).not.toBe(v(guild));
    expect(v({ ...guild, verifiedAt: new Date() })).not.toBe(v(guild));
    expect(v({ ...guild, ruleset: "pvp" })).not.toBe(v(guild));
    expect(v({ ...guild, region: "eu" })).not.toBe(v({ ...guild, region: "us" }));
    // The Order's stored tabard doesn't drive its art, so it doesn't version its preview.
    expect(v({ ...guild, tabardEmblemId: 128, tabardEmblemColor: 3 })).toBe(v(guild));
  });
});

describe("generic tabard crests", () => {
  const tabards: TabardConfig[] = [DEFAULT_TABARD, { background: 25, border: 14, borderStyle: "studded", emblemColor: 15, emblemId: 193, borderId: 4 }];

  it("give other guilds their tabard and versioned generated icons", () => {
    const brand = guildBrand(standardGuild);
    expect(brandFile(brand, "icon-192.png")).toBe(`/api/brand/silver-dawn/icon-192.png?v=${tabardKey(ORDER_TABARD)}`);
    expect(renderToStaticMarkup(createElement(GuildEmblem, { guild: standardGuild }))).toContain('aria-label="Tabardo de Silver Dawn"');
  });

  it("version their link previews by tabard, base style and colour overrides", () => {
    const guild: PreviewGuild = { ...standardGuild, motto: null, faction: "horde", recruitmentOpen: true };
    const v = (g: PreviewGuild) => previewVersion(g, "silver-dawn.guildbook.io");
    expect(v({ ...guild, tabardEmblemId: 128 })).not.toBe(v(guild));
    expect(v({ ...guild, themeBase: "parchment" })).not.toBe(v(guild));
    expect(v({ ...guild, themeOverrides: { trim: "#ffffff" } })).not.toBe(v(guild));
    expect(guildPreviewImage(guild, "silver-dawn.guildbook.io").url).toBe(`/api/brand/silver-dawn/og.png?v=${v(guild)}`);
  });

  it("render deterministically with no gradients or long decimals, and only the emblem's tint filter as an id", () => {
    for (const tabard of tabards) {
      const html = renderToStaticMarkup(createElement(TabardCrest, { tabard, label: "x" }));
      expect(html).toBe(renderToStaticMarkup(createElement(TabardCrest, { tabard, label: "x" })));
      expect(html).not.toMatch(/Gradient|NaN|\d+\.\d{4,}/);
      expect([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])).toEqual([expect.stringMatching(/-emblem$/)]);
      for (const d of ["tiny", "mark", "full"]) expect(html).toContain(`data-detail="${d}"`);
    }
  });

  it("render every trim style at every detail", () => {
    for (const borderStyle of BORDER_STYLE_IDS) {
      const html = renderToStaticMarkup(createElement(TabardCrest, { tabard: { ...DEFAULT_TABARD, borderStyle }, label: borderStyle }));
      expect(html, borderStyle).not.toMatch(/NaN|undefined/);
    }
  });

  it("serialize for the icon routes exactly as React renders them", () => {
    const normalize = (s: string) => s.replace(/><\/(path|circle|rect|ellipse|line|polygon|polyline|image|feFuncR|feFuncG|feFuncB)>/g, "/>");
    for (const tabard of tabards) {
      for (const detail of ["tiny", "mark", "full"] as TabardDetail[]) {
        const el = createElement(TabardArt, { tabard, detail, width: 100, height: 120 });
        expect(normalize(svgToString(el))).toBe(normalize(renderToStaticMarkup(el)));
      }
    }
  });
});
