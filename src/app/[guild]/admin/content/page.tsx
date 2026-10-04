import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { formatDateTime } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { requirePage } from "@/server/context";
import { listContentPages } from "@/server/services/content";

export const metadata: Metadata = { title: "Reglamento e historia" };

export default async function ContentListPage({ params }: PageProps<"/[guild]/admin/content">) {
  const { guild: slug } = await params;
  const { guild } = await requirePage(slug, "content.edit", guildHref(slug, "/admin/content"));
  const pages = await listContentPages(db, guild.id);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Reglamento e historia" />
      <ul className="space-y-2">
        {pages.map((p) => (
          <li key={p.id}>
            <Link
              href={guildHref(slug, `/admin/content/${p.slug}`)}
              className="panel flex items-center justify-between p-4 hover:border-gold-dim"
            >
              <span className="font-display text-gold">{p.title}</span>
              <span className="text-xs text-muted">Actualizado {formatDateTime(p.updatedAt, guild.timezone)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
