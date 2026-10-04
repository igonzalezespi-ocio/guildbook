import type { Metadata } from "next";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { PageHeader, Panel, Tag } from "@/components/ui";
import { db } from "@/db";
import { formatDate } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { addDomainAction, removeDomainAction, updateGuildSettingsAction, verifyDomainAction } from "@/server/actions/admin";
import { requirePage } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { dnsInstructions, type GuildDomain, listGuildDomains, MAX_DOMAINS_PER_GUILD } from "@/server/services/domains";
import { vercelConfigFromEnv } from "@/server/vercel-domains";
import { ConfirmedJoinPanel } from "./confirmed-join-panel";
import { DeleteGuildPanel } from "./delete-guild-panel";
import { GuildSettingsForm } from "./settings-form";
import { TabardSection } from "./tabard-section";
import { VerifyGuildPanel } from "./verify-guild-panel";

export const metadata: Metadata = { title: "Ajustes de la hermandad" };

const STATUS_LABELS: Record<GuildDomain["status"], { label: string; className: string }> = {
  pending: { label: "Esperando al DNS", className: "border-gold-dim text-gold" },
  verified: { label: "Verificado", className: "border-emerald-700 text-emerald-300" },
  failed: { label: "Sin verificar", className: "border-crimson text-red-300" },
};

function DomainCard({ slug, domain, timezone }: { slug: string; domain: GuildDomain; timezone: string }) {
  const status = STATUS_LABELS[domain.status];
  return (
    <li className="space-y-3 rounded border border-line p-4" data-testid="custom-domain">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-sm break-all text-bone">{domain.domain}</p>
        <span className={`rounded border px-2 py-0.5 text-xs ${status.className}`}>{status.label}</span>
      </div>
      {domain.lastError && <p className="text-sm text-red-300">{domain.lastError}</p>}
      {domain.status !== "verified" && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-gold-dim">
              <tr>
                <th className="py-1 pr-3 font-normal">Tipo</th>
                <th className="py-1 pr-3 font-normal">Nombre</th>
                <th className="py-1 font-normal">Valor</th>
              </tr>
            </thead>
            <tbody className="font-mono text-bone">
              {dnsInstructions(domain).map((r) => (
                <tr key={r.type} className="border-t border-line align-top">
                  <td className="py-1.5 pr-3">{r.type}</td>
                  <td className="py-1.5 pr-3 break-all">{r.name}</td>
                  <td className="py-1.5 break-all">{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Añadido el {formatDate(domain.createdAt, timezone)}
        {domain.lastCheckedAt && <>. Última comprobación: {formatDate(domain.lastCheckedAt, timezone)}</>}
        {domain.verifiedAt && <>. Verificado el {formatDate(domain.verifiedAt, timezone)}</>}
      </p>
      <div className="flex flex-wrap gap-2">
        <ActionForm action={verifyDomainAction.bind(null, slug, domain.id)}>
          <SubmitButton size="sm" variant="ghost">
            {domain.status === "verified" ? "Volver a comprobar" : "Comprobar verificación"}
          </SubmitButton>
          <FormMessage className="mt-2" />
        </ActionForm>
        <ActionForm action={removeDomainAction.bind(null, slug, domain.id)} confirm={`¿Desconectar ${domain.domain}?`}>
          <SubmitButton size="sm" variant="danger">
            Quitar
          </SubmitButton>
        </ActionForm>
      </div>
    </li>
  );
}

export default async function GuildSettingsPage({ params }: PageProps<"/[guild]/admin/guild">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "guild.settings", guildHref(slug, "/admin/guild"));
  const [domains, current] = await Promise.all([listGuildDomains(db, guild.id), getRequestHost()]);
  const subdomain = guildOrigin(guild.slug, current);
  const vercelManaged = vercelConfigFromEnv() !== null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title="Ajustes de la hermandad" />
      <Panel>
        <GuildSettingsForm action={updateGuildSettingsAction.bind(null, slug)} guild={guild} />
      </Panel>

      <div id="verify" className="scroll-mt-24">
        <VerifyGuildPanel guild={guild} />
      </div>

      <div id="confirmed-members" className="scroll-mt-24">
        <ConfirmedJoinPanel guild={guild} />
      </div>

      <div id="tabard" className="scroll-mt-24">
        <TabardSection guild={guild} />
      </div>

      <Panel title="Dominios propios" actions={<Tag>Opcional</Tag>}>
        <div className="space-y-4 text-sm">
          <p className="leading-relaxed text-muted">
            Tu hermandad siempre está en <span className="font-mono text-bone">{subdomain.replace(/^https?:\/\//, "")}</span>. También
            puedes servirla en un dominio tuyo, como <span className="font-mono text-bone">tuhermandad.org</span>. Añade el dominio, crea en tu
            registrador los registros DNS que se muestran y comprueba la verificación.
            {!vercelManaged && " Cuando esté verificado, el equipo de Guildbook lo conecta al proyecto de alojamiento."}
          </p>
          {domains.length > 0 && (
            <ul className="space-y-3">
              {domains.map((d) => (
                <DomainCard key={d.id} slug={slug} domain={d} timezone={guild.timezone} />
              ))}
            </ul>
          )}
          {domains.length < MAX_DOMAINS_PER_GUILD && (
            <ActionForm action={addDomainAction.bind(null, slug)} className="space-y-3">
              <Field label="Dominio" name="domain" hint="Sin https://, p. ej. tuhermandad.org o www.tuhermandad.org">
                <input id="domain" name="domain" className="field" placeholder="tuhermandad.org" autoComplete="off" required />
              </Field>
              <FormMessage />
              <SubmitButton variant="ghost">Añadir dominio</SubmitButton>
            </ActionForm>
          )}
        </div>
      </Panel>

      <DeleteGuildPanel slug={slug} name={guild.name} actor={actor} />
    </div>
  );
}
