import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BlizzardItemAttribution, ItemLink } from "@/components/item-link";
import { ClassName, PageHeader, Panel, Tag } from "@/components/ui";
import { Listbox } from "@/components/listbox";
import { db } from "@/db";
import { fullName } from "@/lib/game";
import { formatDateTime } from "@/lib/format";
import { LOOT_RESPONSE_LABELS, LOOT_SOURCE_LABELS } from "@/lib/loot/constants";
import { GARGUL_DEFAULT_TEMPLATE } from "@/lib/loot/parsers/gargul";
import { LOOT_PARSERS } from "@/lib/loot/parsers";
import { guildHref } from "@/lib/paths";
import { commitLootImportAction, discardLootImportAction, previewLootImportAction } from "@/server/actions/loot";
import { requirePage } from "@/server/context";
import { DomainError } from "@/server/errors";
import { getImportPreview, type MatchVia } from "@/server/services/loot";

export const metadata: Metadata = { title: "Importar botín" };

const VIA_LABELS: Record<MatchVia, string> = {
  alias: "Recordado de una importación anterior",
  name: "Coincide por nombre completo",
  first_name: "Coincide por nombre de pila; revísalo",
};

export default async function ImportLootPage({ params, searchParams }: PageProps<"/[guild]/admin/loot/import">) {
  const { guild: slug } = await params;
  const { batch: batchId } = await searchParams;
  const { guild, actor } = await requirePage(slug, "loot.import", guildHref(slug, "/admin/loot/import"));
  const crumbs = [{ label: "Botín", href: guildHref(slug, "/admin/loot") }, { label: "Importar" }];

  if (typeof batchId === "string") {
    if (!/^[0-9a-f-]{36}$/i.test(batchId)) notFound();
    let preview;
    try {
      preview = await getImportPreview(db, actor, batchId);
    } catch (err) {
      if (err instanceof DomainError) notFound();
      throw err;
    }
    const { batch, rows, names, characters, duplicateCount, gameVersion } = preview;
    const parser = LOOT_PARSERS.find((p) => p.id === batch.parserId);
    const fresh = rows.length - duplicateCount;
    const decisionOptions = [
      { value: "name", label: "Guardar solo el nombre" },
      { value: "skip", label: "Descartar estas entregas" },
      ...characters.map((c) => ({ value: `char:${c.id}`, label: fullName(c.name, c.surname), group: "Personajes de la hermandad" })),
    ];

    return (
      <div className="space-y-6">
        <Breadcrumbs items={[...crumbs.slice(0, 1), { label: "Importar", href: guildHref(slug, "/admin/loot/import") }, { label: "Revisar" }]} />
        <PageHeader title="Revisar importación" eyebrow={parser?.label ?? LOOT_SOURCE_LABELS[batch.source]}>
          {rows.length} {rows.length === 1 ? "entrega leída" : "entregas leídas"}
          {duplicateCount > 0 && `, ${duplicateCount} ya en el registro y omitidas`}. No se registra nada hasta que confirmes.
        </PageHeader>

        {batch.warnings.length > 0 && (
          <Panel title="Líneas que no se han podido leer">
            <ul className="space-y-1 text-sm text-muted">
              {batch.warnings.slice(0, 20).map((w, i) => (
                <li key={i}>
                  Línea {w.line}: {w.message}
                </li>
              ))}
              {batch.warnings.length > 20 && <li>Y {batch.warnings.length - 20} más.</li>}
            </ul>
          </Panel>
        )}

        <ActionForm action={commitLootImportAction.bind(null, slug, batch.id)} className="space-y-6">
          <Panel title="Destinatarios">
            {names.length === 0 ? (
              <p className="text-sm text-muted">No hay nombres de jugadores en esta exportación.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-muted">
                  Asocia cada nombre de la exportación a un personaje. Los jugadores de fuera o que no están en la plantilla pueden quedarse solo con su nombre.
                </p>
                <ul className="divide-y divide-line">
                  {names.map((n) => (
                    <li key={n.key} className="grid gap-2 py-2 sm:grid-cols-[1fr_minmax(0,18rem)] sm:items-center">
                      <div>
                        <p className="font-semibold text-bone">
                          {n.display} <span className="text-xs font-normal text-muted">({n.count})</span>
                        </p>
                        <p className="text-xs text-muted">{n.match ? VIA_LABELS[n.match.via] : "Sin coincidencias en la plantilla"}</p>
                      </div>
                      <Listbox
                        name={`decision:${n.key}`}
                        aria-label={`¿Quién es ${n.display}?`}
                        options={decisionOptions}
                        defaultValue={n.match ? `char:${n.match.character.id}` : "name"}
                        searchable={characters.length > 12}
                        searchPlaceholder="Buscar personajes"
                      />
                    </li>
                  ))}
                </ul>
                <label className="mt-4 flex items-center gap-3 text-sm">
                  <input type="checkbox" name="remember" defaultChecked className="h-5 w-5 accent-crimson" />
                  Recordar estas asociaciones para futuras importaciones
                </label>
              </>
            )}
          </Panel>

          <Panel title="Entregas">
            <div className="-mx-4 overflow-x-auto px-4">
              <table className="w-full text-left text-sm">
                <thead className="text-xs tracking-wider text-muted uppercase">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-4 font-normal">Cuándo</th>
                    <th className="py-2 pr-4 font-normal">Objeto</th>
                    <th className="py-2 pr-4 font-normal">Jugador</th>
                    <th className="py-2 pr-4 font-normal">Entregado por</th>
                    <th className="py-2 font-normal">Jefe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.index} className={r.duplicate ? "opacity-50" : undefined}>
                      <td className="py-2 pr-4 whitespace-nowrap text-muted">
                        {formatDateTime(new Date(r.row.awardedAt), guild.timezone)}
                        {r.row.timePrecision === "day" && <span className="block text-xs">Solo fecha</span>}
                      </td>
                      <td className="py-2 pr-4">
                        <ItemLink itemId={r.row.itemId} name={r.itemName} quality={r.quality} icon={r.icon} gameVersion={gameVersion} />
                        {r.duplicate && <Tag className="ml-2">Ya registrado</Tag>}
                      </td>
                      <td className="py-2 pr-4">
                        {r.row.recipient ? (
                          r.row.recipient.wowClass ? (
                            <ClassName wowClass={r.row.recipient.wowClass}>{r.row.recipient.name}</ClassName>
                          ) : (
                            <span className="text-bone">{r.row.recipient.name}</span>
                          )
                        ) : (
                          <span className="text-muted">Nadie</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted">
                        {LOOT_RESPONSE_LABELS[r.row.response]}
                        {r.row.responseText && <span className="block text-xs">{r.row.responseText}</span>}
                      </td>
                      <td className="py-2 text-muted">{[r.row.instance, r.row.boss].filter(Boolean).join(", ") || "Desconocido"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.some((r) => r.itemFromBlizzard || r.icon) && <BlizzardItemAttribution />}
          </Panel>

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Confirmando…">
              Confirmar {fresh} {fresh === 1 ? "entrega" : "entregas"}
            </SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>

        <ActionForm action={discardLootImportAction.bind(null, slug, batch.id)} confirm="¿Descartar esta importación?">
          <SubmitButton variant="ghost" size="sm" pendingLabel="Descartando…">
            Descartar importación
          </SubmitButton>
          <FormMessage />
        </ActionForm>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={crumbs} />
      <PageHeader title="Importar botín" eyebrow="Gargul y RCLootCouncil">
        Pega una exportación del addon. Revisarás los nombres y las entregas antes de registrar nada, y las entregas que ya están en
        el registro se omiten, así que importar la misma banda dos veces no es un problema.
      </PageHeader>

      <Panel title="Pega una exportación">
        <ActionForm action={previewLootImportAction.bind(null, slug)} className="space-y-4">
          <Field label="Exportación" name="raw" hint="Gargul: abre el historial de entregas y expórtalo (JSON, TMB o propio). RCLootCouncil: /rc history y exporta en CSV o JSON.">
            <textarea id="raw" name="raw" className="field min-h-64 font-mono text-xs" required spellCheck={false} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Formato" name="parserId">
              <Listbox
                id="parserId"
                name="parserId"
                options={[{ value: "", label: "Detectar automáticamente" }, ...LOOT_PARSERS.map((p) => ({ value: p.id, label: p.label }))]}
                defaultValue=""
              />
            </Field>
            <Field label="Formato propio de Gargul" name="template" hint={`Solo para la exportación propia de Gargul. Por defecto: ${GARGUL_DEFAULT_TEMPLATE}`}>
              <input id="template" name="template" className="field font-mono text-xs" placeholder={GARGUL_DEFAULT_TEMPLATE} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Leyendo…">Previsualizar importación</SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
