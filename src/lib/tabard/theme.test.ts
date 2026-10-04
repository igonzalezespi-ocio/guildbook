import { describe, expect, it } from "vitest";
import { clampToContrast, contrast, deltaE, fromOklch, toOklch } from "@/lib/tabard/color";
import { DEFAULT_TABARD, type TabardConfig } from "@/lib/tabard/config";
import { BACKGROUND_COLORS, BORDER_COLORS, EMBLEM_COLORS } from "@/lib/tabard/palette";
import {
  AA_TEXT,
  AA_UI,
  BASE_STYLES,
  computeTheme,
  SELECTABLE_BASE_IDS,
  tabardWarnings,
  themeCss,
  themeWarnings,
} from "@/lib/tabard/theme";

const t = (patch: Partial<TabardConfig>): TabardConfig => ({ ...DEFAULT_TABARD, ...patch });

describe("colour maths", () => {
  it("computes WCAG contrast", () => {
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(contrast("#123456", "#123456")).toBe(1);
  });

  it("round-trips sRGB through OKLCH", () => {
    for (const s of [...BACKGROUND_COLORS, ...BORDER_COLORS, ...EMBLEM_COLORS]) {
      expect(fromOklch(toOklch(s.hex))).toBe(s.hex);
    }
  });

  it("clamps lightness to meet a contrast target and keeps the hue", () => {
    const ink = "#0b0908";
    const r = clampToContrast("#9e0036", [{ against: ink, min: AA_TEXT }]);
    expect(r.ok).toBe(true);
    expect(r.shift).toBeGreaterThan(0);
    expect(contrast(r.hex, ink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(Math.abs(toOklch(r.hex).h - toOklch("#9e0036").h)).toBeLessThan(4);
  });

  it("leaves colours that already pass untouched", () => {
    expect(clampToContrast("#e6c877", [{ against: "#0b0908", min: AA_TEXT }])).toEqual({ hex: "#e6c877", ok: true, shift: 0 });
  });
});

describe("tabard to theme mapping", () => {
  it("maps background to primary, border to trim and emblem to highlight", () => {
    const theme = computeTheme(t({ background: 32, border: 3, emblemColor: 14 }), "tome");
    expect(theme.roles.primary.source).toBe(BACKGROUND_COLORS[32]!.hex);
    expect(theme.roles.trim.source).toBe(BORDER_COLORS[3]!.hex);
    expect(theme.roles.highlight.source).toBe(EMBLEM_COLORS[14]!.hex);
    expect(theme.vars["--color-crimson"]).toBe(theme.primaryFill.value);
    expect(theme.vars["--color-gold"]).toBe(theme.roles.trim.value);
    expect(theme.vars["--color-highlight"]).toBe(theme.roles.highlight.value);
  });

  // Every swatch of every palette, on every base: the tuned site colours meet AA on the base surfaces.
  for (const base of SELECTABLE_BASE_IDS) {
    const s = BASE_STYLES[base].surfaces;
    const pages = [s.ink, s.ink2, s.ink3];
    it(`keeps every background swatch readable on ${base}`, () => {
      for (const sw of BACKGROUND_COLORS) {
        const theme = computeTheme(t({ background: sw.id }), base);
        expect(contrast(theme.onPrimary, theme.vars["--color-crimson"]!), `${sw.name} button`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(theme.onPrimary, theme.vars["--theme-primary-hi"]!), `${sw.name} button top`).toBeGreaterThanOrEqual(AA_TEXT);
        for (const p of pages) expect(contrast(theme.vars["--color-crimson-bright"]!, p), `${sw.name} accent`).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrast(theme.vars["--color-crimson-deep"]!, s.parchment), `${sw.name} on parchment`).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });
    it(`keeps every border swatch readable as trim on ${base}`, () => {
      for (const sw of BORDER_COLORS) {
        const theme = computeTheme(t({ border: sw.id }), base);
        for (const p of pages) {
          expect(contrast(theme.vars["--color-gold"]!, p), `${sw.name} trim`).toBeGreaterThanOrEqual(AA_TEXT);
          expect(contrast(theme.vars["--color-gold-bright"]!, p), `${sw.name} trim bright`).toBeGreaterThanOrEqual(AA_TEXT);
          expect(contrast(theme.vars["--color-gold-dim"]!, p), `${sw.name} trim dim`).toBeGreaterThanOrEqual(AA_UI);
        }
      }
    });
    it(`keeps every emblem swatch readable as highlight on ${base}`, () => {
      for (const sw of EMBLEM_COLORS) {
        const theme = computeTheme(t({ emblemColor: sw.id }), base);
        for (const p of pages) expect(contrast(theme.vars["--color-highlight"]!, p), sw.name).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });
  }

  it("picks dark button text for light tabard colours and light text for dark ones", () => {
    const yellow = computeTheme(t({ background: 12 }), "tome");
    expect(yellow.onPrimary).toBe(BASE_STYLES.tome.onPrimary.dark);
    const navy = computeTheme(t({ background: 32 }), "tome");
    expect(navy.onPrimary).toBe(BASE_STYLES.tome.onPrimary.light);
  });

  it("darkens class colours on the light parchment base", () => {
    const theme = computeTheme(DEFAULT_TABARD, "parchment");
    expect(contrast(theme.vars["--class-priest"]!, BASE_STYLES.parchment.surfaces.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(computeTheme(DEFAULT_TABARD, "tome").vars["--class-priest"]).toBeUndefined();
  });

  it("applies site-only overrides, still clamped, and ignores invalid ones", () => {
    const theme = computeTheme(DEFAULT_TABARD, "tome", { trim: "#330000", highlight: "not-a-colour" });
    expect(theme.roles.trim.source).toBe("#330000");
    expect(theme.roles.trim.overridden).toBe(true);
    expect(contrast(theme.roles.trim.value, BASE_STYLES.tome.surfaces.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(theme.roles.highlight.overridden).toBe(false);
  });

  it("switches fonts and colour scheme with the base style", () => {
    expect(computeTheme(DEFAULT_TABARD, "modern").vars["--font-display"]).toContain("--font-inter");
    expect(computeTheme(DEFAULT_TABARD, "tome").vars["--font-display"]).toContain("--font-cinzel");
    expect(themeCss(computeTheme(DEFAULT_TABARD, "parchment"))).toContain("html{color-scheme:light}");
  });

  it("writes page CSS on :root and preview CSS inside its scope only", () => {
    const theme = computeTheme(DEFAULT_TABARD, "tome");
    const page = themeCss(theme);
    expect(page.startsWith(":root{")).toBe(true);
    expect(page).toContain("body{background-color:var(--color-ink)");
    const scoped = themeCss(theme, ".tabard-preview");
    expect(scoped).not.toContain(":root");
    expect(scoped).not.toMatch(/(^|})body\{/);
    expect(scoped).toContain(".tabard-preview .btn-primary{");
    expect(scoped).not.toContain("<");
  });
});

describe("low-distinction warnings", () => {
  it("warns when the border nearly matches the background", () => {
    const w = tabardWarnings(t({ background: 49, border: 14 }));
    expect(w.some((x) => x.level === "warn" && /color del borde es casi igual/.test(x.message))).toBe(true);
  });

  it("warns when the emblem nearly matches the background", () => {
    const w = tabardWarnings(t({ background: 49, border: 3, emblemColor: 14 }));
    expect(w.some((x) => /color del emblema es casi igual/.test(x.message))).toBe(true);
  });

  it("stays quiet for a well-separated tabard", () => {
    expect(tabardWarnings(t({ background: 32, border: 3, emblemColor: 14 }))).toEqual([]);
    expect(deltaE(BACKGROUND_COLORS[32]!.hex, BORDER_COLORS[3]!.hex)).toBeGreaterThan(0.1);
  });

  it("flags buttons that vanish into the page and large lightness corrections", () => {
    const theme = computeTheme(t({ background: 45 }), "tome");
    const w = themeWarnings(theme);
    expect(w.some((x) => /apenas destacarán/.test(x.message))).toBe(true);
    const navyTrim = computeTheme(t({ border: 10 }), "tome");
    expect(themeWarnings(navyTrim).some((x) => /se aclara bastante/.test(x.message))).toBe(true);
  });
});
