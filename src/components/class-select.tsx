"use client";

import { ClassIcon } from "@/components/class-icon";
import { Listbox } from "@/components/listbox";
import { classColor } from "@/components/ui";
import { CLASS_INFO, CLASSES } from "@/lib/game";

export const CLASS_OPTIONS = CLASSES.map((c) => ({
  value: c,
  label: CLASS_INFO[c].label,
  icon: <ClassIcon wowClass={c} size={20} decorative />,
  color: classColor(c),
}));

/** Class listbox with each class's icon and colour. */
export function ClassSelect({ name, className }: { name: string; className?: string }) {
  return <Listbox name={name} aria-label="Clase" options={CLASS_OPTIONS} defaultValue={CLASSES[0]} className={className} />;
}
