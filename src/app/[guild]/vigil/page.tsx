import type { Metadata } from "next";
import Link from "next/link";
import { AddonIcon } from "@/components/addon-icon";
import { ClassName, EmptyState, PageHeader, Panel, Tag } from "@/components/ui";
import { DefaultVisibilityForm } from "@/components/vigil/visibility-form";
import { db } from "@/db";
import { formatDateTime } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { formatDuration, scoreTone } from "@/lib/vigil/format";
import { getModel } from "@/lib/vigil/rotations";
import { VISIBILITY_LABELS } from "@/lib/vigil/visibility";
import { requirePage } from "@/server/context";
import {
  getVigilPreferences,
  listOwnVigilReports,
  listSharedVigilReports,
  type SharedVigilReport,
  type VigilReportListItem,
} from "@/server/services/vigil";

export const metadata: Metadata = { title: "Vigil" };

function ReportRow({
  slug,
  r,
  timezone,
  owner,
}: {
  slug: string;
  r: VigilReportListItem | SharedVigilReport;
  timezone: string;
  owner?: string | null;
}) {
  return (
    <li>
      <Link
        href={guildHref(slug, `/vigil/reports/${r.id}`)}
        className="flex items-center gap-3 rounded px-2 py-2.5 hover:bg-ink/50 focus-visible:bg-ink/50"
      >
        <span className={`w-10 text-center text-xl font-bold ${scoreTone(r.score)}`}>{r.score}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-bone">{r.fightLabel}</span>
          <span className="block text-xs text-muted">
            {r.characterName && r.characterClass ? (
              <ClassName wowClass={r.characterClass}>
                {r.characterName} {r.characterSurname}
              </ClassName>
            ) : (
              r.playerName
            )}
            {owner && <span> ({owner})</span>}
            {", "}
            {getModel(r.modelId)?.label ?? "Análisis general"}, {formatDuration(r.durationMs)},{" "}
            {formatDateTime(r.fightStartedAt, timezone)}
          </span>
        </span>
        <span className="hidden gap-1 sm:flex">
          {r.fightKind === "boss" && <Tag>Jefe</Tag>}
          {!owner && <Tag>{VISIBILITY_LABELS[r.visibility]}</Tag>}
        </span>
      </Link>
    </li>
  );
}

export default async function VigilPage({ params }: PageProps<"/[guild]/vigil">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "vigil.use", guildHref(slug, "/vigil"));
  const [mine, shared, prefs] = await Promise.all([
    listOwnVigilReports(db, actor),
    listSharedVigilReports(db, actor),
    getVigilPreferences(db, actor),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Vigil" eyebrow="Vigila cada pull">
        <span className="inline-flex flex-col items-center gap-3">
          <AddonIcon addon={{ slug: "vigil", name: "Vigil" }} size={56} />
          Sube un registro de combate para ver tu rotación, tiempos activos, tiempo inactivo y una estimación de lo que
          habría logrado una ejecución perfecta, combate a combate.
        </span>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={guildHref(slug, "/vigil/upload")} className="btn btn-primary">
          Subir un registro de combate
        </Link>
        <span className="flex flex-wrap items-center gap-4 text-sm">
          <Link href={guildHref(slug, "/vigil/companion")} className="link">
            Conectar la app de Vigil
          </Link>
          <Link href={guildHref(slug, "/addons")} className="link">
            Consigue el addon de Vigil
          </Link>
        </span>
      </div>

      <Panel title="Mis informes" actions={<span className="text-xs text-muted">{mine.length} guardados</span>}>
        <div className="mb-4 rounded border border-line bg-ink/30 p-3">
          <p className="mb-2 text-xs tracking-widest text-muted uppercase">Compartir por defecto</p>
          <DefaultVisibilityForm slug={slug} value={prefs.defaultVisibility} />
        </div>
        {mine.length === 0 ? (
          <EmptyState>Aún no hay informes. Tu primer registro está a una subida de distancia.</EmptyState>
        ) : (
          <ul className="divide-y divide-line" data-testid="vigil-my-reports">
            {mine.map((r) => (
              <ReportRow key={r.id} slug={slug} r={r} timezone={guild.timezone} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Compartidos contigo">
        {shared.length === 0 ? (
          <EmptyState>Cuando los miembros compartan informes con {actor.tier === "officer" || actor.tier === "admin" ? "los oficiales o con " : ""}la hermandad, aparecerán aquí.</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {shared.map((r) => (
              <ReportRow key={r.id} slug={slug} r={r} timezone={guild.timezone} owner={r.ownerName} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
