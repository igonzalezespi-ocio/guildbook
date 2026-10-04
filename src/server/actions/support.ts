"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { emailTransportFromEnv } from "@/lib/email";
import { type ActionResult, actionError } from "@/server/action";
import { getSessionUser } from "@/server/context";
import { appVersion, submitSupportTicket, supportMailFromEnv } from "@/server/services/support";

const clip = (value: string | null | undefined, max: number) => (value ? value.slice(0, max) : null);

export async function submitSupportTicketAction(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "Inicia sesión con Discord para enviar una solicitud de soporte." };

  const h = await headers();
  const page = fd.get("page");
  let ticketId: string;
  try {
    const { ticket } = await submitSupportTicket(db, user.id, Object.fromEntries(fd.entries()), {
      context: {
        page: clip(typeof page === "string" ? page : null, 500) ?? clip(h.get("referer"), 500),
        userAgent: clip(h.get("user-agent"), 500),
        host: clip(h.get("x-forwarded-host") ?? h.get("host"), 255),
        appVersion: appVersion(),
      },
      mail: supportMailFromEnv(emailTransportFromEnv()),
    });
    ticketId = ticket.id;
  } catch (err) {
    return actionError(err);
  }
  redirect(`/support?ticket=${ticketId}`);
}
