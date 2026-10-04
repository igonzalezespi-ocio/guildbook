import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { type CrestImages, detailForWidth, emblemRect, TabardArt } from "@/components/tabard-art";
import { FACTION_LABELS, type Faction, REGION_LABELS, type Region, RULESET_INFO, type Ruleset } from "@/lib/game";
import { type GuildVersion, realmLabel, VERSION_INFO } from "@/lib/game-versions";
import { fromOklch, shiftLightness, toOklch } from "@/lib/tabard/color";
import type { TabardConfig } from "@/lib/tabard/config";
import type { GuildLook } from "@/lib/tabard/look";
import { computeTheme, type SelectableBase } from "@/lib/tabard/theme";
import { svgToString } from "@/lib/tabard/svg-string";
import { crestImages } from "@/server/tabard-tint";

/** The crest's width over its height (its viewBox is 100 by 120). */
const ASPECT = 100 / 120;

/**
 * The tabard as SVG markup at the detail the site would show for this rendered height, with the emblem from
 * `crestImages` (a tinted data URI).
 */
export function tabardSvg(tabard: TabardConfig, height: number, images: CrestImages, detail = detailForWidth(height * ASPECT)) {
  return svgToString(<TabardArt tabard={tabard} detail={detail} width={height * ASPECT} height={height} images={images} />);
}

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/**
 * The crest `height` pixels tall for satori: the banner as an SVG image with the tinted emblem laid over it as its own
 * image, since an image inside an SVG image isn't drawn.
 */
async function CrestPicture({ tabard, height, style }: { tabard: TabardConfig; height: number; style?: React.CSSProperties }) {
  const width = height * ASPECT;
  const detail = detailForWidth(width);
  const { emblem } = await crestImages(tabard);
  const [x, y, w, h] = emblemRect(detail).map((v) => (v * height) / 120) as [number, number, number, number];
  return (
    <div style={{ display: "flex", position: "relative", width, height, ...style }}>
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={dataUri(tabardSvg(tabard, height, { mode: "bare" }, detail))} width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }} />
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={emblem} width={w} height={h} style={{ position: "absolute", left: x, top: y }} />
    </div>
  );
}

/** The site colours the images use, so a guild's icons and preview match its theme. */
function palette(look: GuildLook) {
  const theme = computeTheme(look.tabard, look.base === "order" ? "tome" : (look.base as SelectableBase), look.overrides);
  const v = theme.vars;
  return { ink: v["--color-ink"]!, glow: v["--theme-glow"]!, gold: v["--color-gold"]!, goldDim: v["--color-gold-dim"]!, bone: v["--color-bone"]!, accent: v["--color-crimson-bright"]!, line: v["--color-line"]! };
}

type Fonts = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>["fonts"];

async function png(element: React.ReactElement, width: number, height: number, fonts?: Fonts) {
  const res = new ImageResponse(element, { width, height, fonts });
  return Buffer.from(await res.arrayBuffer());
}

/** The crest filling the height of a transparent square. */
export async function crestIcon(look: GuildLook, px: number) {
  return png(
    <div style={{ display: "flex", width: px, height: px, alignItems: "center", justifyContent: "center" }}>
      {await CrestPicture({ tabard: look.tabard, height: px })}
    </div>,
    px,
    px,
  );
}

/** The crest centred on a solid tile at `fill` of its height (apple touch, maskable and Discord icons). */
export async function paddedIcon(look: GuildLook, px: number, fill: number) {
  const c = palette(look);
  const h = px * fill;
  return png(
    <div
      style={{
        display: "flex",
        width: px,
        height: px,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: c.ink,
        backgroundImage: `radial-gradient(circle at 50% 50%, ${c.glow}73 0%, ${c.glow}00 70%)`,
      }}
    >
      {await CrestPicture({ tabard: look.tabard, height: h })}
    </div>,
    px,
    px,
  );
}

/** A .ico holding PNG images (supported by every current browser). */
export function ico(images: { px: number; data: Buffer }[]) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ px, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(px >= 256 ? 0 : px, e);
    header.writeUInt8(px >= 256 ? 0 : px, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

export async function faviconIco(look: GuildLook) {
  const images = await Promise.all([16, 32, 48].map(async (px) => ({ px, data: await crestIcon(look, px) })));
  return ico(images);
}

type FontFace = { name: string; data: Buffer; weight: 400 | 700; style: "normal" };
let fonts: Promise<FontFace[]> | null = null;
function cinzel() {
  const faces = [
    ["Cinzel", "Cinzel-Regular.ttf", 400],
    ["Cinzel", "Cinzel-Bold.ttf", 700],
    ["Cinzel Decorative", "CinzelDecorative-Bold.ttf", 700],
  ] as const;
  fonts ??= Promise.all(
    faces.map(async ([name, file, weight]) => ({
      name,
      data: await readFile(path.join(process.cwd(), "scripts/fonts", file)),
      weight,
      style: "normal" as const,
    })),
  );
  return fonts;
}

const pngUri = (data: Buffer) => `data:image/png;base64,${data.toString("base64")}`;
const publicFiles = new Map<string, Promise<string>>();
/** A file under public/ as a data URI, read once (they ship with the route; see next.config.ts). */
function publicPng(rel: string) {
  let uri = publicFiles.get(rel);
  if (!uri) {
    uri = readFile(path.join(process.cwd(), "public", rel)).then(pngUri);
    publicFiles.set(rel, uri);
  }
  return uri;
}

/** What a guild's link preview says besides its name. Region, ruleset and verification are optional. */
export interface PreviewFacts {
  name: string;
  motto: string | null;
  region?: Region | null;
  faction: Faction | null;
  ruleset?: Ruleset | null;
  /** Drawn for versions other than WoW: Forever, with the realm in place of the region. */
  gameVersion?: GuildVersion | null;
  realmSlug?: string | null;
  recruiting: boolean;
  verified: boolean;
  /** The guild's public host, e.g. `osm.guildbook.io` or its custom domain. */
  host: string;
  /** A page title shown as a small eyebrow above the name (Charter, Roster...). */
  eyebrow?: string | null;
}

interface PreviewPalette {
  ink: string;
  glow: string;
  trim: string;
  trimTop: string;
  accent: string;
  bone: string;
  muted: string;
}

/** The Order's crimson and gold (globals.css and its static brand set). */
const ORDER_PREVIEW: PreviewPalette = {
  ink: "#0b0908",
  glow: "#7a1020",
  trim: "#c9a44c",
  trimTop: "#f2dc98",
  accent: "#c8283f",
  bone: "#ece4d4",
  muted: "#a39888",
};

/**
 * Link previews are always a dark card: chat apps and feeds show them on both light and dark backgrounds, and a
 * crest glowing on ink reads at thumbnail size where cream parchment washes out. Parchment guilds take the dark
 * tome surfaces (their tabard colours re-clamped for contrast there); modern guilds keep their slate.
 */
function previewPalette(look: GuildLook): PreviewPalette {
  if (look.base === "order") return ORDER_PREVIEW;
  const theme = computeTheme(look.tabard, look.base === "modern" ? "modern" : "tome", look.overrides);
  const v = theme.vars;
  const glow = toOklch(v["--theme-glow"]!);
  const trim = v["--color-gold"]!;
  return {
    ink: v["--color-ink"]!,
    glow: fromOklch({ ...glow, l: Math.min(0.5, Math.max(0.34, glow.l)) }),
    trim,
    trimTop: shiftLightness(trim, 0.12),
    accent: v["--color-crimson-bright"]!,
    bone: v["--color-bone"]!,
    muted: v["--color-muted"]!,
  };
}

/** Faint gold grain over the ink, like the X header's. */
const GRAIN = dataUri(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.79 0 0 0 0 0.64 0 0 0 0 0.3 0 0 0 0.05 0"/></filter><rect width="1200" height="630" filter="url(#g)"/></svg>`,
);

const seal = (fill: string, check: string) =>
  dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="44" height="44"><path d="M8 .8l1.6 1.3 2-.4.8 1.9 1.9.8-.4 2L15.2 8l-1.3 1.6.4 2-1.9.8-.8 1.9-2-.4L8 15.2l-1.6-1.3-2 .4-.8-1.9-1.9-.8.4-2L.8 8l1.3-1.6-.4-2 1.9-.8.8-1.9 2 .4Z" fill="${fill}"/><path d="m5.2 8.2 1.9 1.9 3.8-4" fill="none" stroke="${check}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );

const globe = (stroke: string) =>
  dataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="44" height="44"><path d="M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5ZM1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.55 8 14.25M8 1.75C6.2 3.45 5.3 5.55 5.3 8s.9 4.55 2.7 6.25M2.8 4.75h10.4M2.8 11.25h10.4" fill="none" stroke="${stroke}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  );

/** Cinzel Decorative Bold advance widths at 100px (measured with resvg), to fit names to the column. */
const ADVANCE: Record<string, number> = {
  ...Object.fromEntries([..."0123456789"].map((ch, i) => [ch, [70, 39, 62, 57, 63, 56, 64, 55, 61, 64][i]!])),
  ...Object.fromEntries([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((ch, i) => [ch, [71, 69, 81, 85, 67, 66, 84, 85, 46, 39, 76, 42, 98, 85, 90, 69, 90, 73, 62, 72, 81, 73, 97, 74, 68, 65][i]!])),
  ...Object.fromEntries([..."abcdefghijklmnopqrstuvwxyz"].map((ch, i) => [ch, [72, 67, 77, 81, 63, 60, 80, 86, 39, 39, 76, 61, 96, 87, 85, 65, 86, 73, 59, 67, 83, 74, 98, 74, 71, 67][i]!])),
  "'": 21,
  "-": 39,
  ",": 22,
  ".": 21,
  " ": 26,
};
const NAME_COLUMN = 556;

/** How many lines `name` wraps to at `size` in the name column (Infinity if one word overflows). */
function lineCount(name: string, size: number) {
  const width = (s: string) => ([...s].reduce((sum, ch) => sum + (ADVANCE[ch] ?? 75), 0) * size) / 100;
  const max = NAME_COLUMN * 0.96;
  let lines = 1;
  let line = "";
  for (const word of name.split(/\s+/).filter(Boolean)) {
    if (width(word) > max) return Infinity;
    const next = line ? `${line} ${word}` : word;
    if (width(next) <= max) line = next;
    else {
      lines++;
      line = word;
    }
  }
  return lines;
}

/** The largest title size that keeps the name on one line, else on two; very long names clamp at the smallest. */
function nameSize(name: string) {
  for (const size of [84, 76, 68]) if (lineCount(name, size) === 1) return size;
  for (const size of [68, 62, 56, 50, 44]) if (lineCount(name, size) <= 2) return size;
  return 40;
}

function Diamond({ color, size }: { color: string; size: number }) {
  return <div style={{ width: size, height: size, backgroundColor: color, transform: "rotate(45deg)" }} />;
}

function Pill({ c, children }: { c: PreviewPalette; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        height: 40,
        padding: "0 14px",
        borderRadius: 20,
        border: `1px solid ${c.trim}59`,
        backgroundColor: `${c.ink}cc`,
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 1.4,
        textTransform: "uppercase",
        color: c.bone,
      }}
    >
      {children}
    </div>
  );
}

const FACTION_EDGE: Record<Faction, string> = { alliance: "#3b5ca8", horde: "#a83b3b" };

/**
 * The 1200 by 630 link preview: the crest large on the left in a glow of the tabard's colour, the guild's name,
 * motto and a row of facts on the right, and its host at the foot. The Order keeps its locked crest and colours.
 */
export async function linkPreview(look: GuildLook, guild: PreviewFacts) {
  const c = previewPalette(look);
  const order = look.base === "order";
  const crestPx = 440;
  const crest = order
    ? await publicPng("brand/osm/icon-512.png")
    : await CrestPicture({ tabard: look.tabard, height: crestPx, style: { position: "absolute", left: 310 - (crestPx * ASPECT) / 2, top: (630 - crestPx) / 2 } });
  const faction = guild.faction ? await publicPng(`icons/factions/${guild.faction}.png`) : null;
  const size = nameSize(guild.name);
  const column = { position: "absolute", left: 580, width: NAME_COLUMN } as const;
  return png(
    <div
      style={{
        display: "flex",
        position: "relative",
        width: 1200,
        height: 630,
        backgroundColor: c.ink,
        backgroundImage: [
          "radial-gradient(ellipse at 50% 50%, #00000000 55%, #0000008c 100%)",
          `radial-gradient(circle at 26% 50%, ${c.glow}b3 0%, ${c.glow}4d 22%, ${c.glow}00 46%)`,
          `radial-gradient(ellipse at 80% 0%, ${c.trim}24 0%, ${c.trim}00 55%)`,
        ].join(", "),
        fontFamily: "Cinzel",
        color: c.bone,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
      <img src={GRAIN} width={1200} height={630} style={{ position: "absolute", left: 0, top: 0 }} />
      <div style={{ position: "absolute", left: 24, top: 24, right: 24, bottom: 24, borderRadius: 6, border: `1px solid ${c.trim}40` }} />
      {typeof crest === "string" ? (
        // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
        <img src={crest} width={crestPx} height={crestPx} style={{ position: "absolute", left: 310 - crestPx / 2, top: (630 - crestPx) / 2 }} />
      ) : (
        crest
      )}
      <div style={{ ...column, top: 60, bottom: 110, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {guild.eyebrow && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18, fontSize: 19, fontWeight: 700, letterSpacing: 7, color: c.trim, textTransform: "uppercase" }}>
            <Diamond color={c.trim} size={7} />
            {guild.eyebrow}
          </div>
        )}
        <div
          style={{
            display: "block",
            fontFamily: "Cinzel Decorative",
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1.14,
            lineClamp: 2,
            color: "transparent",
            backgroundImage: `linear-gradient(180deg, ${c.trimTop}, ${c.trim})`,
            backgroundClip: "text",
          }}
        >
          {guild.name}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 26, marginBottom: guild.motto ? 24 : 34 }}>
          <Diamond color={c.trim} size={8} />
          <div style={{ width: 300, height: 1.5, backgroundImage: `linear-gradient(90deg, ${c.trim}, ${c.trim}00)` }} />
        </div>
        {guild.motto && (
          <div
            style={{
              display: "block",
              fontSize: 24,
              fontWeight: 700,
              letterSpacing: 7,
              textTransform: "uppercase",
              color: c.accent,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginBottom: 34,
            }}
          >
            {guild.motto}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {guild.gameVersion && guild.gameVersion !== "forever" && <Pill c={c}>{VERSION_INFO[guild.gameVersion].label}</Pill>}
          {guild.gameVersion && guild.realmSlug ? (
            <Pill c={c}>
              {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
              <img src={globe(c.trim)} width={20} height={20} />
              {realmLabel(guild.gameVersion, guild.realmSlug, guild.region ?? undefined)}
            </Pill>
          ) : (
            guild.region && (
              <Pill c={c}>
                {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
                <img src={globe(c.trim)} width={20} height={20} />
                {REGION_LABELS[guild.region]}
              </Pill>
            )
          )}
          {(guild.faction || guild.ruleset) && (
            <Pill c={c}>
              {guild.faction && faction && (
                // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
                <img src={faction} width={22} height={22} style={{ borderRadius: 4, border: `1px solid ${FACTION_EDGE[guild.faction]}` }} />
              )}
              {guild.faction && <div style={{ display: "flex" }}>{FACTION_LABELS[guild.faction]}</div>}
              {guild.faction && guild.ruleset && <Diamond color={`${c.trim}b3`} size={5} />}
              {guild.ruleset && <div style={{ display: "flex" }}>{RULESET_INFO[guild.ruleset].label}</div>}
            </Pill>
          )}
          {guild.recruiting && (
            <Pill c={c}>
              <div style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: "#5fd08a", boxShadow: "0 0 8px #5fd08a" }} />
              Reclutando
            </Pill>
          )}
          {guild.verified && (
            <Pill c={c}>
              {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
              <img src={seal(c.trim, c.ink)} width={22} height={22} />
              Verificada
            </Pill>
          )}
        </div>
      </div>
      <div style={{ ...column, bottom: 54, display: "flex", fontSize: 18, letterSpacing: 3, color: c.muted }}>{guild.host}</div>
    </div>,
    1200,
    630,
    await cinzel(),
  );
}
