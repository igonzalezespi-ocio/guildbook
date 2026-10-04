"use client";

import clsx from "clsx";
import { useId, useMemo, useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { CrestToneFilter } from "@/components/tabard-art";
import { TabardCrest, tabardColors } from "@/components/tabard-crest";
import { VerifiedMark } from "@/components/ui";
import { contrast } from "@/lib/tabard/color";
import type { TabardConfig } from "@/lib/tabard/config";
import { CREST_EMBLEMS, crestEmblem, emblemSrc } from "@/lib/tabard/crest";
import { BACKGROUND_COLORS, BORDER_COLORS, EMBLEM_COLORS, type Swatch } from "@/lib/tabard/palette";
import {
  AA_TEXT,
  BASE_STYLES,
  computeTheme,
  type Role,
  ROLES,
  SELECTABLE_BASE_IDS,
  type SelectableBase,
  type ThemeOverrides,
  tabardSources,
  tabardWarnings,
  themeCss,
  themeWarnings,
} from "@/lib/tabard/theme";
import type { ActionResult } from "@/server/action-types";

const PREVIEW_SIZES = [16, 32, 44, 80, 128, 176];
const ROLE_NAMES: Record<Role, { label: string; from: string }> = {
  primary: { label: "Principal", from: "fondo" },
  trim: { label: "Ribete", from: "borde" },
  highlight: { label: "Realce", from: "emblema" },
};

function SwatchGrid({ label, swatches, value, onChange }: { label: string; swatches: readonly Swatch[]; value: number; onChange: (id: number) => void }) {
  const current = swatches[value];
  return (
    <fieldset>
      <legend className="field-label">
        {label} <span className="font-normal tracking-normal text-muted normal-case">{current?.name}</span>
      </legend>
      <div role="radiogroup" aria-label={label} onKeyDown={onRadioKeys} className="flex flex-wrap gap-1.5">
        {swatches.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={s.id === value}
            tabIndex={s.id === value ? 0 : -1}
            aria-label={s.name}
            title={s.name}
            onClick={() => onChange(s.id)}
            className={clsx(
              "h-7 w-7 rounded border border-black/40 outline-offset-2 transition-transform hover:scale-110",
              s.id === value && "outline-2 outline-gold",
            )}
            style={{ backgroundColor: s.hex }}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** The thumbnails' tint filter. The SVG is zero-sized but rendered, so its filter paints. */
function TintFilter({ id, hex }: { id: string; hex: string }) {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <CrestToneFilter id={id} hex={hex} />
    </svg>
  );
}

const tileClass = (selected: boolean) =>
  clsx(
    "relative rounded border p-1 outline-offset-2 transition-colors focus-visible:outline-2 focus-visible:outline-gold",
    selected ? "border-gold bg-gold/10" : "border-line hover:border-gold-dim",
  );

/** Moves focus and selection through a radiogroup of tiles with the arrow keys, Home and End. */
function onRadioKeys(e: React.KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const at = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
  const next = e.key === "Home" ? 0 : e.key === "End" ? radios.length - 1 : (at + step + radios.length) % radios.length;
  radios[next]?.focus();
  radios[next]?.click();
}

function EmblemPicker({ tabard, onChange }: { tabard: TabardConfig; onChange: (emblemId: number) => void }) {
  const [query, setQuery] = useState("");
  const filter = `emblem-tint-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const c = tabardColors(tabard);
  const q = query.trim().toLowerCase();
  const shown = CREST_EMBLEMS.filter((e) => !q || e.name.toLowerCase().includes(q) || String(e.id) === q || e.tags.some((t) => t.includes(q)));
  const selected = tabard.emblemId;
  const selectedShown = shown.some((e) => e.id === selected);
  return (
    <fieldset>
      <legend className="field-label">
        Emblema <span className="font-normal tracking-normal text-muted normal-case">{crestEmblem(selected)?.name}</span>
      </legend>
      <TintFilter id={filter} hex={c.emblem} />
      <input
        type="search"
        className="field mb-2"
        placeholder="Busca emblemas: león, calavera, lobo..."
        aria-label="Buscar emblemas"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div
        role="radiogroup"
        aria-label="Emblema"
        onKeyDown={onRadioKeys}
        className="grid max-h-80 grid-cols-5 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-7 @3xl:grid-cols-6 @5xl:grid-cols-8"
      >
        {shown.map((e, i) => {
          const on = e.id === selected;
          return (
            <button
              key={e.id}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on || (!selectedShown && i === 0) ? 0 : -1}
              aria-label={e.name}
              title={e.name}
              onClick={() => onChange(e.id)}
              className={tileClass(on)}
            >
              <span className="block aspect-square w-full rounded-sm" style={{ backgroundColor: c.field }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={emblemSrc(e.id)} alt="" loading="lazy" decoding="async" className="block h-full w-full" style={{ filter: `url(#${filter})` }} />
              </span>
            </button>
          );
        })}
        {shown.length === 0 && <p className="col-span-full py-4 text-center text-sm text-muted italic">Ningún emblema coincide.</p>}
      </div>
      <p className="mt-1.5 text-xs text-muted">
        {CREST_EMBLEMS.length} emblemas del diseñador de tabardos del juego. Usa las flechas para moverte por ellos.
      </p>
    </fieldset>
  );
}

function SamplePage({ tabard, name, motto }: { tabard: TabardConfig; name: string; motto: string | null }) {
  return (
    <div className="tabard-preview overflow-hidden rounded border border-line" data-testid="theme-preview">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-ink/90 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <TabardCrest tabard={tabard} label={`Tabardo de ${name}`} className="h-10 w-8 shrink-0" />
          <span className="truncate font-display text-sm font-bold tracking-widest text-gold uppercase">{name}</span>
        </span>
        <span className="hidden items-center gap-4 font-display text-xs tracking-wider sm:flex">
          <span className="border-b border-gold py-1 text-gold">Reglamento</span>
          <span className="py-1 text-bone">Plantilla</span>
          <span className="btn btn-primary btn-sm">Únete</span>
        </span>
      </div>
      <div className="space-y-4 p-4">
        <div className="text-center">
          <h1 className="font-title text-2xl text-gold sm:text-3xl" data-testid="preview-heading">
            {name}
          </h1>
          {motto && <p className="mt-1 font-display text-xs tracking-[0.35em] text-crimson-bright uppercase">{motto}</p>}
          <hr className="rule-gold mx-auto mt-3 w-40" />
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <span className="btn btn-primary" data-testid="preview-primary-button">
              Solicitar ingreso
            </span>
            <span className="btn btn-ghost">Leer el reglamento</span>
          </div>
        </div>
        <section className="panel p-4">
          <h2 className="mb-2 text-lg font-semibold text-gold">Horario de bandas</h2>
          <p className="text-sm text-bone/90">
            Martes y jueves, de 20:00 a 23:00. <strong className="text-highlight">Trae frascos.</strong> Los oficiales
            publican las asignaciones la noche anterior.
          </p>
          <p className="mt-2 flex items-center gap-2 text-sm text-muted">
            <VerifiedMark decorative size={16} /> Verificado con Battle.net
            <span className="text-highlight">★</span>
            <span className="link">Ver la plantilla</span>
          </p>
        </section>
      </div>
    </div>
  );
}

function ContrastTable({ theme }: { theme: ReturnType<typeof computeTheme> }) {
  const page = BASE_STYLES[theme.base].surfaces.ink;
  const rows = [
    ...ROLES.map((r) => ({ label: ROLE_NAMES[r].label, value: theme.roles[r].value, against: page, source: theme.roles[r].source })),
    { label: "Texto de botón", value: theme.onPrimary, against: theme.primaryFill.value, source: theme.primaryFill.source },
  ];
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-gold-dim">
        <tr>
          <th className="py-1 font-normal">Uso</th>
          <th className="py-1 font-normal">Tabardo</th>
          <th className="py-1 font-normal">En el sitio</th>
          <th className="py-1 text-right font-normal">Contraste</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const ratio = contrast(r.value, r.against);
          return (
            <tr key={r.label} className="border-t border-line">
              <td className="py-1.5 text-bone">{r.label}</td>
              <td className="py-1.5">
                <span className="inline-block h-4 w-4 rounded-sm border border-black/40 align-middle" style={{ backgroundColor: r.source }} />
              </td>
              <td className="py-1.5 font-mono text-muted">
                <span className="mr-1.5 inline-block h-4 w-4 rounded-sm border border-black/40 align-middle" style={{ backgroundColor: r.value }} />
                {r.value}
              </td>
              <td className={clsx("py-1.5 text-right font-mono", ratio >= AA_TEXT ? "text-emerald-300" : "text-red-300")}>
                {ratio.toFixed(1)}:1
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function TabardBuilder({
  action,
  initial,
  guild,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  initial: { tabard: TabardConfig; base: SelectableBase; overrides: ThemeOverrides };
  guild: { name: string; motto: string | null };
}) {
  const [tabard, setTabard] = useState(initial.tabard);
  const [base, setBase] = useState(initial.base);
  const [overrides, setOverrides] = useState<ThemeOverrides>(initial.overrides);
  const set = (patch: Partial<TabardConfig>) => setTabard((t) => ({ ...t, ...patch }));
  const theme = useMemo(() => computeTheme(tabard, base, overrides), [tabard, base, overrides]);
  const warnings = [...tabardWarnings(tabard), ...themeWarnings(theme)];
  const sources = tabardSources(tabard);

  return (
    <ActionForm action={action} className="@container space-y-6">
      <input type="hidden" name="background" value={tabard.background} />
      <input type="hidden" name="border" value={tabard.border} />
      <input type="hidden" name="borderStyle" value={tabard.borderStyle} />
      <input type="hidden" name="emblemColor" value={tabard.emblemColor} />
      <input type="hidden" name="emblemId" value={tabard.emblemId} />
      <input type="hidden" name="themeBase" value={base} />
      {ROLES.map((r) => (
        <input key={r} type="hidden" name={`override${r[0]!.toUpperCase()}${r.slice(1)}`} value={overrides[r] ?? ""} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: themeCss(theme, ".tabard-preview") }} />

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <SwatchGrid label="Color de fondo" swatches={BACKGROUND_COLORS} value={tabard.background} onChange={(background) => set({ background })} />
          <EmblemPicker tabard={tabard} onChange={(emblemId) => set({ emblemId })} />
          <SwatchGrid label="Color del emblema" swatches={EMBLEM_COLORS} value={tabard.emblemColor} onChange={(emblemColor) => set({ emblemColor })} />
          <SwatchGrid label="Color del borde" swatches={BORDER_COLORS} value={tabard.border} onChange={(border) => set({ border })} />
        </div>

        <div className="space-y-5">
          <div>
            <p className="field-label">Vista previa del escudo</p>
            <div className="flex flex-wrap items-end gap-4 rounded border border-line bg-ink/40 p-3" data-testid="crest-preview">
              {PREVIEW_SIZES.map((px) => (
                <figure key={px} className="flex flex-col items-center gap-1">
                  <span className="inline-flex" style={{ width: px, height: px * 1.2 }}>
                    <TabardCrest tabard={tabard} label={`Tabardo a ${px} píxeles`} className="h-full w-full" />
                  </span>
                  <figcaption className="text-[0.65rem] text-muted">{px}px</figcaption>
                </figure>
              ))}
            </div>
          </div>
          {warnings.length > 0 && (
            <ul className="space-y-1.5" data-testid="theme-warnings">
              {warnings.map((w) => (
                <li
                  key={w.message}
                  className={clsx("rounded border px-3 py-2 text-sm", w.level === "warn" ? "border-crimson text-red-300" : "border-line text-muted")}
                >
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <fieldset>
        <legend className="field-label">Estilo base</legend>
        <div role="radiogroup" aria-label="Estilo base" className="grid gap-2 @lg:grid-cols-3">
          {SELECTABLE_BASE_IDS.map((id) => {
            const b = BASE_STYLES[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={id === base}
                onClick={() => setBase(id)}
                className={clsx("rounded border p-3 text-left transition-colors", id === base ? "border-gold bg-gold/10" : "border-line hover:border-gold-dim")}
              >
                <span className="flex gap-1" aria-hidden>
                  {[b.surfaces.ink, b.surfaces.ink3, b.surfaces.line, b.surfaces.bone].map((c) => (
                    <span key={c} className="h-4 w-4 rounded-sm border border-black/30" style={{ backgroundColor: c }} />
                  ))}
                </span>
                <span className="mt-2 block font-display text-sm font-semibold text-gold">{b.name}</span>
                <span className="mt-1 block text-xs text-muted">{b.description}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <p className="field-label">Página de ejemplo</p>
          <SamplePage tabard={tabard} name={guild.name} motto={guild.motto} />
        </div>
        <div className="space-y-4">
          <div>
            <p className="field-label">Colores del sitio</p>
            <p className="mb-2 text-xs text-muted">
              Los colores del tabardo se ajustan en luminosidad (manteniendo el tono) hasta que el texto cumple WCAG AA
              ({AA_TEXT}:1) en la página.
            </p>
            <ContrastTable theme={theme} />
          </div>
          <fieldset className="space-y-2">
            <legend className="field-label">Colores del sitio a mano</legend>
            <p className="text-xs text-muted">Opcional. Solo cambian la web; el escudo conserva los colores del tabardo.</p>
            {ROLES.map((r) => {
              const on = overrides[r] !== undefined;
              return (
                <div key={r} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex min-w-40 items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-gold"
                      checked={on}
                      onChange={(e) =>
                        setOverrides((o) => {
                          const next = { ...o };
                          if (e.target.checked) next[r] = sources[r];
                          else delete next[r];
                          return next;
                        })
                      }
                    />
                    {ROLE_NAMES[r].label} <span className="text-xs text-muted">(del {ROLE_NAMES[r].from})</span>
                  </label>
                  {on && (
                    <input
                      type="color"
                      aria-label={`${ROLE_NAMES[r].label}: color a mano`}
                      className="h-8 w-12 cursor-pointer rounded border border-line bg-transparent"
                      value={overrides[r]}
                      onChange={(e) => setOverrides((o) => ({ ...o, [r]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton>Guardar tabardo y tema</SubmitButton>
        <FormMessage />
      </div>
    </ActionForm>
  );
}
