import type { Metadata } from "next";
import Link from "next/link";
import { LootTable } from "@/components/loot-table";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { can } from "@/lib/authz/policy";
import { formatCalendarDate } from "@/lib/format";
import { guildWording } from "@/lib/guild-wording";
import { LOOT_RESPONSE_LABELS, LOOT_RESPONSES, type LootResponse } from "@/lib/loot/constants";
import { guildHref } from "@/lib/paths";
import { requireLootPage } from "@/server/loot-page";
import { listLoot, listRaidNights } from "@/server/services/loot";

export const metadata: Metadata = { title: "Botín" };

function isResponse(v: unknown): v is LootResponse {
  return typeof v === "string" && (LOOT_RESPONSES as readonly string[]).includes(v);
}

export default async function LootPage({ params, searchParams }: PageProps<"/[guild]/members/loot">) {
  const { guild: slug } = await params;
  const sp = await searchParams;
  const { guild, actor } = await requireLootPage(slug, guildHref(slug, "/members/loot"));
  const response = isResponse(sp.response) ? sp.response : null;
  const [nights, rows] = await Promise.all([listRaidNights(db, actor, 12), listLoot(db, actor, { response, limit: 200 })]);
  const base = guildHref(slug, "/members/loot");

  return (
    <div className="space-y-6">
      <PageHeader title="Botín" eyebrow={guildWording(guild).lootEyebrow}>
        Cada objeto que ha repartido la banda, tal como lo han registrado los oficiales.
        {can(actor, "loot.award") && (
          <>
            {" "}
            <Link href={guildHref(slug, "/admin/loot")} className="text-gold hover:underline">
              Registrar botín
            </Link>
          </>
        )}
      </PageHeader>

      <Panel title="Noches de banda">
        {nights.length === 0 ? (
          <EmptyState>Aún no hay noches de banda con botín.</EmptyState>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {nights.map((n) => (
              <li key={n.raidDate}>
                <Link
                  href={guildHref(slug, `/members/loot/raids/${n.raidDate}`)}
                  className="block rounded border border-line px-3 py-2 hover:border-gold-dim"
                >
                  <span className="font-semibold text-bone">{formatCalendarDate(n.raidDate)}</span>
                  <span className="block text-xs text-muted">
                    {n.items} objeto{n.items === 1 ? "" : "s"}
                    {n.instances.length > 0 && `, ${n.instances.join(", ")}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Todo el botín"
        actions={
          <nav aria-label="Filtrar por motivo" className="flex flex-wrap gap-1 text-xs">
            <Link href={base} aria-current={response ? undefined : "page"} className="rounded border border-line px-2 py-1 text-muted hover:text-gold aria-[current=page]:border-gold aria-[current=page]:text-gold">
              Todo
            </Link>
            {LOOT_RESPONSES.map((r) => (
              <Link
                key={r}
                href={`${base}?response=${r}`}
                aria-current={response === r ? "page" : undefined}
                className="rounded border border-line px-2 py-1 text-muted hover:text-gold aria-[current=page]:border-gold aria-[current=page]:text-gold"
              >
                {LOOT_RESPONSE_LABELS[r]}
              </Link>
            ))}
          </nav>
        }
      >
        <LootTable slug={slug} rows={rows} empty={response ? "Aún no se ha entregado botín por ese motivo." : undefined} />
      </Panel>
    </div>
  );
}
