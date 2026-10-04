import clsx from "clsx";
import { REGION_INFO, REGION_LABELS, REGION_TAGS, REGIONS, type Region } from "@/lib/game";

/** A globe: meridian and parallels. */
const GLOBE = "M8 1.75a6.25 6.25 0 1 0 0 12.5 6.25 6.25 0 0 0 0-12.5ZM1.75 8h12.5M8 1.75c1.8 1.7 2.7 3.8 2.7 6.25S9.8 12.55 8 14.25M8 1.75C6.2 3.45 5.3 5.55 5.3 8s.9 4.55 2.7 6.25M2.8 4.75h10.4M2.8 11.25h10.4";

export function RegionIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden className={clsx("shrink-0", className)}>
      <path d={GLOBE} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small region label for cards and lists, alongside `FactionBadge` and `RulesetBadge`. */
export function RegionBadge({ region }: { region: Region }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-ink-2 px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wider text-bone/80 uppercase ring-1 ring-line"
      data-testid="region-badge"
    >
      <RegionIcon size={12} className="text-gold-dim" />
      {REGION_LABELS[region]}
    </span>
  );
}

/** Compact "US" / "EU" tag for a Battle.net character's region in character lists. */
export function RegionTag({ region, className }: { region: Region; className?: string }) {
  return (
    <span
      title={`Región de ${REGION_LABELS[region]}`}
      className={clsx("rounded px-1 text-[0.6rem] font-semibold tracking-wider text-muted ring-1 ring-line", className)}
      data-testid="region-tag"
    >
      {REGION_TAGS[region]}
    </span>
  );
}

/** The Battle.net regions as radio cards, matching `FactionChoice` and `RulesetChoice`. */
export function RegionChoice({
  name = "region",
  defaultValue,
  value,
  onChange,
  disabled,
}: {
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" data-testid="region-choice">
      {REGIONS.map((r) => {
        const info = REGION_INFO[r];
        return (
          <label
            key={r}
            className="relative flex min-h-14 cursor-pointer items-center gap-3 rounded border border-line px-3 py-2 text-sm has-checked:border-gold-dim has-checked:bg-gold/10 has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-gold-dim"
          >
            <input
              type="radio"
              name={name}
              value={r}
              required
              disabled={disabled}
              className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
              {...(value !== undefined
                ? { checked: value === r, onChange: () => onChange?.(r) }
                : { defaultChecked: defaultValue === r })}
            />
            <RegionIcon size={26} className="text-gold" />
            <span className="min-w-0 leading-tight">
              <span className="block font-display tracking-wide text-bone">{info.label}</span>
              <span className="block text-xs text-muted">{info.description}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
