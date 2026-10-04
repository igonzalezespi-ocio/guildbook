import type { BattlenetExcludedGroup, BattlenetScan } from "@/db/schema";
import { FACTION_LABELS, type Faction, REGION_LABELS, type Region } from "@/lib/game";
import { type GuildVersion, VERSION_INFO } from "@/lib/game-versions";
import { hasLaunched } from "@/lib/showcase";
import { GAME_VERSION_LABELS } from "@/lib/wow-versions";

export interface EmptySnapshotInput {
  battletag: string;
  status: string;
  scan: BattlenetScan | null;
  /** The link's characters in the guild's game version, before the guild's region, faction and realm filter. */
  foreverCharacters: readonly { faction: Faction; region?: Region }[];
  /** The guild's game version (default WoW: Forever). */
  version?: GuildVersion;
  guildFaction: Faction | null;
  /** The guild's region; characters without a region (snapshots from before regions) are US. */
  guildRegion?: Region | null;
  now: Date;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

/** "de la Alianza" / "de la Horda". */
const ofFaction = (f: Faction) => `de la ${FACTION_LABELS[f]}`;

function describeGroup(g: BattlenetExcludedGroup): string {
  const faction = g.faction ? ` ${ofFaction(g.faction)}` : "";
  const where = g.version === "unknown" ? "en otros reinos" : `en ${GAME_VERSION_LABELS[g.version]}`;
  const names = g.examples.map((e) => `${e.name} en ${e.realmName}`);
  const more = g.count > names.length ? ` y ${g.count - names.length} más` : "";
  return `${plural(g.count, "personaje")}${faction} ${where}${names.length > 0 ? ` (${names.join(", ")}${more})` : ""}`;
}

function launchNote(now: Date, version: GuildVersion): string {
  if (version !== "forever") return "";
  return hasLaunched(now)
    ? "Si acabas de crear tu personaje de WoW: Forever, Battle.net puede tardar un rato en mostrarlo: actualiza tus personajes más tarde."
    : "World of Warcraft: Forever sale el 4 de noviembre de 2026. Cuando hayas creado allí tu personaje, actualiza tus personajes o vuelve a conectar.";
}

/**
 * The status line after refreshing Battle.net characters. `eligible` is how many the guild accepts (the same list the
 * page offers for import), never the whole snapshot, which also holds other games' characters.
 */
export function refreshSummary(eligible: number, version: GuildVersion = "forever"): string {
  const label = VERSION_INFO[version].label;
  if (eligible === 0) return `Personajes actualizados: ningún personaje de ${label} puede unirse a esta hermandad.`;
  return `Hemos encontrado ${plural(eligible, "personaje")} de ${label} para esta hermandad.`;
}

/** Why a linked account offers this guild no characters, saying what the account does have. */
export function emptySnapshotMessage(input: EmptySnapshotInput): string {
  const { battletag, status, scan, guildFaction, guildRegion, now } = input;
  const version = input.version ?? "forever";
  const label = VERSION_INFO[version].label;
  const inRegion = (region: Region | undefined) => !guildRegion || (region ?? "us") === guildRegion;
  const foreverCharacters = input.foreverCharacters.filter((c) => inRegion(c.region));
  const elsewhere = input.foreverCharacters.filter((c) => !inRegion(c.region));
  const regionLabel = guildRegion ? REGION_LABELS[guildRegion] : null;
  const where = regionLabel ? ` en la región de ${regionLabel}` : "";
  if (status === "forbidden") {
    return "Battle.net no ha compartido tu lista de personajes. Vuelve a conectar y permite el acceso a tu perfil de World of Warcraft.";
  }
  if (status === "error") {
    return "Battle.net no ha respondido al leer tus personajes. Prueba a actualizar o a volver a conectar más tarde.";
  }

  if (foreverCharacters.length === 0 && elsewhere.length > 0 && regionLabel) {
    const other = listJoin([...new Set(elsewhere.map((c) => REGION_LABELS[c.region ?? "us"]))]);
    return `Tus personajes de ${label} en ${battletag} están en ${other}, pero esta hermandad está en la región de ${regionLabel}. Las regiones son mundos separados, así que solo pueden unirse personajes de ${regionLabel}.`;
  }

  if (foreverCharacters.length > 0) {
    if (guildFaction && foreverCharacters.every((c) => c.faction !== guildFaction)) {
      const other = ofFaction(guildFaction === "alliance" ? "horde" : "alliance");
      return `Tus personajes de ${label} en ${battletag} son ${other}; esta hermandad solo acepta personajes ${ofFaction(guildFaction)}.`;
    }
    return `Ninguno de tus personajes de ${label} en ${battletag} está en ${VERSION_INFO[version].realms ? "el reino" : "los reinos"} de esta hermandad.`;
  }

  if (!scan) {
    return `No hemos encontrado personajes de ${label}${where} en ${battletag}. Actualiza tus personajes o vuelve a conectar Battle.net para ver qué más hay en la cuenta.`;
  }
  const readBefore = scan.excluded.filter((g) => g.version === version);
  if (readBefore.length > 0) {
    return `Tus personajes de ${battletag} se leyeron antes de que Guildbook pudiera importar personajes de ${label}. Vimos ${listJoin(readBefore.map(describeGroup))}: actualiza tus personajes (o vuelve a conectar Battle.net) para importarlos.`;
  }

  const failed = scan.namespaces.filter((n) => n.status === "error");
  const failedRegions = [...new Set(failed.flatMap((n) => (n.region ? [REGION_LABELS[n.region]] : [])))];
  const incomplete =
    failed.length === 0
      ? ""
      : failedRegions.length > 0
        ? ` Battle.net no ha respondido para todos los juegos en ${listJoin(failedRegions)}, así que puede que falten datos.`
        : " Battle.net no ha respondido para todos los juegos, así que puede que falten datos.";
  if (scan.excluded.length === 0) {
    return `Battle.net no muestra ningún personaje de World of Warcraft en ${battletag}.${incomplete} ${launchNote(now, version)}`.trimEnd();
  }
  const found = listJoin(scan.excluded.map(describeGroup));
  return `No hemos encontrado personajes de ${label}${where} en ${battletag}. Sí hemos encontrado ${found}, pero solo pueden unirse a esta hermandad personajes de ${label}.${incomplete} ${launchNote(now, version)}`.trimEnd();
}
