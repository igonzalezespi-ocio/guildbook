"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import { refreshSummary } from "@/lib/battlenet-empty-state";
import { fullName } from "@/lib/game";
import { getBattlenetDeps, getBlizzardClient } from "@/server/blizzard";
import { type ActionResult, runAction } from "@/server/action";
import {
  getEligibleCharacters,
  importBattlenetCharacter,
  refreshBattlenetSnapshot,
  syncGuildCharacters,
  unlinkBattlenet,
} from "@/server/services/battlenet";
import { recheckAdminStanding } from "@/server/services/guild-verification";

type Prev = ActionResult | null;

export async function unlinkBattlenetAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { battletag, charactersUnverified } = await unlinkBattlenet(db, viewer.actor);
    refresh();
    const lapsed = charactersUnverified
      ? ` ${charactersUnverified} ${charactersUnverified === 1 ? "personaje queda" : "personajes quedan"} sin verificar.`
      : "";
    return `Cuenta de Battle.net ${battletag} desvinculada.${lapsed}`;
  });
}

export async function refreshBattlenetAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ guild, viewer }) => {
    await refreshBattlenetSnapshot(db, viewer.actor, getBattlenetDeps());
    await recheckAdminStanding(db, viewer.actor, getBlizzardClient());
    const { characters: eligible } = await getEligibleCharacters(db, viewer.actor);
    refresh();
    return refreshSummary(eligible.length, guild.gameVersion);
  });
}

export async function importBattlenetCharacterAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { character, created } = await importBattlenetCharacter(db, viewer.actor, Object.fromEntries(fd.entries()), undefined, getBlizzardClient());
    await recheckAdminStanding(db, viewer.actor, getBlizzardClient());
    refresh();
    return `${fullName(character.name, character.surname)} ${created ? "importado desde Battle.net" : "verificado con Battle.net"}.`;
  });
}

export async function syncCharactersAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const s = await syncGuildCharacters(db, viewer.actor, getBlizzardClient());
    refresh();
    if (s.checked === 0) return "No hay personajes verificados que sincronizar.";
    const parts = [`${s.updated} actualizados`, `${s.unchanged} sin cambios`];
    if (s.missing > 0) parts.push(`${s.missing} no encontrados en Battle.net`);
    return `${s.checked === 1 ? "Sincronizado 1 personaje verificado" : `Sincronizados ${s.checked} personajes verificados`}: ${parts.join(", ")}.`;
  });
}
