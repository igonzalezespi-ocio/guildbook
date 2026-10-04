import type { Metadata } from "next";
import Link from "next/link";
import { AddonIcon } from "@/components/addon-icon";
import { Markdown } from "@/components/markdown";
import { EmptyState, PageHeader, Panel, StatusPill } from "@/components/ui";
import { db } from "@/db";
import { can } from "@/lib/authz/policy";
import { guildWording } from "@/lib/guild-wording";
import { guildHref } from "@/lib/paths";
import { getGuild, getViewer } from "@/server/context";
import { listAddons } from "@/server/services/content";

export const metadata: Metadata = { title: "Addons" };

export default async function AddonsPage({ params }: PageProps<"/[guild]/addons">) {
  const { guild: slug } = await params;
  const guild = await getGuild(slug);
  const [addonList, viewer] = await Promise.all([listAddons(db, guild.id), getViewer(guild.id)]);
  const vigilOpen = can(viewer.actor, "vigil.use");
  const wording = guildWording(guild);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={wording.addonsTitle} eyebrow="Hechos por nuestros miembros">
        {wording.addonsIntro}
      </PageHeader>
      {addonList.length === 0 && <EmptyState>De momento, el taller está en silencio.</EmptyState>}
      <div className="space-y-4">
        {addonList.map((a) => (
          <Panel key={a.id}>
            <div className="flex items-start gap-3 sm:gap-4">
              <AddonIcon addon={a} size={48} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold text-gold">{a.name}</h2>
                  <StatusPill status={a.status} />
                </div>
                <p className="text-bone/90">{a.summary}</p>
                {a.descriptionMd && (
                  <div className="mt-3 text-sm">
                    <Markdown tone="dark">{a.descriptionMd}</Markdown>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  {a.slug === "vigil" && vigilOpen && (
                    <Link href={guildHref(slug, "/vigil")} className="btn btn-primary btn-sm">
                      Abrir Vigil
                    </Link>
                  )}
                  {a.version && <span className="text-muted">v{a.version}</span>}
                  {a.downloadUrl && (
                    <a href={a.downloadUrl} className="btn btn-primary btn-sm" rel="noopener noreferrer">
                      Descargar
                    </a>
                  )}
                  {a.sourceUrl && (
                    <a href={a.sourceUrl} className="link" rel="noopener noreferrer">
                      Código fuente
                    </a>
                  )}
                </div>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </div>
  );
}
