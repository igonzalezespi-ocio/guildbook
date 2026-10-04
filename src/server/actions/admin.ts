"use server";

import { resolveTxt } from "node:dns/promises";
import { refresh } from "next/cache";
import { db } from "@/db";
import { type ActionResult, runAction } from "@/server/action";
import { addGuildDomain, type DomainDeps, removeGuildDomain, verifyGuildDomain } from "@/server/services/domains";
import { DomainError } from "@/server/errors";
import { getDomainProvider } from "@/server/vercel-domains";
import { CLASS_INFO, DAYS_OF_WEEK, fullName, RECRUITMENT_PRIORITY_LABELS, ROLE_LABELS } from "@/lib/game";
import { reviewApplication } from "@/server/services/applications";
import { updateConfirmedJoinSettings } from "@/server/services/confirmed-members";
import {
  createBoss,
  createInstance,
  deleteAddon,
  deleteBossKill,
  deleteScheduleSlot,
  recordBossKill,
  saveAddon,
  saveScheduleSlot,
  setRecruitmentNeed,
  updateContentPage,
} from "@/server/services/content";
import {
  assignRank,
  createRank,
  deleteRank,
  moveRank,
  removeMember,
  setRankDefaults,
  setRecruitmentOpen,
  updateGuildSettings,
  updateRank,
} from "@/server/services/ranks";

type Prev = ActionResult | null;
const obj = (fd: FormData) => Object.fromEntries(fd.entries());

export async function reviewApplicationAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const app = await reviewApplication(db, viewer.actor, obj(fd));
    refresh();
    const name = fullName(app.characterName, app.characterSurname);
    const rank = app.rankName ? ` como ${app.rankName}` : "";
    if (app.status === "accepted") return `${name} aceptado${rank}.`;
    if (app.status === "trial") return `${name} queda a prueba${rank}.`;
    return `Solicitud de ${name} rechazada.`;
  });
}

export async function assignRankAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { characterName, rankName } = await assignRank(db, viewer.actor, obj(fd));
    refresh();
    return characterName ? `${characterName} ahora es ${rankName}.` : `Rango cambiado a ${rankName}.`;
  });
}

export async function removeMemberAction(slug: string, membershipId: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { characterName } = await removeMember(db, viewer.actor, membershipId);
    refresh();
    return characterName ? `${characterName} ya no está en la hermandad.` : "Miembro expulsado de la hermandad.";
  });
}

export async function createRankAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await createRank(db, viewer.actor, obj(fd));
    refresh();
    return "Rango creado.";
  });
}

export async function updateRankAction(slug: string, id: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await updateRank(db, viewer.actor, id, obj(fd));
    refresh();
    return "Guardado.";
  });
}

export async function moveRankAction(slug: string, id: string, direction: "up" | "down", _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await moveRank(db, viewer.actor, id, direction);
    refresh();
  });
}

export async function deleteRankAction(slug: string, id: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await deleteRank(db, viewer.actor, id);
    refresh();
    return "Rango borrado.";
  });
}

export async function setRankDefaultsAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await setRankDefaults(db, viewer.actor, obj(fd));
    refresh();
    return "Guardado.";
  });
}

export async function updateGuildSettingsAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { unverified } = await updateGuildSettings(db, viewer.actor, obj(fd));
    refresh();
    return unverified ? "Ajustes de la hermandad guardados. La identidad de la hermandad ha cambiado, así que ya no está verificada." : "Ajustes de la hermandad guardados.";
  });
}

export async function updateConfirmedJoinSettingsAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const s = await updateConfirmedJoinSettings(db, viewer.actor, obj(fd));
    refresh();
    return s.autoApproveInGuild ? "Los miembros confirmados en el juego ahora entran sin revisión." : "Los miembros confirmados en el juego ahora envían solicitud para revisión, como todos.";
  });
}

export async function updateContentAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const page = await updateContentPage(db, viewer.actor, obj(fd));
    refresh();
    return `${page.title}: guardado.`;
  });
}

export async function saveScheduleSlotAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const slot = await saveScheduleSlot(db, viewer.actor, obj(fd));
    refresh();
    return `${DAYS_OF_WEEK[slot.dayOfWeek]} ${slot.label}: ${slot.created ? "añadido al" : "guardado en el"} horario.`;
  });
}

export async function deleteScheduleSlotAction(slug: string, id: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await deleteScheduleSlot(db, viewer.actor, id);
    refresh();
    return "Noche de banda borrada.";
  });
}

export async function setRecruitmentNeedAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const need = await setRecruitmentNeed(db, viewer.actor, obj(fd));
    refresh();
    return `Necesidad de ${CLASS_INFO[need.wowClass].label} (${ROLE_LABELS[need.role]}): ${RECRUITMENT_PRIORITY_LABELS[need.priority]?.toLowerCase() ?? need.priority}.`;
  });
}

export async function setRecruitmentOpenAction(slug: string, open: boolean, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await setRecruitmentOpen(db, viewer.actor, open);
    refresh();
    return open ? "Reclutamiento abierto." : "Reclutamiento cerrado.";
  });
}

export async function createInstanceAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await createInstance(db, viewer.actor, obj(fd));
    refresh();
    return "Instancia añadida.";
  });
}

export async function createBossAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await createBoss(db, viewer.actor, obj(fd));
    refresh();
    return "Jefe añadido.";
  });
}

export async function recordBossKillAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ guild, viewer }) => {
    const { bossName } = await recordBossKill(db, viewer.actor, obj(fd));
    refresh();
    return `Muerte de ${bossName ?? "jefe"} registrada.${guild.preset === "order" ? " Deo gratias!" : ""}`;
  });
}

export async function deleteBossKillAction(slug: string, id: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await deleteBossKill(db, viewer.actor, id);
    refresh();
    return "Muerte de jefe borrada.";
  });
}

export async function saveAddonAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const addon = await saveAddon(db, viewer.actor, obj(fd));
    refresh();
    return `${addon.name}: ${addon.created ? "añadido" : "guardado"}.`;
  });
}

export async function deleteAddonAction(slug: string, id: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await deleteAddon(db, viewer.actor, id);
    refresh();
    return "Addon borrado.";
  });
}

const domainDeps = (): DomainDeps => ({ provider: getDomainProvider(), resolveTxt });

export async function addDomainAction(slug: string, _prev: Prev, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const domain = await addGuildDomain(db, viewer.actor, obj(fd), domainDeps());
    refresh();
    return `${domain.domain} añadido. Añade los registros DNS de abajo y comprueba la verificación.`;
  });
}

export async function verifyDomainAction(slug: string, id: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const domain = await verifyGuildDomain(db, viewer.actor, id, domainDeps());
    refresh();
    if (domain.status !== "verified") throw new DomainError(`${domain.domain} aún no está verificado. Mira los detalles de arriba.`);
    return `${domain.domain} está verificado.`;
  });
}

export async function removeDomainAction(slug: string, id: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await removeGuildDomain(db, viewer.actor, id, domainDeps());
    refresh();
    return "Dominio quitado.";
  });
}
