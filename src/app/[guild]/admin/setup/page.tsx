import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { RankInsignia } from "@/components/rank-insignia";
import { PresetChoices } from "@/components/rank-preset-choices";
import { PageHeader, Panel, Tag } from "@/components/ui";
import { db } from "@/db";
import { TIER_LABELS } from "@/lib/authz/tiers";
import { can } from "@/lib/authz/policy";
import type { SetupStep } from "@/lib/guild-setup";
import { insigniaFor } from "@/lib/insignia";
import { DEFAULT_RANK_PRESET } from "@/lib/rank-presets";
import { guildHref } from "@/lib/paths";
import {
  applyRankPresetAction,
  confirmRanksAction,
  createDraftInviteAction,
  dismissSetupAction,
  neutralDefaultsAction,
  publishGuildAction,
  skipSetupStepAction,
  unpublishGuildAction,
} from "@/server/actions/setup";
import { requirePage } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { getGuildSetup } from "@/server/services/guild-setup";
import { isPreLaunch, verificationSupported } from "@/server/services/guild-verification";
import { VERSION_INFO } from "@/lib/game-versions";
import { listRanks } from "@/server/services/ranks";
import { SetupProgress, STEP_COPY, StepStatusIcon } from "./steps";

export const metadata: Metadata = { title: "Configuración" };

function SkipButton({ slug, step }: { slug: string; step: SetupStep }) {
  if (step.status === "done" || step.key === "publish") return null;
  const skipped = step.status === "skipped";
  return (
    <ActionForm action={skipSetupStepAction.bind(null, slug, step.key, !skipped)} toast={false}>
      <SubmitButton variant="ghost" size="sm" pendingLabel={skipped ? "Restaurando…" : "Omitiendo…"}>
        {skipped ? "Deshacer omisión" : "Omitir por ahora"}
      </SubmitButton>
    </ActionForm>
  );
}

export default async function SetupPage({ params }: PageProps<"/[guild]/admin/setup">) {
  const { guild: slug } = await params;
  const { actor } = await requirePage(slug, "guild.settings", guildHref(slug, "/admin/setup"));
  const [{ guild, facts, summary }, ranks, current] = await Promise.all([getGuildSetup(db, actor), listRanks(db, actor.guildId), getRequestHost()]);
  const siteUrl = guildOrigin(guild.slug, current);
  const h = (path: string) => guildHref(slug, path);
  const order = guild.preset === "order";
  const canManageRanks = can(actor, "rank.manage");
  const founderNotGm = !guild.verifiedAt ? guild.setup.founderNotGm : undefined;
  const inviteUrl = guild.setup.inviteCode ? `${siteUrl}/apply?invite=${guild.setup.inviteCode}` : null;

  const extra: Partial<Record<SetupStep["key"], ReactNode>> = {
    ranks: !order && canManageRanks && (
      <div className="space-y-4">
        <div>
          <p className="field-label">Tus rangos ahora</p>
          <ol className="flex flex-wrap gap-2">
            {ranks.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 rounded border border-line px-2 py-1 text-xs text-bone">
                <RankInsignia insignia={insigniaFor(r)} tier={r.tier} size={18} />
                {r.name}
                <span className="text-muted">{TIER_LABELS[r.tier]}</span>
              </li>
            ))}
          </ol>
        </div>
        {!summary.offerNeutralDefaults && (
          <>
            <ActionForm
              action={applyRankPresetAction.bind(null, slug)}
              className="space-y-3"
              confirm="¿Sustituir los nombres de tus rangos por esta plantilla? Los miembros conservan su nivel de permisos, y quien esté en un rango que la plantilla no tenga pasa al más parecido."
            >
              <PresetChoices name="preset" defaultKey={DEFAULT_RANK_PRESET} />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton variant="ghost" size="sm" pendingLabel="Aplicando…">
                  Aplicar plantilla
                </SubmitButton>
                <FormMessage />
              </div>
            </ActionForm>
            {summary.steps.find((s) => s.key === "ranks")?.status !== "done" && (
              <ActionForm action={confirmRanksAction.bind(null, slug)} className="flex flex-wrap items-center gap-3">
                <SubmitButton size="sm" pendingLabel="Confirmando…">
                  Mantener estos rangos
                </SubmitButton>
                <span className="text-xs text-muted">Puedes editarlos cuando quieras.</span>
                <FormMessage />
              </ActionForm>
            )}
          </>
        )}
      </div>
    ),
    invite: (
      <div className="space-y-2 text-sm">
        <p>
          Tu sitio: <a href={siteUrl} className="link font-mono break-all">{siteUrl.replace(/^https?:\/\//, "")}</a>
        </p>
        {!guild.publishedAt &&
          (guild.setup.inviteCode ? (
            <p data-testid="draft-invite">
              Mientras seas un borrador, tus compañeros de hermandad envían su solicitud con este enlace privado:{" "}
              <span className="font-mono break-all text-bone">{`${siteUrl}/apply?invite=${guild.setup.inviteCode}`}</span>
            </p>
          ) : (
            <ActionForm action={createDraftInviteAction.bind(null, slug)} className="flex flex-wrap items-center gap-3">
              <span className="text-muted">Las solicitudes se abren al publicar. Hasta entonces, tus compañeros pueden solicitar entrar con un enlace privado.</span>
              <SubmitButton variant="ghost" size="sm" pendingLabel="Creando…">
                Crear enlace de invitación
              </SubmitButton>
              <FormMessage />
            </ActionForm>
          ))}
      </div>
    ),
    verify: !verificationSupported(guild.gameVersion) ? (
      <p className="rounded border border-gold-dim/60 bg-gold/5 px-3 py-2 text-sm text-bone" data-testid="setup-verify-coming-soon">
        Esto puede esperar. La verificación con Battle.net para hermandades de {VERSION_INFO[guild.gameVersion].label} llegará pronto;
        de momento, omite este paso.
      </p>
    ) : isPreLaunch(new Date(), guild.gameVersion) && (
      <p className="rounded border border-gold-dim/60 bg-gold/5 px-3 py-2 text-sm text-bone">
        Esto puede esperar. La verificación se abre cuando existan personajes de WoW: Forever, desde el lanzamiento el 4 de noviembre
        de 2026, y necesita la cuenta de Battle.net del propio maestro de la hermandad en el juego.
      </p>
    ),
    publish: (
      <div id="publish" className="scroll-mt-24 space-y-3">
        {guild.publishedAt ? (
          <ActionForm
            action={unpublishGuildAction.bind(null, slug)}
            confirm="¿Devolver la hermandad a borrador? Sale del directorio y de los buscadores, y las solicitudes se cierran hasta que vuelvas a publicar."
            className="flex flex-wrap items-center gap-3"
          >
            <p className="text-sm text-bone">Tu hermandad es pública.</p>
            <SubmitButton variant="ghost" size="sm" pendingLabel="Despublicando…">
              Volver a borrador
            </SubmitButton>
            <FormMessage />
          </ActionForm>
        ) : (
          <>
            {summary.publishMissing.length > 0 && (
              <div className="text-sm" data-testid="publish-missing">
                <p className="text-bone">Antes de publicar:</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted">
                  {summary.publishMissing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            <ActionForm action={publishGuildAction.bind(null, slug)} className="flex flex-wrap items-center gap-3">
              <fieldset disabled={!summary.canPublish} className="disabled:opacity-50">
                <SubmitButton variant="gold" pendingLabel="Publicando…">
                  Publicar hermandad
                </SubmitButton>
              </fieldset>
              <FormMessage />
            </ActionForm>
          </>
        )}
      </div>
    ),
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Configura ${guild.name}`} eyebrow="Configuración de la hermandad">
        <div className="mx-auto max-w-md space-y-2">
          <p className="text-sm" data-testid="setup-progress">
            {summary.done} de {summary.total} pasos hechos
          </p>
          <SetupProgress done={summary.done} total={summary.total} />
        </div>
      </PageHeader>

      {founderNotGm && (
        <Panel title="Verifica el maestro de la hermandad" className="border-gold-dim/70" actions={<Tag>Sin verificar</Tag>}>
          <div className="space-y-2 text-sm" data-testid="founder-not-gm">
            <p className="leading-relaxed text-bone">
              {founderNotGm.characterName} está en {guild.name} en el juego
              {founderNotGm.rank != null ? ` (rango ${founderNotGm.rank})` : ""}, pero no es su maestro de la hermandad. Tu hermandad
              funciona del todo como borrador sin verificar; solo el maestro de la hermandad del juego puede verificarla.
            </p>
            <p className="leading-relaxed text-muted">
              Envía al maestro de la hermandad este enlace de invitación. Cuando se haya unido, dale un rango de administrador en Miembros;
              vinculará Battle.net en Mis personajes y comprobará la verificación en Ajustes de la hermandad. Después podrás cederle el rango
              más alto desde el mismo panel.
            </p>
            {inviteUrl && (
              <p data-testid="founder-invite">
                Enlace de invitación: <span className="font-mono break-all text-bone">{inviteUrl}</span>
              </p>
            )}
          </div>
        </Panel>
      )}

      {summary.offerNeutralDefaults && (
        <Panel title="Empieza con predeterminados neutros" className="border-gold-dim/70" actions={<Tag>Recomendado</Tag>}>
          <div className="space-y-4 text-sm" data-testid="neutral-defaults">
            <p className="leading-relaxed text-muted">
              Tu hermandad aún tiene{" "}
              {facts.ranksMatchOrder && facts.contentMatchesOrder ? "los rangos y las páginas" : facts.ranksMatchOrder ? "los rangos" : "las páginas"} de la
              Order of Saint Michael, de antes de que las hermandades nuevas recibieran predeterminados neutros. Sustitúyelos por una escala y unas
              páginas de ejemplo. Los miembros conservan su nivel de permisos, las páginas que hayas reescrito se quedan como están y el texto
              antiguo se guarda en el historial de la página.
            </p>
            <ActionForm
              action={neutralDefaultsAction.bind(null, slug)}
              className="space-y-3"
              confirm="¿Sustituir los rangos y las páginas sin editar de la Order of Saint Michael por predeterminados neutros?"
            >
              <PresetChoices name="preset" defaultKey={DEFAULT_RANK_PRESET} />
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton pendingLabel="Sustituyendo…">Usar predeterminados neutros</SubmitButton>
                <FormMessage />
              </div>
            </ActionForm>
          </div>
        </Panel>
      )}

      <ol className="space-y-3" data-testid="setup-steps">
        {summary.steps.map((step, i) => {
          const copy = STEP_COPY[step.key];
          return (
            <li key={step.key} className="panel p-4 sm:p-5" data-testid={`setup-step-${step.key}`} data-status={step.status}>
              <div className="flex items-start gap-3">
                <StepStatusIcon status={step.status} className="mt-0.5" />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className={step.status === "todo" ? "font-display text-gold" : "font-display text-gold-dim"}>
                      <span className="text-muted">{i + 1}.</span> {copy.title}
                    </h2>
                    {step.requiredToPublish && step.status !== "done" && !guild.publishedAt && <Tag>Necesario para publicar</Tag>}
                    {step.status === "skipped" && <Tag>Omitido</Tag>}
                  </div>
                  <p className="text-sm leading-relaxed text-muted">{copy.body}</p>
                  {extra[step.key]}
                  {step.key !== "publish" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={h(copy.href)} className={step.status === "done" ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}>
                        {step.status === "done" ? "Revisar" : copy.cta}
                      </Link>
                      <SkipButton slug={slug} step={step} />
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-center gap-3 text-sm text-muted">
        {summary.dismissed ? (
          <ActionForm action={dismissSetupAction.bind(null, slug, false)}>
            <SubmitButton variant="ghost" size="sm">
              Mostrar esta lista en la portada de administración
            </SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={dismissSetupAction.bind(null, slug, true)}>
            <SubmitButton variant="ghost" size="sm">
              Ocultar esta lista de la portada de administración
            </SubmitButton>
          </ActionForm>
        )}
        <Link href={h("/admin")} className="link">
          Ir a la portada de administración
        </Link>
      </div>
    </div>
  );
}
