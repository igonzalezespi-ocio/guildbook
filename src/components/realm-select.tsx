"use client";

import { useState } from "react";
import { Listbox, type ListboxOption } from "@/components/listbox";
import { RulesetIcon } from "@/components/ruleset";
import { type Region, REGION_LABELS, RULESET_INFO } from "@/lib/game";
import { findRealm, type GuildVersion, realmsFor } from "@/lib/game-versions";

/**
 * A realm Listbox for versions with realms, with the realm's ruleset shown read-only beneath it: the realm type sets
 * the ruleset. With `region` it lists that region's realms; without, every realm grouped by region.
 */
export function RealmSelect({
  version,
  region,
  name = "realmSlug",
  id = "realmSlug",
  value,
  defaultValue,
  onChange,
  disabled,
}: {
  version: GuildVersion;
  region?: Region;
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? "");
  const current = value ?? uncontrolled;
  const options: ListboxOption[] = realmsFor(version, region).map((r) => ({
    value: r.slug,
    label: r.name,
    description: `${RULESET_INFO[r.ruleset].label} realm`,
    group: region ? undefined : REGION_LABELS[r.region],
    icon: <RulesetIcon ruleset={r.ruleset} size={15} className="text-gold-dim" />,
  }));
  const realm = findRealm(version, current);
  const chosen = realm && (!region || realm.region === region) ? realm : null;

  return (
    <div>
      <Listbox
        id={id}
        name={name}
        options={options}
        value={chosen ? chosen.slug : ""}
        onChange={(v) => {
          setUncontrolled(v);
          onChange?.(v);
        }}
        placeholder="Elige un reino"
        required
        requiredMessage="Elige el reino de tu hermandad"
        disabled={disabled}
        data-testid="realm-select"
      />
      <p className="mt-1.5 flex min-h-5 items-center gap-1.5 text-xs text-muted" data-testid="realm-ruleset">
        {chosen ? (
          <>
            <RulesetIcon ruleset={chosen.ruleset} size={13} className="text-gold-dim" />
            <span>
              Tipo de reino: <span className="text-bone">{RULESET_INFO[chosen.ruleset].label}</span>, según el reino
            </span>
          </>
        ) : (
          "El reino define el tipo de reino."
        )}
      </p>
    </div>
  );
}
