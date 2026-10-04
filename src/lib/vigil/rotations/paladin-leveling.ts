import type { AuraDef, RotationModel, SpellDef } from "./types";

const SEALS = [
  ["seal-of-righteousness", "Seal of Righteousness"],
  ["seal-of-the-crusader", "Seal of the Crusader"],
  ["seal-of-command", "Seal of Command"],
  ["seal-of-wisdom", "Seal of Wisdom"],
  ["seal-of-light", "Seal of Light"],
  ["seal-of-justice", "Seal of Justice"],
] as const;

const sealSpells: SpellDef[] = SEALS.map(([key, label]) => ({ key, label, names: [label], gcd: true }));

const sealAuras: AuraDef[] = SEALS.map(([key, label]) => ({
  key,
  label,
  names: [label],
  on: "player",
  group: "seal",
  scored: key === "seal-of-righteousness",
  targetUptime: key === "seal-of-righteousness" ? 0.95 : undefined,
  appliedBy: key,
  durationMs: 30_000,
}));

/**
 * Levelling Paladin (no spec yet): keep a seal up, Judge on cooldown, never stop auto-attacking.
 * Ret, Prot and Holy extend this with their own spells, a healing metric and mana efficiency.
 */
export const paladinLeveling: RotationModel = {
  id: "paladin-leveling",
  label: "Paladín (subiendo de nivel)",
  wowClass: "paladin",
  spec: null,
  role: "melee",
  metric: "damage",
  resource: "mana",
  spells: [
    ...sealSpells,
    {
      key: "judgement",
      label: "Judgement",
      names: ["Judgement", "Judgment"],
      effectNames: [
        "Judgement of Righteousness",
        "Judgement of Command",
        "Judgement of Justice",
        "Judgement of the Crusader",
        "Judgement of Wisdom",
        "Judgement of Light",
      ],
      gcd: true,
      cooldownMs: 10_000,
      trackCooldown: true,
      mayConsume: "seal",
    },
    { key: "holy-strike", label: "Holy Strike", names: ["Holy Strike"], gcd: true, cooldownMs: 12_000, trackCooldown: true },
    { key: "crusader-strike", label: "Crusader Strike", names: ["Crusader Strike"], gcd: true, cooldownMs: 6000, trackCooldown: true },
  ],
  auras: [
    ...sealAuras,
    {
      key: "blessing",
      label: "Blessing",
      names: ["Blessing of Might", "Blessing of Wisdom", "Blessing of Kings", "Blessing of Sanctuary"],
      on: "player",
      group: "blessing",
      anySource: true,
    },
  ],
  procs: [],
  priority: [
    {
      spell: "seal-of-righteousness",
      label: "Ponte un sello si no hay ninguno activo",
      when: [{ kind: "auraMissing", aura: "seal" }],
      accepts: SEALS.map(([key]) => key),
    },
    { spell: "judgement", label: "Judgement en cuanto se recargue", when: [{ kind: "auraActive", aura: "seal" }] },
    { spell: "holy-strike", label: "Holy Strike en cuanto se recargue" },
    { spell: "crusader-strike", label: "Crusader Strike en cuanto se recargue" },
  ],
  threat: { stanceMultiplier: 1, healingMultiplier: 0.5 },
  extras: ["swingContinuity", "sealCadence"],
  detect: ["seal-of-righteousness", "judgement", "holy-strike", "seal-of-the-crusader"],
  assumptions: [
    "Cualquier sello cumple el paso del sello; Seal of Righteousness es el que puntúa por tiempo activo.",
    "Si Judgement consume el sello se lee del registro (Forever mantiene el sello; Classic lo quita).",
    "Los ataques automáticos perdidos se cuentan a partir de huecos de más de una vez y media el intervalo medio entre golpes.",
  ],
};
