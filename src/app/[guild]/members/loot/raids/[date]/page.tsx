import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { LootTable } from "@/components/loot-table";
import { PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { formatCalendarDate } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { requireLootPage } from "@/server/loot-page";
import { raidLoot, type LootRow } from "@/server/services/loot";

export const metadata: Metadata = { title: "Botín de la banda" };

/** Groups a night's loot by instance, then boss, in the order it dropped. */
function byBoss(rows: LootRow[]) {
  const groups = new Map<string, { title: string; rows: LootRow[] }>();
  for (const row of [...rows].reverse()) {
    const title = [row.instanceName, row.bossName].filter(Boolean).join(", ") || "Otro botín";
    const group = groups.get(title) ?? { title, rows: [] };
    group.rows.push(row);
    groups.set(title, group);
  }
  return [...groups.values()];
}

export default async function RaidLootPage({ params }: PageProps<"/[guild]/members/loot/raids/[date]">) {
  const { guild: slug, date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) notFound();
  const { actor } = await requireLootPage(slug, guildHref(slug, `/members/loot/raids/${date}`));
  const rows = await raidLoot(db, actor, date);
  const given = rows.filter((r) => !r.reversal).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Botín", href: guildHref(slug, "/members/loot") }, { label: formatCalendarDate(date) }]} />
      <PageHeader title={formatCalendarDate(date, "full")} eyebrow="Botín de la banda">
        {given} objeto{given === 1 ? "" : "s"} entregado{given === 1 ? "" : "s"}
      </PageHeader>
      {rows.length === 0 ? (
        <Panel>
          <LootTable slug={slug} rows={[]} empty="No se registró botín esa noche." />
        </Panel>
      ) : (
        byBoss(rows).map((g) => (
          <Panel key={g.title} title={g.title}>
            <LootTable slug={slug} rows={g.rows} showDate={false} />
          </Panel>
        ))
      )}
    </div>
  );
}
