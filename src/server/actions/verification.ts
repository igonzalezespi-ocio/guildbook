"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { type ActionResult, runAction } from "@/server/action";
import { getBlizzardClient } from "@/server/blizzard";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import {
  claimGuildName,
  claimGuildSlug,
  dismissAdminNotice,
  promoteVerifiedGuildMaster,
  verifyGuild,
} from "@/server/services/guild-verification";

type Prev = ActionResult | null;

export async function verifyGuildAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { state, result } = await verifyGuild(db, viewer.actor, getBlizzardClient());
    refresh();
    if (state === "verified" && result.verified) return "Tu hermandad está verificada.";
    if (state === "verified") return `Sigue verificada, pero esta comprobación ha fallado: ${result.message}`;
    if (state === "failing") return `La comprobación de verificación ha fallado. De momento el sello se mantiene: ${result.message}`;
    if (state === "lapsed") return `Verificación retirada: ${result.message}`;
    return result.message;
  });
}

export async function claimGuildNameAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { name, renamedHolder } = await claimGuildName(db, viewer.actor, getBlizzardClient());
    refresh();
    return renamedHolder
      ? `Tu hermandad ahora se llama ${name} y está verificada. La hermandad sin verificar que tenía el nombre ahora es ${renamedHolder}.`
      : `Tu hermandad ahora se llama ${name} y está verificada.`;
  });
}

export async function claimGuildSlugAction(slug: string, _prev: Prev): Promise<ActionResult> {
  let claimed: string | null = null;
  const result = await runAction(slug, async ({ viewer }) => {
    claimed = (await claimGuildSlug(db, viewer.actor)).slug;
  });
  if (!result.ok || !claimed) return result;
  redirect(`${guildOrigin(claimed, await getRequestHost())}/admin/guild`);
}

export async function dismissAdminNoticeAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await dismissAdminNotice(db, viewer.actor);
    refresh();
  });
}

export async function promoteGuildMasterAction(slug: string, _prev: Prev): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const { characterName, rankName } = await promoteVerifiedGuildMaster(db, viewer.actor);
    refresh();
    return `${characterName ?? "El maestro de la hermandad"} ahora tiene el rango ${rankName}.`;
  });
}
