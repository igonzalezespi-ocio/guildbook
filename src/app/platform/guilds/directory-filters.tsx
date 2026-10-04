"use client";

import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { FactionIcon } from "@/components/faction-icon";
import { GameVersionIcon } from "@/components/game-version";
import { Listbox, type ListboxOption } from "@/components/listbox";
import { RegionIcon } from "@/components/region";
import { RulesetIcon } from "@/components/ruleset";
import { FACTION_LABELS, FACTIONS, type Faction, REGION_INFO, REGIONS, type Region, RULESET_INFO, RULESETS, type Ruleset } from "@/lib/game";
import {
  DEFAULT_GUILD_VERSION,
  findRealm,
  realmsFor,
  SUPPORTED_GUILD_VERSIONS,
  type SupportedGuildVersion,
  VERSION_INFO,
} from "@/lib/game-versions";
import { directoryHref, type DirectoryFilter } from "./filters";

const ALL: ListboxOption = { value: "", label: "Cualquiera" };

const VERSION_OPTIONS: ListboxOption[] = SUPPORTED_GUILD_VERSIONS.map((v) => ({
  value: v,
  label: VERSION_INFO[v].label,
  icon: <GameVersionIcon version={v} size={15} className="text-gold-dim" />,
}));

const REGION_OPTIONS: ListboxOption[] = [
  ALL,
  ...REGIONS.map((r) => ({
    value: r,
    label: REGION_INFO[r].label,
    description: REGION_INFO[r].description,
    icon: <RegionIcon size={15} className="text-gold-dim" />,
  })),
];
const FACTION_FILTER_OPTIONS: ListboxOption[] = [
  ALL,
  ...FACTIONS.map((f) => ({ value: f, label: FACTION_LABELS[f], icon: <FactionIcon faction={f} size={16} decorative /> })),
];
const RULESET_OPTIONS: ListboxOption[] = [
  ALL,
  ...RULESETS.map((r) => ({
    value: r,
    label: RULESET_INFO[r].label,
    description: RULESET_INFO[r].description,
    icon: <RulesetIcon ruleset={r} size={15} className="text-gold-dim" />,
  })),
];

/**
 * Game version, region, faction and ruleset (plus realm, for versions with realms) as compact listboxes on one row; a
 * choice navigates to the filtered URL.
 */
export function DirectoryFilters(props: DirectoryFilter) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic<DirectoryFilter>(props);
  const { region, faction, ruleset, realm } = current;
  const version = current.version ?? DEFAULT_GUILD_VERSION;
  const realmOptions: ListboxOption[] = [
    ALL,
    ...realmsFor(version, region).map((r) => ({ value: r.slug, label: r.name, description: `${REGION_INFO[r.region].label}, ${RULESET_INFO[r.ruleset].label}` })),
  ];
  const go = (next: DirectoryFilter) =>
    startTransition(() => {
      setCurrent(next);
      router.push(directoryHref(next), { scroll: false });
    });

  const filters = [
    {
      key: "version",
      label: "Juego",
      options: VERSION_OPTIONS,
      value: version,
      set: (v: string) => go({ ...current, version: v as SupportedGuildVersion, realm: undefined }),
    },
    ...(VERSION_INFO[version].realms
      ? [{ key: "realm", label: "Reino", options: realmOptions, value: realm ?? "", set: (v: string) => go({ ...current, realm: v || undefined }) }]
      : []),
    {
      key: "region",
      label: "Región",
      options: REGION_OPTIONS,
      value: region ?? "",
      set: (v: string) => {
        const next = (v || undefined) as Region | undefined;
        const keepRealm = !next || findRealm(version, realm)?.region === next;
        go({ ...current, region: next, realm: keepRealm ? realm : undefined });
      },
    },
    { key: "faction", label: "Facción", options: FACTION_FILTER_OPTIONS, value: faction ?? "", set: (v: string) => go({ ...current, faction: (v || undefined) as Faction | undefined }) },
    { key: "ruleset", label: "Tipo de reino", options: RULESET_OPTIONS, value: ruleset ?? "", set: (v: string) => go({ ...current, ruleset: (v || undefined) as Ruleset | undefined }) },
  ];

  return (
    <div
      className="mx-auto grid max-w-sm grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:flex sm:max-w-none sm:flex-wrap sm:justify-center sm:gap-x-5"
      aria-busy={pending || undefined}
    >
      {filters.map((f) => (
        <div key={f.key} className="contents sm:flex sm:items-center sm:gap-2">
          <label htmlFor={`directory-${f.key}`} className="text-xs tracking-wider text-gold-dim uppercase">
            {f.label}
          </label>
          <Listbox
            id={`directory-${f.key}`}
            options={f.options}
            value={f.value}
            onChange={f.set}
            size="sm"
            className={f.key === "version" ? "sm:w-48" : "sm:w-40"}
            data-testid={`directory-filter-${f.key}`}
          />
        </div>
      ))}
    </div>
  );
}
