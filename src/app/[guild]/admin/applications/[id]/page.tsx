import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, FormMessage } from "@/components/action-form";
import { ClassName, FactionBadge, PageHeader, Panel, RoleBadge, StatusPill, VerificationBadge } from "@/components/ui";
import { db } from "@/db";
import { formatDateTime } from "@/lib/format";
import { APPLICATION_STATUS_LABELS, CLASS_INFO, fullName, specLabel } from "@/lib/game";
import { guildHref } from "@/lib/paths";
import { reviewApplicationAction } from "@/server/actions/admin";
import { requirePage } from "@/server/context";
import { getApplication } from "@/server/services/applications";
import { listRanks } from "@/server/services/ranks";

export const metadata: Metadata = { title: "Revisar solicitud" };

export default async function ApplicationDetailPage({ params }: PageProps<"/[guild]/admin/applications/[id]">) {
  const { guild: slug, id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { guild, actor } = await requirePage(slug, "application.review", guildHref(slug, `/admin/applications/${id}`));
  const row = await getApplication(db, actor, id);
  if (!row) notFound();
  const { application: a, applicant } = row;
  const applicantRank = (await listRanks(db, guild.id)).find((r) => r.id === guild.applicantRankId);

  const answers = [
    { label: "Experiencia en bandas", value: a.raidExperience },
    { label: "Disponibilidad", value: a.availability },
    { label: "¿Por qué esta hermandad?", value: a.whyThisGuild },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={fullName(a.characterName, a.characterSurname)} eyebrow={applicantRank?.name ?? "Aspirante"} />
      <Panel actions={<StatusPill status={a.status} />} title="Solicitud">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span>
            <ClassName wowClass={a.wowClass}>
              {CLASS_INFO[a.wowClass].label} {specLabel(a.spec)}
            </ClassName>{" "}
            <span className="text-muted">de nivel {a.level}</span>
          </span>
          {!guild.faction && <FactionBadge faction={a.faction} />}
          <RoleBadge role={a.role} />
          <VerificationBadge verified={a.verified} />
        </div>
        <dl className="space-y-4">
          <div>
            <dt className="field-label">Battle.net</dt>
            <dd>
              {a.verified ? (
                <>
                  Nombre, clase y nivel leídos de {a.battletag ?? "la cuenta de Battle.net del aspirante"}
                  {a.bnetSnapshotAt && <span className="text-muted"> ({formatDateTime(a.bnetSnapshotAt, guild.timezone)})</span>}
                  . El apellido, la especialización y el rol los indica el aspirante.
                </>
              ) : (
                <span className="text-muted">Introducido a mano; no se ha comprobado con Battle.net.</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="field-label">Discord</dt>
            <dd>
              {a.discordHandle} <span className="text-muted">(sesión iniciada como {applicant.discordUsername ?? applicant.name})</span>
            </dd>
          </div>
          {answers.map((q) => (
            <div key={q.label}>
              <dt className="field-label">{q.label}</dt>
              <dd className="whitespace-pre-wrap text-bone/90">{q.value}</dd>
            </div>
          ))}
          <div>
            <dt className="field-label">Enviada</dt>
            <dd>{formatDateTime(a.createdAt, guild.timezone)}</dd>
          </div>
          {a.reviewedAt && (
            <div>
              <dt className="field-label">Decisión</dt>
              <dd>
                {APPLICATION_STATUS_LABELS[a.status] ?? a.status} el {formatDateTime(a.reviewedAt, guild.timezone)}
                {a.decisionNote && <p className="mt-1 text-muted italic">{a.decisionNote}</p>}
              </dd>
            </div>
          )}
        </dl>
      </Panel>

      {a.status === "pending" && (
        <Panel title="Decisión">
          <ActionForm action={reviewApplicationAction.bind(null, slug)} className="space-y-4">
            <input type="hidden" name="applicationId" value={a.id} />
            <Field label="Nota (opcional, visible para los oficiales)" name="note">
              <textarea id="note" name="note" className="field" />
            </Field>
            <FormMessage />
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="decision" value="accepted" className="btn btn-primary">
                Aceptar como miembro
              </button>
              <button type="submit" name="decision" value="trial" className="btn btn-ghost">
                Ofrecer prueba
              </button>
              <button type="submit" name="decision" value="declined" className="btn btn-danger">
                Rechazar
              </button>
            </div>
          </ActionForm>
          <p className="mt-4 text-xs text-muted">
            Aceptar asigna el rango de miembro configurado en la hermandad; la prueba asigna el rango de prueba. En ambos casos el
            personaje de la solicitud se añade a la plantilla, verificado si la solicitud lo estaba.
          </p>
        </Panel>
      )}
    </div>
  );
}
