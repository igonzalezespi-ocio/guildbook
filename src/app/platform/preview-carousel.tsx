"use client";

import clsx from "clsx";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";

export interface CarouselSite {
  key: string;
  name: string;
  address: string;
  /** Tabard colours, for the picker's swatch. */
  swatch: { field: string; border: string; emblem: string };
  frame: ReactNode;
  caption: ReactNode;
}

const ROTATE_MS = 6000;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const useReducedMotion = () =>
  useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false);

/**
 * Cycles the home page's guild site preview through a few guild themes, fading between them every few seconds. Rotation
 * pauses while the pointer or focus is inside, stops once a visitor picks a theme or presses pause, and never
 * starts when the visitor prefers reduced motion.
 */
export function PreviewCarousel({ sites }: { sites: CarouselSite[] }) {
  const [active, setActive] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const canRotate = sites.length > 1 && !reducedMotion;
  const rotating = canRotate && !stopped && !hovered && !focused;

  useEffect(() => {
    if (!rotating) return;
    const timer = window.setTimeout(() => setActive((i) => (i + 1) % sites.length), ROTATE_MS);
    return () => window.clearTimeout(timer);
  }, [rotating, active, sites.length]);

  const current = sites[active] ?? sites[0];
  if (!current) return null;

  return (
    <figure
      className="mx-auto max-w-4xl"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
      }}
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-lg border border-line bg-ink-2 shadow-[0_24px_60px_rgb(0_0_0/0.55),0_0_0_1px_rgb(201_164_76/0.08)]"
      >
        <div className="flex items-center gap-3 border-b border-line bg-ink-3 px-4 py-2.5">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
            <span className="h-2.5 w-2.5 rounded-full bg-line" />
          </span>
          <span className="mx-auto flex min-w-0 max-w-sm flex-1 items-center justify-center gap-2 truncate rounded border border-line bg-ink px-3 py-1 font-mono text-xs text-muted">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 shrink-0 text-gold-dim">
              <rect x="4" y="11" width="16" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <span className="truncate" data-testid="preview-address">
              {current.address}
            </span>
          </span>
          <span className="w-10.5" />
        </div>

        <div className="grid">
          {sites.map((site, i) => (
            <div
              key={site.key}
              inert={i !== active}
              className={clsx(
                "col-start-1 row-start-1 transition-opacity motion-reduce:transition-none",
                // Sequenced rather than crossfaded: the outgoing frame is gone before the incoming one starts, so the
                // two sites' text never overlaps. The delay must be at least the fade-out duration.
                i === active ? "opacity-100 delay-200 duration-400 ease-out" : "pointer-events-none opacity-0 duration-200 ease-in",
              )}
            >
              {site.frame}
            </div>
          ))}
        </div>
      </div>

      {sites.length > 1 && (
        <div role="group" aria-label="Ver temas de hermandad" className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {sites.map((site, i) => (
            <button
              key={site.key}
              type="button"
              aria-pressed={i === active}
              onClick={() => {
                setActive(i);
                setStopped(true);
              }}
              className={clsx(
                "flex min-h-9 items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors",
                i === active ? "border-gold-dim bg-gold/10 text-gold" : "border-line text-muted hover:border-gold-dim hover:text-bone",
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: site.swatch.field, boxShadow: `inset 0 0 0 2px ${site.swatch.border}` }}
              >
                <span className="h-1 w-1 rounded-full" style={{ backgroundColor: site.swatch.emblem }} />
              </span>
              <span className="sr-only sm:not-sr-only">{site.name}</span>
              <span className="sr-only"> (tema)</span>
            </button>
          ))}
          {canRotate && (
            <button
              type="button"
              onClick={() => setStopped((s) => !s)}
              aria-label={stopped ? "Reanudar la rotación de temas" : "Pausar la rotación de temas"}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted transition-colors hover:border-gold-dim hover:text-bone"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
                {stopped ? <path d="M8 5v14l11-7z" /> : <path d="M7 5h4v14H7zM13 5h4v14h-4z" />}
              </svg>
            </button>
          )}
        </div>
      )}

      <figcaption aria-live={rotating ? "off" : "polite"} className="mt-3 text-center text-sm text-muted">
        {current.caption}
      </figcaption>
    </figure>
  );
}
