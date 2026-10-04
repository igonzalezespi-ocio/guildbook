import { CLASS_INFO, CLASSES } from "@/lib/game";
import { clampToContrast, contrast, deltaE, isHex, shiftLightness } from "@/lib/tabard/color";
import type { TabardConfig } from "@/lib/tabard/config";
import { swatchOf } from "@/lib/tabard/palette";

/**
 * `order` is the Order of Saint Michael's hand-tuned theme (globals.css as written). It is locked to the Order:
 * the database refuses it for any other guild, and it never appears as a choice.
 */
export const THEME_BASES = ["order", "tome", "parchment", "modern"] as const;
export type ThemeBase = (typeof THEME_BASES)[number];
export type SelectableBase = Exclude<ThemeBase, "order">;
export const SELECTABLE_BASE_IDS = ["tome", "parchment", "modern"] as const satisfies readonly SelectableBase[];

export const ROLES = ["primary", "trim", "highlight"] as const;
export type Role = (typeof ROLES)[number];
export type ThemeOverrides = Partial<Record<Role, string>>;

/** WCAG AA for body-size text. */
export const AA_TEXT = 4.5;
/** WCAG AA for large text and UI parts (borders, icons). */
export const AA_UI = 3;

interface Surfaces {
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  bone: string;
  muted: string;
  parchment: string;
  parchmentInk: string;
}

interface BaseStyle {
  id: SelectableBase;
  name: string;
  description: string;
  dark: boolean;
  surfaces: Surfaces;
  /** Text on primary buttons, whichever reads with the least change to the tabard colour. */
  onPrimary: { light: string; dark: string };
  fonts: { display: string; title: string };
}

const CINZEL = 'var(--font-cinzel), "Times New Roman", serif';
const CINZEL_DECORATIVE = "var(--font-cinzel-decorative), var(--font-cinzel), serif";
const SANS = "var(--font-inter), ui-sans-serif, system-ui, sans-serif";

export const BASE_STYLES: Record<SelectableBase, BaseStyle> = {
  tome: {
    id: "tome",
    name: "Tomo oscuro",
    description: "Cuero casi negro y tinta, títulos en Cinzel. El aspecto clásico de sala de hermandad.",
    dark: true,
    surfaces: {
      ink: "#0b0908",
      ink2: "#14100e",
      ink3: "#1d1714",
      line: "#3a2e22",
      bone: "#ece4d4",
      muted: "#a39888",
      parchment: "#e9dcc0",
      parchmentInk: "#2b1d12",
    },
    onPrimary: { light: "#fbf6ec", dark: "#14100e" },
    fonts: { display: CINZEL, title: CINZEL_DECORATIVE },
  },
  parchment: {
    id: "parchment",
    name: "Pergamino",
    description: "Páginas color crema con tinta oscura, títulos en Cinzel. Claro y libresco.",
    dark: false,
    surfaces: {
      ink: "#f4ecda",
      ink2: "#ebe0c8",
      ink3: "#fbf6ea",
      line: "#cfbd99",
      bone: "#2b1d12",
      muted: "#65543f",
      parchment: "#fbf5e6",
      parchmentInk: "#2b1d12",
    },
    onPrimary: { light: "#fffaf0", dark: "#1f150d" },
    fonts: { display: CINZEL, title: CINZEL_DECORATIVE },
  },
  modern: {
    id: "modern",
    name: "Moderno sencillo",
    description: "Superficies de pizarra neutras y títulos limpios sin serifa.",
    dark: true,
    surfaces: {
      ink: "#0f1115",
      ink2: "#161920",
      ink3: "#1c2028",
      line: "#2e3440",
      bone: "#e7e9ee",
      muted: "#9aa2b1",
      parchment: "#e9ebef",
      parchmentInk: "#1b1f27",
    },
    onPrimary: { light: "#ffffff", dark: "#11141a" },
    fonts: { display: SANS, title: SANS },
  },
};

export interface RoleColor {
  /** The tabard colour (or override) the role starts from. */
  source: string;
  /** What the site uses after contrast clamping. */
  value: string;
  /** Whether the value meets its contrast target. */
  ok: boolean;
  /** OKLCH lightness change applied (positive is lighter). */
  shift: number;
  overridden: boolean;
}

export interface ThemeWarning {
  level: "warn" | "info";
  message: string;
}

export interface GuildTheme {
  base: SelectableBase;
  roles: Record<Role, RoleColor>;
  primaryFill: RoleColor;
  onPrimary: string;
  vars: Record<string, string>;
  dark: boolean;
}

/** Tabard colours for each role: background to primary, border to trim, emblem to highlight. */
export function tabardSources(t: TabardConfig): Record<Role, string> {
  return {
    primary: swatchOf("background", t.background).hex,
    trim: swatchOf("border", t.border).hex,
    highlight: swatchOf("emblem", t.emblemColor).hex,
  };
}

const textOn = (surfaces: string[], min = AA_TEXT) => surfaces.map((against) => ({ against, min }));

function role(source: string, rules: ReturnType<typeof textOn>, overridden: boolean, prefer?: "lighter" | "darker"): RoleColor {
  const r = clampToContrast(source, rules, prefer);
  return { source, value: r.hex, ok: r.ok, shift: r.shift, overridden };
}

/**
 * Picks the primary button fill: the tabard background moved the least distance in lightness until button text
 * (light or dark, whichever needs less change) meets AA on it.
 */
function primaryButton(source: string, base: BaseStyle, overridden: boolean) {
  const options = (["light", "dark"] as const).map((k) => {
    const on = base.onPrimary[k];
    return { on, fill: role(source, textOn([on]), overridden) };
  });
  const [light, dark] = options as [(typeof options)[0], (typeof options)[0]];
  const pick = !light.fill.ok ? dark : !dark.fill.ok ? light : Math.abs(light.fill.shift) <= Math.abs(dark.fill.shift) + 0.02 ? light : dark;
  return pick;
}

/** Maps a tabard, base style and optional overrides to site colours that meet WCAG AA on the base surfaces. */
export function computeTheme(tabard: TabardConfig, baseId: SelectableBase, overrides: ThemeOverrides = {}): GuildTheme {
  const base = BASE_STYLES[baseId];
  const s = base.surfaces;
  const tabardColors = tabardSources(tabard);
  const source = (r: Role) => (overrides[r] && isHex(overrides[r]!) ? overrides[r]!.toLowerCase() : tabardColors[r]);
  const isOverridden = (r: Role) => source(r) !== tabardColors[r];
  const pages = [s.ink, s.ink2, s.ink3];

  const button = primaryButton(source("primary"), base, isOverridden("primary"));
  const fill = button.fill.value;
  const fillHi = clampToContrast(shiftLightness(fill, 0.05), textOn([button.on])).hex;
  const primary = role(source("primary"), textOn(pages), isOverridden("primary"));
  const primaryDeep = clampToContrast(shiftLightness(source("primary"), -0.1), textOn([s.parchment])).hex;

  const trim = role(source("trim"), textOn(pages), isOverridden("trim"));
  const toward = base.dark ? 1 : -1;
  const trimBright = clampToContrast(shiftLightness(trim.value, 0.08 * toward), textOn(pages)).hex;
  const trimDim = clampToContrast(shiftLightness(trim.value, -0.2 * toward), textOn(pages, AA_UI)).hex;

  const highlight = role(source("highlight"), textOn(pages), isOverridden("highlight"));

  const vars: Record<string, string> = {
    "--color-ink": s.ink,
    "--color-ink-2": s.ink2,
    "--color-ink-3": s.ink3,
    "--color-line": s.line,
    "--color-bone": s.bone,
    "--color-muted": s.muted,
    "--color-parchment": s.parchment,
    "--color-parchment-ink": s.parchmentInk,
    "--color-crimson": fill,
    "--color-crimson-bright": primary.value,
    "--color-crimson-deep": primaryDeep,
    "--color-gold": trim.value,
    "--color-gold-bright": trimBright,
    "--color-gold-dim": trimDim,
    "--color-highlight": highlight.value,
    "--theme-on-primary": button.on,
    "--theme-primary-hi": fillHi,
    "--theme-glow": source("primary"),
    "--font-display": base.fonts.display,
    "--font-title": base.fonts.title,
  };
  if (!base.dark) {
    // Status colours written for dark pages (red-300 and friends) darkened for light ones.
    Object.assign(vars, {
      "--color-red-200": "#8f1d1d",
      "--color-red-300": "#a61b1b",
      "--color-emerald-300": "#05603a",
      "--color-emerald-700": "#3f9f73",
      "--color-sky-300": "#075985",
      "--color-sky-700": "#3a87bf",
    });
    for (const c of CLASSES) vars[`--class-${c}`] = clampToContrast(CLASS_INFO[c].color, textOn(pages)).hex;
  }

  return {
    base: baseId,
    roles: { primary, trim, highlight },
    primaryFill: button.fill,
    onPrimary: button.on,
    vars,
    dark: base.dark,
  };
}

/**
 * The theme as CSS. With no `scope` it themes the whole page (`:root` and `body`); with a scope selector it
 * themes only that element and its descendants (the admin preview).
 */
export function themeCss(theme: GuildTheme, scope?: string): string {
  const at = (sel: string) =>
    scope
      ? sel
          .split(",")
          .map((part) => (part.trim() === "body" ? scope : `${scope} ${part.trim()}`))
          .join(",")
      : sel;
  const decls = Object.entries(theme.vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  const glow = theme.dark ? 18 : 12;
  const rules: [string, string][] = [
    [at("body"), `background-color:var(--color-ink);background-image:radial-gradient(ellipse at top,color-mix(in srgb,var(--theme-glow) ${glow}%,transparent),transparent 60%),radial-gradient(ellipse at bottom,color-mix(in srgb,var(--color-gold) 5%,transparent),transparent 70%);color:var(--color-bone)`],
    [at(".panel"), `box-shadow:inset 0 1px 0 color-mix(in srgb,var(--color-gold) 12%,transparent),0 8px 24px rgb(0 0 0 / ${theme.dark ? 0.35 : 0.08})`],
    [at(".btn-primary"), "background:linear-gradient(180deg,var(--theme-primary-hi),var(--color-crimson));color:var(--theme-on-primary)"],
    [at(".btn-primary:hover:not(:disabled)"), "color:var(--theme-on-primary)"],
    [at(".btn-ghost:hover:not(:disabled)"), "background:color-mix(in srgb,var(--color-gold) 6%,transparent)"],
    [at(".btn-danger"), `border-color:#b4232f;color:${theme.dark ? "#f3b4bd" : "#9b1c28"}`],
    [at(".prose-order a,.lore .prose-order > h2:first-child + p::first-letter"), "color:var(--color-crimson-deep)"],
    [at(".prose-dark strong"), "color:var(--color-highlight)"],
  ];
  if (theme.base === "modern") {
    rules.push([at("h1,h2,h3,h4"), "letter-spacing:-0.01em"], [at(".btn"), "letter-spacing:0.04em"]);
  }
  const root = scope ?? ":root";
  const scheme = scope ? "" : `html{color-scheme:${theme.dark ? "dark" : "light"}}`;
  return `${root}{${decls}${scope ? `;color-scheme:${theme.dark ? "dark" : "light"};font-family:var(--font-sans)` : ""}}${scheme}${rules.map(([sel, body]) => `${sel}{${body}}`).join("")}`;
}

/** Tabard combinations that won't read well on the crest itself. */
export function tabardWarnings(t: TabardConfig): ThemeWarning[] {
  const c = tabardSources(t);
  const out: ThemeWarning[] = [];
  if (deltaE(c.primary, c.trim) < 0.1) {
    out.push({ level: "warn", message: "El color del borde es casi igual que el del fondo, así que el contorno del estandarte desaparecerá." });
  }
  if (deltaE(c.primary, c.highlight) < 0.12) {
    out.push({ level: "warn", message: "El color del emblema es casi igual que el del fondo, así que el emblema se verá mal." });
  }
  if (deltaE(c.trim, c.highlight) < 0.05 && deltaE(c.primary, c.trim) >= 0.1) {
    out.push({ level: "info", message: "El borde y el emblema comparten color, así que el ribete y el realce del sitio coincidirán." });
  }
  return out;
}

const ROLE_LABELS: Record<Role, string> = { primary: "Principal (botones y acentos)", trim: "Ribete (títulos y bordes)", highlight: "Realce (iconos y énfasis)" };

/** Readability notes for the site colours: large contrast corrections and colours that blur together. */
export function themeWarnings(theme: GuildTheme): ThemeWarning[] {
  const out: ThemeWarning[] = [];
  const baseName = BASE_STYLES[theme.base].name;
  const s = BASE_STYLES[theme.base].surfaces;
  for (const r of ROLES) {
    const color = theme.roles[r];
    if (!color.ok) out.push({ level: "warn", message: `${ROLE_LABELS[r]} no llega al contraste AA sobre ${baseName}.` });
    else if (Math.abs(color.shift) >= 0.15) {
      out.push({
        level: "info",
        message: `${ROLE_LABELS[r]} se ${color.shift > 0 ? "aclara" : "oscurece"} bastante para que se lea bien sobre ${baseName}.`,
      });
    }
  }
  if (contrast(theme.primaryFill.value, s.ink) < 1.35) {
    out.push({ level: "warn", message: "Los botones principales apenas destacarán sobre el fondo de la página." });
  }
  if (deltaE(theme.roles.primary.value, theme.roles.trim.value) < 0.08) {
    out.push({ level: "warn", message: "El principal y el ribete salen casi idénticos en el sitio; plantéate ajustarlos a mano." });
  }
  return out;
}
