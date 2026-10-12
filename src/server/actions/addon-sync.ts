"use server";

import { refresh } from "next/cache";
import { db } from "@/db";
import { type ActionResult, runAction } from "@/server/action";
import { createSyncToken, revokeSyncToken } from "@/server/services/addon-sync";

export type SyncTokenResult = { ok: true; token: string } | { ok: false; error: string };

export async function createAddonSyncTokenAction(slug: string, name: string): Promise<SyncTokenResult> {
  let token = "";
  const result = await runAction(slug, async ({ viewer }) => {
    ({ token } = await createSyncToken(db, viewer.actor, { name }));
  });
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  return { ok: true, token };
}

export async function revokeAddonSyncTokenAction(slug: string, id: string, _prev: ActionResult | null): Promise<ActionResult> {
  return runAction(slug, async ({ viewer }) => {
    await revokeSyncToken(db, viewer.actor, id);
    refresh();
    return "Clave anulada. El sincronizador que la usaba ya no puede enviar datos.";
  });
}
