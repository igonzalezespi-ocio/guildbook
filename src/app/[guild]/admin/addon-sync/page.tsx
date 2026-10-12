import type { Metadata } from "next";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { SyncTokenCreator } from "@/components/addon-sync/token-creator";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { formatDateTime } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { revokeAddonSyncTokenAction } from "@/server/actions/addon-sync";
import { requirePage } from "@/server/context";
import { listSyncReports, listSyncTokens } from "@/server/services/addon-sync";

export const metadata: Metadata = { title: "Sincronizador del addon" };

const ADDON_URL = "https://github.com/Nedyar/GuildProfessionsRecipes";

export default async function AddonSyncPage({ params }: PageProps<"/[guild]/admin/addon-sync">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "addonSync.manage", guildHref(slug, "/admin/addon-sync"));
  const [tokens, reports] = await Promise.all([listSyncTokens(db, actor), listSyncReports(db, actor)]);
  /** Only the build GitHub makes from the public source (owner decision, 2026-10-11). */
  const downloadUrl = process.env.ADDON_SYNC_DOWNLOAD_URL || "https://github.com/PCX22/WOWBot/releases/latest";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Sincronizador del addon" eyebrow="Profesiones desde el juego">
        El addon{" "}
        <a href={ADDON_URL} className="link">
          Guild Professions &amp; Recipes
        </a>{" "}
        comparte dentro del juego las profesiones de toda la hermandad. El sincronizador lee lo que guarda en tu PC
        y lo envía aquí, así que basta con que un oficial lo tenga en marcha. Los niveles de profesión de los
        personajes se actualizan solos.
      </PageHeader>

      <Panel title="Cómo se usa">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Instala el addon en el juego.</li>
          <li>
            Descarga el sincronizador
            {downloadUrl ? (
              <>
                {" "}
                (
                <a href={downloadUrl} className="link" data-testid="addon-sync-download">
                  descargar
                </a>
                )
              </>
            ) : (
              " (pídeselo a quien administra la web)"
            )}{" "}
            y ábrelo una vez.
          </li>
          <li>Crea abajo una clave y pégala en el sincronizador junto con la dirección de esta web.</li>
          <li>
            El juego guarda los datos al cerrar sesión o con <code>/reload</code>; el sincronizador los envía unos
            segundos después.
          </li>
        </ol>
      </Panel>

      <Panel title="Crear una clave">
        <SyncTokenCreator slug={slug} />
      </Panel>

      <Panel title="Claves activas" actions={<span className="text-xs text-muted">{tokens.length} activas</span>}>
        {tokens.length === 0 ? (
          <EmptyState>Aún no hay ninguna clave.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="addon-sync-tokens">
            {tokens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-bone">
                    {t.name}
                    {t.own && <span className="ml-2 text-xs text-muted">(tuya)</span>}
                  </span>
                  <span className="block text-xs text-muted">
                    De {t.ownerName ?? "un oficial"}, acabada en {t.tokenHint}, creada el {formatDateTime(t.createdAt, guild.timezone)}
                    {t.lastUsedAt ? `, último envío el ${formatDateTime(t.lastUsedAt, guild.timezone)}` : ", aún sin usar"}
                  </span>
                </span>
                <ActionForm
                  action={revokeAddonSyncTokenAction.bind(null, slug, t.id)}
                  confirm={`¿Anular la clave «${t.name}»? El sincronizador que la usa dejará de enviar datos.`}
                  className="flex items-center gap-2"
                >
                  <SubmitButton size="sm" variant="danger" pendingLabel="Anulando…">
                    Anular
                  </SubmitButton>
                  <FormMessage />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Últimos envíos">
        {reports.length === 0 ? (
          <EmptyState>Todavía no ha llegado ningún dato del addon.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="addon-sync-reports">
            {reports.map((r) => (
              <li key={r.id} className="space-y-1 py-3 text-sm">
                <p className="flex flex-wrap gap-x-3 text-bone">
                  <span>{formatDateTime(r.createdAt, guild.timezone)}</span>
                  <span>
                    {r.tokenName}
                    {r.userName ? ` (${r.userName})` : ""}
                  </span>
                  {r.addonVersion && <span className="text-muted">addon {r.addonVersion}</span>}
                </p>
                <p className="text-muted">
                  {r.received} personajes recibidos: {r.updated} actualizados, {r.unchanged} sin cambios
                  {r.skippedOld > 0 ? `, ${r.skippedOld} ignorados por ser datos más viejos` : ""}.
                </p>
                {r.unmatched.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-muted">
                      {r.unmatched.length} no están en la web (o se llaman distinto)
                    </summary>
                    <p className="mt-1 text-muted">{r.unmatched.join(", ")}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
