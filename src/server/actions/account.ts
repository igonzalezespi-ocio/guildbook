"use server";

import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { db } from "@/db";
import { type ActionResult, actionError } from "@/server/action";
import { getGuild, getSessionUser, getViewer } from "@/server/context";
import { getRequestHost } from "@/server/hosts";
import { createRateLimiter } from "@/server/rate-limit";
import { deleteGuild, deleteUserAccount } from "@/server/services/account";
import { getDomainProvider } from "@/server/vercel-domains";

const deleteLimiter = createRateLimiter({ limit: 10, windowMs: 10 * 60_000 });

async function releaseDomains(domains: string[]) {
  const provider = getDomainProvider();
  if (!provider) return;
  await Promise.all(domains.map((d) => provider.remove(d).catch(() => undefined)));
}

export async function deleteAccountAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Inicia sesión para borrar tu cuenta." };
  if (!deleteLimiter(user.id).ok) return { ok: false, error: "Demasiados intentos. Espera unos minutos y vuelve a intentarlo." };
  try {
    const result = await deleteUserAccount(db, user.id, String(fd.get("confirmName") ?? ""));
    await releaseDomains(result.releasedDomains);
  } catch (err) {
    return actionError(err);
  }
  await signOut({ redirectTo: "/account?deleted=1" });
  return { ok: true };
}

export async function deleteGuildAction(slug: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  let deletedSlug: string;
  try {
    const guild = await getGuild(slug);
    const viewer = await getViewer(guild.id);
    const result = await deleteGuild(db, viewer.actor, String(fd.get("confirmName") ?? ""), {
      protectedSlug: process.env.DEFAULT_GUILD_SLUG || undefined,
    });
    await releaseDomains(result.releasedDomains);
    deletedSlug = result.slug;
  } catch (err) {
    return actionError(err);
  }
  // The flash cookie is per host, so the apex reads the outcome from the URL instead.
  const target = new URL("/account", (await getRequestHost()).apexOrigin);
  target.searchParams.set("guildDeleted", deletedSlug);
  redirect(target.toString());
}
