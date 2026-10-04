import type { Metadata } from "next";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { FactionBadge, PageHeader, Panel } from "@/components/ui";
import { Listbox } from "@/components/listbox";
import { FACTION_OPTIONS, plainOptions } from "@/components/select-options";
import { db } from "@/db";
import { formatDate } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import {
  createBossAction,
  createInstanceAction,
  deleteBossKillAction,
  recordBossKillAction,
} from "@/server/actions/admin";
import { requirePage } from "@/server/context";
import { getProgression } from "@/server/services/content";

export const metadata: Metadata = { title: "Progreso" };

export default async function AdminProgressionPage({ params }: PageProps<"/[guild]/admin/progression">) {
  const { guild: slug } = await params;
  const { guild } = await requirePage(slug, "progression.edit", guildHref(slug, "/admin/progression"));
  const progression = await getProgression(db, guild.id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: guild.timezone }).format(new Date());

  return (
    <div className="space-y-6">
      <PageHeader title="Progreso" />

      <Panel title="Registrar una muerte de jefe">
        <ActionForm
          action={recordBossKillAction.bind(null, slug)}
          className={`grid gap-3 sm:items-end ${guild.faction ? "sm:grid-cols-3" : "sm:grid-cols-4"}`}
        >
          <Field label="Jefe" name="bossId">
            <Listbox
              id="bossId"
              name="bossId"
              options={progression.flatMap((i) => i.bosses.map((b) => ({ value: b.id, label: b.name, group: i.name })))}
              placeholder="Elige un jefe"
              requiredMessage="Elige un jefe"
              required
              searchable={progression.reduce((n, i) => n + i.bosses.length, 0) > 12}
              searchPlaceholder="Buscar jefes"
            />
          </Field>
          {!guild.faction && (
            <Field label="Facción" name="faction">
              <Listbox id="faction" name="faction" options={FACTION_OPTIONS} />
            </Field>
          )}
          <Field label="Fecha" name="killedOn">
            <input id="killedOn" name="killedOn" type="date" className="field" defaultValue={today} required />
          </Field>
          <SubmitButton>Registrar muerte</SubmitButton>
          <input type="hidden" name="note" value="" />
          <div className="sm:col-span-full">
            <FormMessage />
          </div>
        </ActionForm>
      </Panel>

      {progression.map((instance) => (
        <Panel key={instance.id} title={`${instance.name} (${instance.size})`}>
          <ul className="divide-y divide-line text-sm">
            {instance.bosses.map((boss) => (
              <li key={boss.id} className="py-2">
                <p className="font-semibold">{boss.name}</p>
                <ul className="mt-1 flex flex-wrap gap-2">
                  {boss.kills.map((k) => (
                    <li key={k.id} className="flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-xs">
                      {!guild.faction && <FactionBadge faction={k.faction} />}
                      {formatDate(k.killedAt, guild.timezone)}
                      <ActionForm action={deleteBossKillAction.bind(null, slug, k.id)} confirm="¿Borrar este registro de muerte?">
                        <button type="submit" className="ml-1 text-red-300" aria-label="Borrar muerte">
                          ×
                        </button>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <ActionForm action={createBossAction.bind(null, slug)} className="mt-3 flex gap-2">
            <input type="hidden" name="instanceId" value={instance.id} />
            <input name="name" className="field" placeholder="Nombre del nuevo jefe" aria-label="Nombre del nuevo jefe" required />
            <SubmitButton variant="ghost" size="sm">
              Añadir jefe
            </SubmitButton>
            <FormMessage />
          </ActionForm>
        </Panel>
      ))}

      <Panel title="Añadir instancia de banda">
        <ActionForm action={createInstanceAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-4 sm:items-end">
          <Field label="Nombre" name="name">
            <input id="inst-name" name="name" className="field" required />
          </Field>
          <Field label="Nombre corto" name="shortName">
            <input id="inst-short" name="shortName" className="field" required />
          </Field>
          <Field label="Tamaño" name="size">
            <Listbox id="inst-size" name="size" aria-label="Tamaño" options={plainOptions(["10", "20", "25", "40"])} defaultValue="40" />
          </Field>
          <SubmitButton>Añadir instancia</SubmitButton>
          <div className="sm:col-span-4">
            <FormMessage />
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
