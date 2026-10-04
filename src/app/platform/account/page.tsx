import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ConfirmDeleteForm } from "@/components/confirm-delete-form";
import { PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { deleteAccountAction } from "@/server/actions/account";
import { getSessionUser } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { getAccountOverview } from "@/server/services/account";

export const metadata: Metadata = { title: "Cuenta y privacidad", robots: { index: false } };

const STATUS_LABEL = { active: "Miembro", applicant: "Aspirante", former: "Antiguo miembro" } as const;

export default async function AccountPage({ searchParams }: PageProps<"/platform/account">) {
  const params = await searchParams;
  const user = await getSessionUser();
  if (!user) {
    if (params.deleted === "1") {
      return (
        <div className="mx-auto max-w-2xl">
          <PageHeader title="Cuenta borrada" eyebrow="Guildbook" />
          <Panel>
            <p data-testid="account-deleted">
              Tu cuenta de Guildbook y los datos asociados se han borrado. Los registros de auditoría de las hermandades ahora
              muestran tus acciones pasadas como &quot;Usuario eliminado&quot;. Puedes volver a iniciar sesión cuando quieras para
              empezar de cero.
            </p>
          </Panel>
        </div>
      );
    }
    redirect("/login?callbackUrl=%2Faccount");
  }

  const overview = await getAccountOverview(db, user.id);
  if (!overview) redirect("/login?callbackUrl=%2Faccount");
  const current = await getRequestHost();
  const { plan } = overview;
  const guildDeleted = typeof params.guildDeleted === "string" ? params.guildDeleted : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Cuenta y privacidad" eyebrow="Guildbook">
        Has iniciado sesión con Discord como <span className="text-bone">{overview.displayName}</span>
        {overview.user.discordUsername && overview.user.discordUsername !== overview.displayName && (
          <span> (@{overview.user.discordUsername})</span>
        )}
        .
      </PageHeader>

      {guildDeleted && (
        <p role="status" className="panel border-emerald-700/50 p-4 text-sm text-emerald-300">
          La hermandad {guildDeleted} se ha borrado.
        </p>
      )}

      <Panel title="Tus hermandades">
        {overview.guilds.length === 0 ? (
          <p className="text-sm text-muted">Aún no te has unido a ninguna hermandad ni has enviado solicitudes.</p>
        ) : (
          <ul className="divide-y divide-line">
            {overview.guilds.map((g) => (
              <li key={g.slug} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <a href={guildOrigin(g.slug, current)} className="font-semibold text-bone hover:text-gold">
                  {g.name}
                </a>
                <span className="text-muted">
                  {g.status === "active" ? g.rankName : STATUS_LABEL[g.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {overview.battletag && (
          <p className="mt-4 text-xs text-muted">
            Battle.net vinculado como {overview.battletag}. Desvincúlalo desde la página de personajes de cualquier hermandad.
          </p>
        )}
      </Panel>

      <Panel title="Exporta tus datos">
        <p className="mb-4 text-sm text-muted">
          Descarga en un archivo JSON todo lo que Guildbook guarda sobre ti: tu perfil, tus hermandades, personajes,
          solicitudes, informes de Vigil, solicitudes de soporte y las entradas de auditoría que generaste.
        </p>
        <a href="/api/account/export" download className="btn btn-ghost" data-testid="export-data">
          Descargar mis datos
        </a>
      </Panel>

      <Panel title="Borra tu cuenta" className="border-red-900/60">
        <div className="space-y-3 text-sm text-muted" data-testid="delete-account">
          <p>
            Esto borra para siempre tu cuenta de Guildbook: tu inicio de sesión con Discord, el vínculo con Battle.net, tus
            pertenencias a hermandades, personajes, solicitudes, informes de Vigil, solicitudes de soporte y apps emparejadas. Las
            entradas de los registros de auditoría de las hermandades se conservan, con tu nombre sustituido por &quot;Usuario
            eliminado&quot;. No se puede deshacer.
          </p>
          {plan.soloGuilds.length > 0 && (
            <p className="text-bone">
              Eres el único miembro de {plan.soloGuilds.map((g) => g.name).join(", ")}, así que{" "}
              {plan.soloGuilds.length === 1 ? "esa hermandad también se borrará" : "esas hermandades también se borrarán"}.
            </p>
          )}
          {plan.blockers.length > 0 ? (
            <div role="alert" className="rounded border border-red-900/60 p-3 text-red-200" data-testid="delete-blocked">
              <p className="font-semibold">Eres el único administrador de {plan.blockers.map((g) => g.name).join(", ")}.</p>
              <p className="mt-1">
                Antes de borrar tu cuenta, asciende a otro miembro a un rango de administrador en la página{" "}
                <span className="text-bone">Miembros</span> de la administración de la hermandad, o borra la hermandad desde su
                página <span className="text-bone">Hermandad</span> de la administración.
              </p>
              <ul className="mt-2 flex flex-wrap gap-3">
                {plan.blockers.map((g) => (
                  <li key={g.slug}>
                    <a href={`${guildOrigin(g.slug, current)}/admin/members`} className="text-gold underline-offset-2 hover:underline">
                      Gestionar los miembros de {g.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ConfirmDeleteForm
              action={deleteAccountAction}
              expected={overview.displayName}
              buttonLabel="Borrar mi cuenta"
              pendingLabel="Borrando…"
            />
          )}
        </div>
      </Panel>

      <p className="text-center text-xs text-muted">
        Consulta la <Link href="/privacy" className="text-gold hover:underline">Política de privacidad</Link> para saber qué
        guardamos y por qué. ¿Dudas o problemas? <Link href="/support" className="text-gold hover:underline">Contacta con soporte</Link>.
      </p>
    </div>
  );
}
