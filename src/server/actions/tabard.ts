"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import { type ActionResult, runAction } from "@/server/action";
import { getBlizzardClient } from "@/server/blizzard";
import { importInGameTabard, updateGuildTabard } from "@/server/services/tabard";

/** Saving changes the tabard key in every icon URL, so browsers and caches fetch the regenerated icons. */
export async function updateGuildTabardAction(slug: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await updateGuildTabard(db, viewer.actor, Object.fromEntries(fd.entries()));
    refresh();
    return "Tabardo y tema guardados. Iconos regenerados.";
  });
}

export async function importInGameTabardAction(slug: string, _prev: ActionResult | null): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { inGameName } = await importInGameTabard(db, viewer.actor, getBlizzardClient());
    refresh();
    return `Importado el tabardo del juego de ${inGameName}. Iconos regenerados.`;
  });
}
