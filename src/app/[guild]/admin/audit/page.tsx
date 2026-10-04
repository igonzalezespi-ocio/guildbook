import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { formatDateTime } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { requirePage } from "@/server/context";
import { listAuditLog } from "@/server/services/content";

export const metadata: Metadata = { title: "Registro de auditoría" };

export default async function AuditPage({ params }: PageProps<"/[guild]/admin/audit">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "audit.view", guildHref(slug, "/admin/audit"));
  const rows = await listAuditLog(db, actor, 300);

  return (
    <div>
      <PageHeader title="Registro de auditoría" eyebrow="Cada acción de los oficiales: quién y cuándo" />
      {rows.length === 0 && <EmptyState>Aún no hay acciones registradas.</EmptyState>}
      <ul className="space-y-2">
        {rows.map(({ entry, actorName, actorDiscord, targetName }) => (
          <li key={entry.id} className="panel p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-semibold text-gold">{actorName ?? "Sistema"}</span>
                {actorDiscord && <span className="text-muted"> @{actorDiscord}</span>}
                <span className="ml-2 rounded bg-ink px-1.5 py-0.5 font-mono text-xs">{entry.action}</span>
                {targetName && <span className="ml-2">{targetName}</span>}
              </span>
              <time className="text-xs text-muted" dateTime={entry.createdAt.toISOString()}>
                {formatDateTime(entry.createdAt, guild.timezone)}
              </time>
            </div>
            {(entry.before != null || entry.after != null) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-muted">Detalles</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-ink p-2 text-xs text-muted">
                  {JSON.stringify({ target: `${entry.targetType}:${entry.targetId ?? "—"}`, before: entry.before, after: entry.after }, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
