import type { Metadata } from "next";
import Link from "next/link";
import { GuildbookMark } from "@/components/guildbook-mark";
import { PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { CONTACT_EMAIL } from "@/lib/brand";
import { SUPPORT_CATEGORIES, type SupportCategory, ticketReference } from "@/lib/support";
import { signInWithDiscord } from "@/server/actions/member";
import { getSessionUser } from "@/server/context";
import { getRequestHost } from "@/server/hosts";
import { appVersion, getOwnSupportTicket, getSupportProfile, listSupportGuilds } from "@/server/services/support";
import { SupportForm } from "./support-form";

export const metadata: Metadata = { title: "Soporte", robots: { index: false } };

const isCategory = (v: unknown): v is SupportCategory => typeof v === "string" && Object.hasOwn(SUPPORT_CATEGORIES, v);

function FallbackLine() {
  return (
    <p className="text-xs text-muted" data-testid="support-fallback">
      ¿No puedes iniciar sesión? Escribe a{" "}
      <a href={`mailto:${CONTACT_EMAIL}`} className="text-gold underline-offset-2 hover:underline">
        {CONTACT_EMAIL}
      </a>{" "}
      con tu usuario de Discord y qué ha fallado.
    </p>
  );
}

export default async function SupportPage({ searchParams }: PageProps<"/platform/support">) {
  const sp = await searchParams;
  const [user, current] = await Promise.all([getSessionUser(), getRequestHost()]);

  if (!user) {
    return (
      <div className="mx-auto max-w-md pt-4">
        <Panel>
          <div className="flex flex-col items-center gap-4 text-center" data-testid="support-signed-out">
            <GuildbookMark className="h-14 w-14" />
            <h1 className="text-xl font-bold text-gold">Soporte de Guildbook</h1>
            <p className="text-sm text-muted">
              Inicia sesión con Discord para enviar una solicitud de soporte. Así vemos tu cuenta y tus hermandades y podemos
              ayudarte antes.
            </p>
            <form action={signInWithDiscord.bind(null, `${current.origin}/support`)} className="w-full">
              <button type="submit" className="btn btn-gold w-full">
                Iniciar sesión con Discord
              </button>
            </form>
            <Link href="/login?callbackUrl=%2Fsupport" className="text-xs text-bone/70 hover:text-gold">
              Otras formas de iniciar sesión
            </Link>
            <FallbackLine />
          </div>
        </Panel>
      </div>
    );
  }

  const ticketId = typeof sp.ticket === "string" ? sp.ticket : null;
  const [profile, guilds, ticket] = await Promise.all([
    getSupportProfile(db, user.id),
    listSupportGuilds(db, user.id),
    ticketId ? getOwnSupportTicket(db, user.id, ticketId) : null,
  ]);

  if (ticket) {
    const reference = ticketReference(ticket.id);
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Solicitud enviada" eyebrow="Soporte de Guildbook" />
        <Panel>
          <div role="status" className="space-y-4" data-testid="support-success">
            <p className="text-sm text-muted">Tu número de referencia</p>
            <p className="font-mono text-2xl tracking-wider text-gold" data-testid="support-reference">
              {reference}
            </p>
            <p>
              Gracias. Hemos recibido tu solicitud sobre <strong className="text-bone">{ticket.subject}</strong>.{" "}
              {ticket.replyTo ? (
                <>
                  Te responderemos por correo a <strong className="text-bone">{ticket.replyTo}</strong>.
                </>
              ) : (
                <>
                  No has dejado un correo, así que te responderemos por Discord
                  {profile?.discordUsername ? (
                    <>
                      {" "}
                      a <strong className="text-bone">@{profile.discordUsername}</strong>
                    </>
                  ) : null}
                  .
                </>
              )}
            </p>
            <p className="text-sm text-muted">Menciona {reference} si vuelves a escribirnos sobre esto.</p>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/support" className="btn btn-ghost btn-sm">
                Enviar otra solicitud
              </Link>
              <Link href="/" className="btn btn-ghost btn-sm">
                Volver a Guildbook
              </Link>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const discordName = profile?.discordUsername ? `@${profile.discordUsername}` : (profile?.name ?? "Desconocido");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Soporte" eyebrow="Guildbook">
        Cuéntanos qué falla o qué necesitas. Una persona lee cada solicitud y responde, normalmente en pocos días.
      </PageHeader>
      <Panel>
        <SupportForm
          guilds={guilds.map((g) => ({ id: g.id, name: g.name, detail: g.status === "applicant" ? "Aspirante" : g.rankName }))}
          defaultCategory={isCategory(sp.category) ? sp.category : undefined}
          defaultEmail={profile?.email ?? ""}
          context={{ userId: user.id, discordName, appVersion: appVersion() }}
        />
      </Panel>
      <p className="text-center text-xs text-muted">
        Para exportar o borrar tus datos tú mismo, usa{" "}
        <Link href="/account" className="text-gold underline-offset-2 hover:underline">
          Cuenta y privacidad
        </Link>
        . Consulta la{" "}
        <Link href="/privacy" className="text-gold underline-offset-2 hover:underline">
          Política de privacidad
        </Link>{" "}
        para saber cómo tratamos las solicitudes de soporte.
      </p>
    </div>
  );
}
