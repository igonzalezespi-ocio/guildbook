"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import { RANK_PRESETS, isRankPresetKey } from "@/lib/rank-presets";
import { type ActionResult, runAction } from "@/server/action";
import {
  applyRankPreset,
  confirmRanks,
  ensureDraftInvite,
  publishGuild,
  setSetupDismissed,
  setSetupStepSkipped,
  unpublishGuild,
  applyNeutralDefaults,
} from "@/server/services/guild-setup";

type Prev = ActionResult | null;

export async function skipSetupStepAction(slug: string, step: string, skipped: boolean, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await setSetupStepSkipped(db, viewer.actor, step, skipped);
    refresh();
  });
}

export async function dismissSetupAction(slug: string, dismissed: boolean, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await setSetupDismissed(db, viewer.actor, dismissed);
    refresh();
    return dismissed ? "Lista de configuración oculta. La tienes en Administración > Configuración." : undefined;
  });
}

export async function confirmRanksAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await confirmRanks(db, viewer.actor);
    refresh();
    return "Rangos confirmados.";
  });
}

export async function applyRankPresetAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { preset, movedMembers } = await applyRankPreset(db, viewer.actor, fd.get("preset"));
    refresh();
    return movedMembers > 0 ? `Rangos de ${preset} aplicados. ${movedMembers} miembros pasan a un rango equivalente.` : `Rangos de ${preset} aplicados.`;
  });
}

export async function neutralDefaultsAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const key = fd.get("preset");
    const result = await applyNeutralDefaults(db, viewer.actor, key);
    refresh();
    const parts = [
      result.ranksReplaced && isRankPresetKey(key) ? `rangos de ${RANK_PRESETS[key].label} aplicados` : null,
      result.pagesReplaced > 0 ? "páginas de ejemplo restauradas" : null,
    ].filter(Boolean);
    return `Predeterminados neutros aplicados: ${parts.join(", ") || "hecho"}.`;
  });
}

export async function publishGuildAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await publishGuild(db, viewer.actor);
    refresh();
    return "Tu hermandad está publicada.";
  });
}

export async function unpublishGuildAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await unpublishGuild(db, viewer.actor);
    refresh();
    return "Tu hermandad vuelve a ser un borrador.";
  });
}

export async function createDraftInviteAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await ensureDraftInvite(db, viewer.actor);
    refresh();
    return "Enlace de invitación listo.";
  });
}
