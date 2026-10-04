import type { Metadata } from "next";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { CompanionPairing } from "@/components/vigil/companion-pairing";
import { db } from "@/db";
import { formatDateTime } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { VISIBILITY_LABELS } from "@/lib/vigil/visibility";
import { revokeCompanionDeviceAction } from "@/server/actions/vigil";
import { requirePage } from "@/server/context";
import { getRequestHost } from "@/server/hosts";
import { getVigilPreferences } from "@/server/services/vigil";
import { listCompanionDevices } from "@/server/services/vigil-companion";

export const metadata: Metadata = { title: "Conectar la app de Vigil" };

export default async function VigilCompanionPage({ params }: PageProps<"/[guild]/vigil/companion">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "vigil.use", guildHref(slug, "/vigil/companion"));
  const [devices, prefs, current] = await Promise.all([listCompanionDevices(db, actor), getVigilPreferences(db, actor), getRequestHost()]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Conectar la app de Vigil" eyebrow="Análisis en directo en tu segunda pantalla">
        La app complementaria vigila tu archivo de registro de combate mientras juegas, te avisa de la rotación en el
        momento y sube aquí cada combate. Solo lee el registro del disco; nunca toca el juego.
      </PageHeader>

      <Panel title="Consigue la app">
        <div className="flex flex-wrap items-center gap-4">
          <p className="min-w-0 flex-1 text-sm text-muted">
            Vigil funciona en Windows, macOS y Linux y se actualiza sola. La página de descarga también explica cómo
            activar el registro de combate.
          </p>
          <a href={`${current.apexOrigin}/vigil`} className="btn btn-primary" data-testid="companion-download-link">
            Descargar la app
          </a>
        </div>
      </Panel>

      <Panel title="Empareja un ordenador">
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Abre la app de Vigil y ve a Settings.</li>
          <li>Crea un código abajo e introdúcelo en Pair with the site, o pulsa Abrir en la app.</li>
          <li>
            Los informes nuevos usan tu opción de compartir por defecto (
            <strong className="text-bone">{VISIBILITY_LABELS[prefs.defaultVisibility]}</strong>)
            salvo que elijas otra cosa en la app.
          </li>
        </ol>
        <CompanionPairing slug={slug} />
      </Panel>

      <Panel title="Apps emparejadas" actions={<span className="text-xs text-muted">{devices.length} activas</span>}>
        {devices.length === 0 ? (
          <EmptyState>Aún no hay ninguna app emparejada.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="companion-devices">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-bone">{d.name}</span>
                  <span className="block text-xs text-muted">
                    Token acabado en {d.tokenHint}, emparejada el {formatDateTime(d.createdAt, guild.timezone)}
                    {d.lastUsedAt ? `, último uso el ${formatDateTime(d.lastUsedAt, guild.timezone)}` : ", aún sin usar"}
                  </span>
                </span>
                <ActionForm
                  action={revokeCompanionDeviceAction.bind(null, slug, d.id)}
                  confirm={`¿Revocar ${d.name}? Dejará de subir informes hasta que la vuelvas a emparejar.`}
                  className="flex items-center gap-2"
                >
                  <SubmitButton size="sm" variant="danger" pendingLabel="Revocando…">
                    Revocar
                  </SubmitButton>
                  <FormMessage />
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
