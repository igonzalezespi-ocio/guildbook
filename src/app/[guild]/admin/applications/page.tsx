import type { Metadata } from "next";
import Link from "next/link";
import { ClassName, EmptyState, FactionBadge, PageHeader, RoleBadge, StatusPill, VerificationBadge } from "@/components/ui";
import { db } from "@/db";
import { formatDate } from "@/lib/format";
import { APPLICATION_STATUS_LABELS, fullName, specLabel } from "@/lib/game";
import { guildHref } from "@/lib/paths";
import { requirePage } from "@/server/context";
import { listApplications } from "@/server/services/applications";

export const metadata: Metadata = { title: "Solicitudes" };

const FILTERS = ["pending", "trial", "accepted", "declined", "withdrawn"] as const;

export default async function ApplicationsPage({ params, searchParams }: PageProps<"/[guild]/admin/applications">) {
  const { guild: slug } = await params;
  const sp = await searchParams;
  const status = FILTERS.find((f) => f === sp.status) ?? "pending";
  const { guild, actor } = await requirePage(slug, "application.review", guildHref(slug, "/admin/applications"));
  const rows = await listApplications(db, actor, status);

  return (
    <div>
      <PageHeader title="Solicitudes" />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`${guildHref(slug, "/admin/applications")}?status=${f}`}
            className={`btn btn-sm capitalize ${f === status ? "btn-primary" : "btn-ghost"}`}
          >
            {APPLICATION_STATUS_LABELS[f]}
          </Link>
        ))}
      </div>
      {rows.length === 0 && <EmptyState>No hay solicitudes en «{APPLICATION_STATUS_LABELS[status]}».</EmptyState>}
      <ul className="space-y-2">
        {rows.map(({ application: a, applicant }) => (
          <li key={a.id}>
            <Link
              href={guildHref(slug, `/admin/applications/${a.id}`)}
              className="panel flex flex-wrap items-center justify-between gap-3 p-4 hover:border-gold-dim"
            >
              <div>
                <p className="text-lg">
                  <ClassName wowClass={a.wowClass}>{fullName(a.characterName, a.characterSurname)}</ClassName>{" "}
                  <span className="text-sm text-muted">
                    {specLabel(a.spec)}, nivel {a.level}
                  </span>
                </p>
                <p className="flex flex-wrap gap-x-4 text-xs text-muted">
                  <span>
                    {applicant.name} ({a.discordHandle})
                  </span>
                  <span>Solicitó el {formatDate(a.createdAt, guild.timezone)}</span>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <VerificationBadge verified={a.verified} />
                {!guild.faction && <FactionBadge faction={a.faction} />}
                <RoleBadge role={a.role} />
                <StatusPill status={a.status} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
