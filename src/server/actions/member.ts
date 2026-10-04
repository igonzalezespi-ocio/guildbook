"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { fullName, PROFESSIONS, type Profession } from "@/lib/game";
import { sharesSessionCookie } from "@/lib/hosts";
import { guildHref } from "@/lib/paths";
import { type ActionResult, runAction } from "@/server/action";
import { getBlizzardClient } from "@/server/blizzard";
import { setFlash } from "@/server/flash";
import { sessionCookieName, sessionReachUrl } from "@/server/handoff";
import { getRequestHost, validateDestination } from "@/server/hosts";
import { submitApplication, withdrawApplication } from "@/server/services/applications";
import {
  archiveCharacter,
  createCharacter,
  setMainCharacter,
  updateCharacter,
} from "@/server/services/characters";
import { joinAsConfirmedMember } from "@/server/services/confirmed-members";

function formObject(fd: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(fd.entries());
}

function characterFromForm(fd: FormData) {
  const professions = fd
    .getAll("professions")
    .filter((p): p is Profession => typeof p === "string" && (PROFESSIONS as readonly string[]).includes(p))
    .map((profession) => {
      const skill = fd.get(`skill_${profession}`);
      return { profession, skill: typeof skill === "string" && skill !== "" ? skill : null };
    });
  return { ...formObject(fd), professions };
}

export async function signInWithDiscord(callbackUrl: string) {
  await signIn("discord", { redirectTo: callbackUrl || "/" });
}

export async function signInForTests(formData: FormData) {
  const current = await getRequestHost();
  const target = (await validateDestination(String(formData.get("callbackUrl") || "/"), current.origin)) ?? `${current.origin}/`;
  const discordId = String(formData.get("discordId") ?? "");
  await signIn("test-login", { discordId, name: formData.get("name"), redirect: false });
  const [user] = await db.select({ id: users.id, discordId: users.discordId }).from(users).where(eq(users.discordId, discordId));
  redirect(user ? await sessionReachUrl(db, user, target, current) : target);
}

export async function signOutAction() {
  const current = await getRequestHost();
  // A handoff cookie on a custom domain is host-only; Auth.js would try to clear it on the shared cookie domain.
  if (current.config.cookieDomain && !sharesSessionCookie(current.host, current.config)) {
    (await cookies()).delete({ name: sessionCookieName(current.protocol === "https:"), path: "/" });
    redirect("/");
  }
  await signOut({ redirectTo: "/" });
}

export async function applyAction(slug: string, _prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction(slug, async ({ guild, viewer }) => {
    const application = await submitApplication(db, viewer.actor, formObject(fd));
    refresh();
    const name = fullName(application.characterName, application.characterSurname);
    return `Solicitud de ${name} enviada. Un oficial la revisará pronto.${guild.preset === "order" ? " Pax tecum." : ""}`;
  });
}

/** Applying to a draft guild through its private invite link. */
export async function applyWithInviteAction(slug: string, invite: string, prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  fd.set("invite", invite);
  return applyAction(slug, prev, fd);
}

/** Joining without review as a member Battle.net confirms in the in-game guild. `invite` is a draft guild's link token. */
export async function joinAsConfirmedMemberAction(
  slug: string,
  invite: string | null,
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const result = await runAction(slug, async ({ guild, viewer }) => {
    const joined = await joinAsConfirmedMember(db, viewer.actor, formObject(fd), getBlizzardClient(), { invite });
    return `Bienvenido a ${guild.name}. ${joined.characterName} entra como ${joined.rankName}.`;
  });
  if (!result.ok) return result;
  if (result.message) await setFlash(result.message);
  redirect(guildHref(slug, "/members"));
}

export async function withdrawApplicationAction(
  slug: string,
  applicationId: string,
  _prev: ActionResult | null,
): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const application = await withdrawApplication(db, viewer.actor, applicationId);
    refresh();
    return `Solicitud de ${fullName(application.characterName, application.characterSurname)} retirada.`;
  });
}

export async function createCharacterAction(
  slug: string,
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const result = await runAction(slug, async ({ viewer }) => {
    const created = await createCharacter(db, viewer.actor, characterFromForm(fd));
    return created && `${fullName(created.name, created.surname)} añadido a tus personajes.`;
  });
  if (!result.ok) return result;
  if (result.message) await setFlash(result.message);
  redirect(guildHref(slug, "/members/characters"));
}

export async function updateCharacterAction(
  slug: string,
  id: string,
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const result = await runAction(slug, async ({ viewer }) => {
    const updated = await updateCharacter(db, viewer.actor, id, characterFromForm(fd));
    return updated && `${fullName(updated.name, updated.surname)}: guardado.`;
  });
  if (!result.ok) return result;
  if (result.message) await setFlash(result.message);
  redirect(guildHref(slug, "/members/characters"));
}

export async function setMainCharacterAction(slug: string, id: string, _prev: ActionResult | null): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const character = await setMainCharacter(db, viewer.actor, id);
    refresh();
    return `${fullName(character.name, character.surname)} ahora es tu personaje principal.`;
  });
}

export async function archiveCharacterAction(slug: string, id: string, _prev: ActionResult | null): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    const character = await archiveCharacter(db, viewer.actor, id);
    refresh();
    return `${fullName(character.name, character.surname)} archivado.`;
  });
}
