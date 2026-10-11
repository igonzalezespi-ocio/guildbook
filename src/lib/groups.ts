import type { WowClass } from "@/lib/game";

/** Groups organised from Discord by the guild's bot (see group_events). Pure rules, shared by services and pages. */

export const GROUP_KINDS = ["raid", "dungeon", "lfg"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];
export const GROUP_KIND_LABELS: Record<GroupKind, string> = { raid: "Banda", dungeon: "Mazmorra", lfg: "Busca grupo" };

export const GROUP_STATUSES = ["open", "closed", "cancelled", "finished"] as const;
export type GroupStatus = (typeof GROUP_STATUSES)[number];
export const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  open: "Inscripciones abiertas",
  closed: "Inscripciones cerradas",
  cancelled: "Cancelado",
  finished: "Terminado",
};
/** Statuses in which a group is still coming up. */
export const ACTIVE_GROUP_STATUSES: readonly GroupStatus[] = ["open", "closed"];

/** Group slots. The site's raid roles split DPS into melee and ranged; a group only counts DPS. */
export const GROUP_ROLES = ["tank", "healer", "dps"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];
export const GROUP_ROLE_LABELS: Record<GroupRole, string> = { tank: "Tanque", healer: "Sanador", dps: "DPS" };

/** What each class can do in a group in WoW: Forever (the same table as the Discord bot's). */
export const CLASS_GROUP_ROLES: Record<WowClass, readonly GroupRole[]> = {
  warrior: ["tank", "dps"],
  paladin: ["healer", "tank", "dps"],
  hunter: ["dps"],
  rogue: ["dps"],
  priest: ["healer", "dps"],
  shaman: ["healer", "dps"],
  mage: ["dps"],
  warlock: ["dps"],
  druid: ["tank", "healer", "dps"],
};

export const canPlayRole = (wowClass: WowClass, role: GroupRole) => CLASS_GROUP_ROLES[wowClass].includes(role);

export interface Slots {
  tank: number;
  healer: number;
  dps: number;
}

export interface QueuedSignup {
  role: GroupRole;
  bench: boolean;
  queuedAt: Date;
}

export interface Roster<T extends QueuedSignup> {
  confirmed: Record<GroupRole, T[]>;
  reserves: T[];
}

/**
 * For each role, the first to sign up fill its slots; everyone else waits on the bench, in order. When someone
 * leaves, the first of the bench with that role moves up on their own.
 */
export function buildRoster<T extends QueuedSignup>(signups: readonly T[], slots: Slots): Roster<T> {
  const roster: Roster<T> = { confirmed: { tank: [], healer: [], dps: [] }, reserves: [] };
  for (const signup of [...signups].sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime())) {
    const places = roster.confirmed[signup.role];
    if (!signup.bench && places.length < slots[signup.role]) places.push(signup);
    else roster.reserves.push(signup);
  }
  return roster;
}
