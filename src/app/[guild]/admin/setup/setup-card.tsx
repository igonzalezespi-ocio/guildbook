import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import type { SetupSummary } from "@/lib/guild-setup";
import { guildHref } from "@/lib/paths";
import { dismissSetupAction } from "@/server/actions/setup";
import { SetupProgress, STEP_COPY, StepStatusIcon } from "./steps";

/** The admin home's summary of the setup checklist: progress and the next few steps, until finished or hidden. */
export function SetupCard({ slug, summary }: { slug: string; summary: SetupSummary }) {
  const next = summary.steps.filter((s) => s.status === "todo").slice(0, 3);
  return (
    <section className="panel border-gold-dim/70 p-4 sm:p-6" aria-labelledby="setup-card-heading" data-testid="setup-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="setup-card-heading" className="text-lg font-semibold text-gold">
            Termina de configurar tu hermandad
          </h2>
          <p className="mt-1 text-sm text-muted">
            {summary.done} de {summary.total} pasos hechos
          </p>
        </div>
        <ActionForm action={dismissSetupAction.bind(null, slug, true)}>
          <SubmitButton variant="ghost" size="sm">
            Ocultar
          </SubmitButton>
        </ActionForm>
      </div>
      <div className="mt-3">
        <SetupProgress done={summary.done} total={summary.total} />
      </div>
      {next.length > 0 && (
        <ul className="mt-4 divide-y divide-line">
          {next.map((step) => (
            <li key={step.key} className="flex items-center gap-3 py-2.5">
              <StepStatusIcon status={step.status} />
              <span className="flex-1 text-sm text-bone">{STEP_COPY[step.key].title}</span>
              <Link href={guildHref(slug, step.key === "publish" ? "/admin/setup#publish" : STEP_COPY[step.key].href)} className="link text-sm">
                {STEP_COPY[step.key].cta}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={guildHref(slug, "/admin/setup")} className="btn btn-primary btn-sm mt-4">
        Abrir la lista de configuración
      </Link>
    </section>
  );
}
