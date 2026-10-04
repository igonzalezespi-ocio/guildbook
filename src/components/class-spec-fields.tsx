"use client";

import { useState } from "react";
import { Field } from "@/components/action-form";
import { CLASS_OPTIONS } from "@/components/class-select";
import { Listbox } from "@/components/listbox";
import { FACTION_OPTIONS, ROLE_OPTIONS, specOptions } from "@/components/select-options";
import { CLASS_INFO, type Faction, type RaidRole, type WowClass } from "@/lib/game";

/**
 * Faction, class, spec and role pickers. Spec options follow the selected class; any class may be either
 * faction. Single-faction guilds hide the faction picker and the server fills it in. `lockedClass` shows the
 * class read-only (it came from Battle.net) while spec and role stay selectable. `idPrefix` keeps element ids unique
 * when another form on the page has these fields too.
 */
export function ClassSpecFields({
  defaults,
  showFaction = true,
  lockedClass,
  idPrefix = "",
}: {
  defaults?: { faction?: Faction; wowClass?: WowClass; spec?: string; role?: RaidRole };
  showFaction?: boolean;
  lockedClass?: WowClass;
  idPrefix?: string;
}) {
  const [chosenClass, setWowClass] = useState<WowClass>(defaults?.wowClass ?? "warrior");
  const wowClass = lockedClass ?? chosenClass;
  const specs = CLASS_INFO[wowClass].specs;
  const [spec, setSpec] = useState<string>(
    defaults?.spec && specs.includes(defaults.spec) ? defaults.spec : (specs[0] ?? ""),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {showFaction && !lockedClass && (
        <Field label="Facción" name="faction" htmlFor={`${idPrefix}faction`}>
          <Listbox id={`${idPrefix}faction`} name="faction" options={FACTION_OPTIONS} defaultValue={defaults?.faction ?? "alliance"} />
        </Field>
      )}
      <Field label="Clase" name="wowClass" htmlFor={`${idPrefix}wowClass`}>
        {lockedClass ? (
          <>
            <input
              id={`${idPrefix}wowClass`}
              className="field cursor-default opacity-90"
              value={CLASS_INFO[lockedClass].label}
              style={{ color: CLASS_INFO[lockedClass].color }}
              readOnly
            />
            <input type="hidden" name="wowClass" value={lockedClass} />
          </>
        ) : (
          <Listbox
            id={`${idPrefix}wowClass`}
            name="wowClass"
            options={CLASS_OPTIONS}
            value={wowClass}
            onChange={(v) => {
              const next = v as WowClass;
              setWowClass(next);
              setSpec(CLASS_INFO[next].specs[0] ?? "");
            }}
          />
        )}
      </Field>
      <Field label="Especialización" name="spec" htmlFor={`${idPrefix}spec`}>
        <Listbox id={`${idPrefix}spec`} name="spec" options={specOptions(specs)} value={spec} onChange={setSpec} />
      </Field>
      <Field label="Rol en banda" name="role" htmlFor={`${idPrefix}role`}>
        <Listbox id={`${idPrefix}role`} name="role" options={ROLE_OPTIONS} defaultValue={defaults?.role ?? "melee"} />
      </Field>
    </div>
  );
}
