import { FactionIcon } from "@/components/faction-icon";
import type { ListboxOption } from "@/lib/listbox";
import { FACTION_LABELS, FACTIONS, ROLE_LABELS, ROLES, specLabel } from "@/lib/game";

/** Options shared by the listboxes that pick a faction or raid role. */
export const FACTION_OPTIONS: ListboxOption[] = FACTIONS.map((f) => ({
  value: f,
  label: FACTION_LABELS[f],
  icon: <FactionIcon faction={f} size={18} decorative />,
}));

export const ROLE_OPTIONS: ListboxOption[] = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export const plainOptions = (values: readonly string[]): ListboxOption[] => values.map((v) => ({ value: v, label: v }));
/** Spec options: the stored value stays the English key, the label is the Spanish name. */
export const specOptions = (specs: readonly string[]): ListboxOption[] => specs.map((v) => ({ value: v, label: specLabel(v) }));
