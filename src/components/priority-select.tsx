"use client";

import { Listbox } from "@/components/listbox";
import { PriorityIcon } from "@/components/priority-icon";
import { RECRUITMENT_PRIORITY_LABELS } from "@/lib/game";

const PRIORITIES = ["closed", "low", "medium", "high"] as const;
type Priority = (typeof PRIORITIES)[number];

const OPTIONS = PRIORITIES.map((p) => ({
  value: p,
  label: RECRUITMENT_PRIORITY_LABELS[p] ?? p,
  icon: p === "closed" ? undefined : <PriorityIcon priority={p} size={18} />,
}));

/** Recruitment priority listbox with each open priority's icon. */
export function PrioritySelect({ name, defaultValue = "medium", className }: { name: string; defaultValue?: Priority; className?: string }) {
  return <Listbox name={name} aria-label="Prioridad" options={OPTIONS} defaultValue={defaultValue} className={className} />;
}
