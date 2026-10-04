export const ADDON_ICONS = ["scroll", "eye", "bell", "meter", "sigil", "scales", "quill"] as const;
export type AddonIconName = (typeof ADDON_ICONS)[number];

/** `field` is the tile's ground: crimson for the Order's own work, ink for common raiding addons. */
export const ADDON_ICON_INFO: Record<AddonIconName, { label: string; field: "crimson" | "ink" }> = {
  scroll: { label: "Pergamino de asignaciones", field: "crimson" },
  eye: { label: "Ojo vigilante", field: "crimson" },
  bell: { label: "Campana de completas", field: "crimson" },
  meter: { label: "Medidor de daño", field: "ink" },
  sigil: { label: "Sello de aviso", field: "ink" },
  scales: { label: "Balanza del botín", field: "ink" },
  quill: { label: "Pluma y tinta", field: "crimson" },
};

/** Used for addons with no mapping: every addon on the site is written by a member. */
export const FALLBACK_ADDON_ICON: AddonIconName = "quill";

/** Exact slugs, checked first. */
export const ADDON_ICON_BY_SLUG: Record<string, AddonIconName> = {
  "order-assist": "scroll",
  vigil: "eye",
  compline: "bell",
  details: "meter",
  recount: "meter",
  skada: "meter",
  dbm: "sigil",
  "deadly-boss-mods": "sigil",
  bigwigs: "sigil",
  "big-wigs": "sigil",
  rclootcouncil: "scales",
  gargul: "scales",
};

/** Keywords matched against the slug and name when there is no exact slug, so officer-added addons get a fitting icon. */
const KEYWORDS: [RegExp, AddonIconName][] = [
  [/\b(details|recount|skada|meters?|dps|damage)\b/, "meter"],
  [/\b(dbm|bigwigs|boss ?mods?|timers?|warnings?|alerts?)\b/, "sigil"],
  [/\b(loot|gargul|council|dkp|epgp|roll)\b/, "scales"],
  [/\b(assign(ments?)?|checks?|consumables?|roster)\b/, "scroll"],
  [/\b(bells?|reminders?|prayer|feast)\b/, "bell"],
  [/\b(review|performance|deaths?|watch)\b/, "eye"],
];

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function addonIconFor(addon: { slug: string; name: string }): AddonIconName {
  const exact = ADDON_ICON_BY_SLUG[addon.slug.toLowerCase()] ?? ADDON_ICON_BY_SLUG[words(addon.name).replace(/ /g, "-")];
  if (exact) return exact;
  const text = `${words(addon.slug)} ${words(addon.name)}`;
  return KEYWORDS.find(([re]) => re.test(text))?.[1] ?? FALLBACK_ADDON_ICON;
}
