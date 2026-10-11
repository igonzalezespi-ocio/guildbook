import type { Metadata } from "next";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { CLASS_INFO } from "@/lib/game";
import { formatDateTime } from "@/lib/format";
import { GROUP_KIND_LABELS, GROUP_ROLE_LABELS, GROUP_ROLES, GROUP_STATUS_LABELS } from "@/lib/groups";
import { guildHref } from "@/lib/paths";
import { requirePage } from "@/server/context";
import { type GroupView, listUpcomingGroups, rosterOf } from "@/server/services/groups";

export const metadata: Metadata = { title: "Grupos" };

function Person({ s }: { s: GroupView["signups"][number] }) {
  return (
    <span style={{ color: CLASS_INFO[s.wowClass].color }}>
      {s.characterName}
      <span className="ml-1 text-xs text-muted">{s.level}</span>
    </span>
  );
}

function GroupCard({ group, timezone }: { group: GroupView; timezone: string }) {
  const roster = rosterOf(group);
  const slots = { tank: group.tanks, healer: group.healers, dps: group.dps };
  const taken = GROUP_ROLES.reduce((n, role) => n + roster.confirmed[role].length, 0);
  const total = group.tanks + group.healers + group.dps;
  return (
    <Panel
      title={group.instanceName}
      actions={
        <span className="text-xs text-muted">
          {taken}/{total}
        </span>
      }
    >
      <p className="mb-3 flex flex-wrap gap-x-3 text-sm text-muted">
        <span className="text-bone">{formatDateTime(group.startsAt, timezone)}</span>
        <span>{GROUP_KIND_LABELS[group.kind]}</span>
        {group.leader?.name && <span>Líder: {group.leader.name}</span>}
        {group.status !== "open" && <span className="text-gold">{GROUP_STATUS_LABELS[group.status]}</span>}
      </p>
      {group.notes && <p className="mb-3 text-sm whitespace-pre-line text-bone">{group.notes}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {GROUP_ROLES.map((role) => (
          <div key={role}>
            <p className="mb-1 font-display text-xs tracking-wider text-muted uppercase">
              {GROUP_ROLE_LABELS[role]} {roster.confirmed[role].length}/{slots[role]}
            </p>
            {roster.confirmed[role].length === 0 ? (
              <p className="text-sm text-muted">Nadie aún</p>
            ) : (
              <ol className="space-y-0.5 text-sm">
                {roster.confirmed[role].map((s) => (
                  <li key={s.userId}>
                    <Person s={s} />
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))}
      </div>
      {roster.reserves.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 font-display text-xs tracking-wider text-muted uppercase">Reserva</p>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm">
            {roster.reserves.map((s) => (
              <li key={s.userId}>
                <Person s={s} /> <span className="text-xs text-muted">({GROUP_ROLE_LABELS[s.role]})</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

export default async function GroupsPage({ params }: PageProps<"/[guild]/members/groups">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "member.area", guildHref(slug, "/members/groups"));
  const groups = await listUpcomingGroups(db, actor);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Grupos" eyebrow="Bandas y mazmorras">
        Lo que se está organizando en el Discord de la hermandad. Para apuntarte, usa los botones del mensaje del grupo en
        Discord; aquí se ve quién va.
      </PageHeader>
      {groups.length === 0 ? (
        <Panel title="Próximos grupos">
          <EmptyState>No hay nada organizado. Crea un grupo en Discord con /grupo crear.</EmptyState>
        </Panel>
      ) : (
        <div className="space-y-4" data-testid="groups-list">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} timezone={guild.timezone} />
          ))}
        </div>
      )}
    </div>
  );
}
