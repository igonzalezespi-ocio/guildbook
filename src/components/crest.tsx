"use client";

// Must stay a client component: server `useId` values restart with each RSC request, so a crest rendered on
// navigation could reuse the gradient IDs of one already on the page (see rank-insignia.tsx).
import clsx from "clsx";
import { useId } from "react";

type Pt = [number, number];
/** `full` from 64px wide (rod, rings, double border), `mark` for header-sized marks, `tiny` for favicons (20px or below). */
export type CrestDetail = "full" | "mark" | "tiny";

const OUTLINE = "#1a0b0d";
const f = (n: number) => (Math.abs(n) < 0.005 ? "0" : n.toFixed(2));
const pt = ([x, y]: Pt) => `${f(x)} ${f(y)}`;

/**
 * Gradient ids are `${p}-gold` and so on. Each on-page crest needs its own prefix: a `url(#…)` resolves to the first
 * element with that id in the document, and gradients inside a hidden subtree (a closed menu) don't paint.
 */
function Defs({ p }: { p: string }) {
  return (
    <defs>
      <linearGradient id={`${p}-gold`} x1="0" y1="0" x2="0.45" y2="1">
        <stop offset="0" stopColor="#fff1b8" />
        <stop offset="0.35" stopColor="#ecc863" />
        <stop offset="0.72" stopColor="#c09432" />
        <stop offset="1" stopColor="#8a6619" />
      </linearGradient>
      <linearGradient id={`${p}-white`} x1="0" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="0.55" stopColor="#f3f5f8" />
        <stop offset="1" stopColor="#d3d9e2" />
      </linearGradient>
      <radialGradient id={`${p}-field`} cx="0.4" cy="0.3" r="0.85">
        <stop offset="0" stopColor="#c42a44" />
        <stop offset="0.5" stopColor="#931527" />
        <stop offset="1" stopColor="#4f0a15" />
      </radialGradient>
      <linearGradient id={`${p}-fold`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity="0.28" />
        <stop offset="0.18" stopColor="#000" stopOpacity="0" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0.06" />
        <stop offset="0.82" stopColor="#000" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.32" />
      </linearGradient>
    </defs>
  );
}

/** Rotates an upward-pointing shape about `c` by quarter turns. */
const turn = (c: Pt, q: number) => ([x, y]: Pt): Pt => {
  const [cos, sin] = [[1, 0], [0, 1], [-1, 0], [0, -1]][q];
  return [c[0] + x * cos - y * sin, c[1] + x * sin + y * cos];
};

/**
 * A cross pattee: arms flare along concave curves from a square waist (`waist` half-width) to straight ends
 * `r` from the center and `end` half-width, like the in-game premade cross emblem.
 */
function crossPattee(c: Pt, r: number, waist: number, end: number) {
  let d = "";
  for (let q = 0; q < 4; q++) {
    const m = turn(c, q);
    const start = m([-waist, -waist]);
    d +=
      (q === 0 ? `M${pt(start)}` : `L${pt(start)}`) +
      `C${pt(m([-waist * 1.05, -r * 0.62]))} ${pt(m([-end * 0.8, -r * 0.9]))} ${pt(m([-end, -r]))}` +
      `L${pt(m([end, -r]))}` +
      `C${pt(m([end * 0.8, -r * 0.9]))} ${pt(m([waist * 1.05, -r * 0.62]))} ${pt(m([waist, -waist]))}`;
  }
  return `${d}Z`;
}

/** The shaded half of each arm (right of its centerline), for a struck-metal bevel. */
function crossFacets(c: Pt, r: number, waist: number, end: number) {
  let d = "";
  for (let q = 0; q < 4; q++) {
    const m = turn(c, q);
    d +=
      `M${pt(c)}L${pt(m([0, -r]))}L${pt(m([end, -r]))}` +
      `C${pt(m([end * 0.8, -r * 0.9]))} ${pt(m([waist * 1.05, -r * 0.62]))} ${pt(m([waist, -waist]))}Z`;
  }
  return d;
}

/** A banner with a swallowtail foot: `notch` is how far the notch rises above the tail tips. */
function banner(x1: number, y1: number, x2: number, y2: number, notch: number) {
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1}H${x2}V${y2}L${mid} ${y2 - notch}L${x1} ${y2}Z`;
}

/** The same banner inset by `k` on every side (the slanted foot edges move perpendicular to themselves). */
function insetBanner(x1: number, y1: number, x2: number, y2: number, notch: number, k: number) {
  const half = (x2 - x1) / 2;
  const slope = notch / half;
  const drop = k * Math.hypot(1, slope);
  const [ix1, ix2] = [x1 + k, x2 - k];
  const tip = y2 - drop - slope * k;
  const notchY = y2 - notch - drop;
  return `M${f(ix1)} ${f(y1 + k)}H${f(ix2)}V${f(tip)}L${f((x1 + x2) / 2)} ${f(notchY)}L${f(ix1)} ${f(tip)}Z`;
}

function Full({ p }: { p: string }) {
  const [x1, y1, x2, y2, notch] = [15, 15, 85, 116, 20];
  const center: Pt = [50, 55];
  return (
    <g data-detail="full">
      <path d="M8 6.2 H92 A2.8 2.8 0 0 1 92 11.8 H8 A2.8 2.8 0 0 1 8 6.2 Z" fill={`url(#${p}-gold)`} stroke={OUTLINE} strokeWidth={1.1} />
      {[4.5, 95.5].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={9} r={4.2} fill={`url(#${p}-gold)`} stroke={OUTLINE} strokeWidth={1.1} />
          <circle cx={cx - 1.2} cy={7.8} r={1.2} fill="#fff" opacity={0.55} />
        </g>
      ))}
      {[26, 50, 74].map((cx) => (
        <rect key={cx} x={cx - 4} y={4.5} width={8} height={13} rx={1.5} fill="#7a1020" stroke={OUTLINE} strokeWidth={1} />
      ))}

      <path d={banner(x1, y1, x2, y2, notch)} fill={`url(#${p}-gold)`} stroke={OUTLINE} strokeWidth={1.6} strokeLinejoin="miter" />
      <path d={insetBanner(x1, y1, x2, y2, notch, 5)} fill={`url(#${p}-field)`} stroke={OUTLINE} strokeWidth={1} />
      <path d={insetBanner(x1, y1, x2, y2, notch, 5)} fill={`url(#${p}-fold)`} />
      <path d={insetBanner(x1, y1, x2, y2, notch, 8)} fill="none" stroke="#e6c46a" strokeWidth={0.8} opacity={0.75} />
      <path d={`M${x1 + 5} ${y1 + 5}H${x2 - 5}V${y1 + 12}C${x2 - 25} ${y1 + 8} ${x1 + 25} ${y1 + 8} ${x1 + 5} ${y1 + 12}Z`} fill="#fff" opacity={0.08} />

      <path d={crossPattee(center, 25, 4.6, 11.5)} fill={`url(#${p}-white)`} stroke={OUTLINE} strokeWidth={1.4} strokeLinejoin="round" />
      <path d={crossFacets(center, 25, 4.6, 11.5)} fill="#5b6b82" opacity={0.2} />
    </g>
  );
}

function Mark({ p }: { p: string }) {
  const [x1, y1, x2, y2, notch] = [9, 3, 91, 117, 22];
  return (
    <g data-detail="mark">
      <path d={banner(x1, y1, x2, y2, notch)} fill={`url(#${p}-gold)`} stroke={OUTLINE} strokeWidth={2.2} />
      <path d={insetBanner(x1, y1, x2, y2, notch, 8)} fill={`url(#${p}-field)`} stroke={OUTLINE} strokeWidth={1.6} />
      <path d={crossPattee([50, 50], 29, 6, 14)} fill={`url(#${p}-white)`} stroke={OUTLINE} strokeWidth={2} strokeLinejoin="round" />
      <path d={crossFacets([50, 50], 29, 6, 14)} fill="#5b6b82" opacity={0.16} />
    </g>
  );
}

function Tiny({ p }: { p: string }) {
  const [x1, y1, x2, y2, notch] = [8, 2, 92, 118, 24];
  return (
    <g data-detail="tiny">
      <path d={banner(x1, y1, x2, y2, notch)} fill={`url(#${p}-gold)`} stroke={OUTLINE} strokeWidth={3} />
      <path d={insetBanner(x1, y1, x2, y2, notch, 10)} fill="#a0182f" stroke={OUTLINE} strokeWidth={2.4} />
      <path d={crossPattee([50, 49], 30, 8, 15)} fill="#f7f8fa" stroke={OUTLINE} strokeWidth={2.8} strokeLinejoin="round" />
    </g>
  );
}

const DETAILS = { full: Full, mark: Mark, tiny: Tiny } as const;

/** The guild tabard as a standalone SVG document at one detail level (used by the brand asset script). */
export function CrestArt({ detail, width, height }: { detail: CrestDetail; width?: number; height?: number }) {
  const Detail = DETAILS[detail];
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width={width} height={height}>
      <Defs p="crest" />
      <Detail p="crest" />
    </svg>
  );
}

/**
 * The guild crest: the Order's tabard, a crimson swallowtail banner with a gold border and a white cross pattee.
 * All three detail levels share one SVG; the box's rendered width picks one (see `.crest` in globals.css).
 */
export function Crest({ className = "h-24 w-20" }: { className?: string }) {
  const p = `crest-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <span className={clsx("crest", className)}>
      <svg viewBox="0 0 100 120" role="img" aria-label="Escudo de la Order of Saint Michael">
        <Defs p={p} />
        <Tiny p={p} />
        <Mark p={p} />
        <Full p={p} />
      </svg>
    </span>
  );
}
