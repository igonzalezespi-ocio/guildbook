import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { LootTable } from "@/components/loot-table";
import { PageHeader, Panel } from "@/components/ui";
import { Listbox } from "@/components/listbox";
import { db } from "@/db";
import { can } from "@/lib/authz/policy";
import { fullName } from "@/lib/game";
import { LOOT_RESPONSE_LABELS, LOOT_RESPONSES } from "@/lib/loot/constants";
import { dateInZone } from "@/lib/loot/time";
import { guildHref } from "@/lib/paths";
import { awardLootAction, reverseLootAction } from "@/server/actions/loot";
import { requirePage } from "@/server/context";
import { awardFormOptions, listLoot } from "@/server/services/loot";

export const metadata: Metadata = { title: "Botín" };

export default async function AdminLootPage({ params }: PageProps<"/[guild]/admin/loot">) {
  const { guild: slug } = await params;
  const { guild, actor } = await requirePage(slug, "loot.award", guildHref(slug, "/admin/loot"));
  const [options, recent] = await Promise.all([awardFormOptions(db, actor), listLoot(db, actor, { limit: 50 })]);
  const today = dateInZone(new Date(), guild.timezone);
  const canReverse = can(actor, "loot.reverse");

  return (
    <div className="space-y-6">
      <PageHeader title="Botín" eyebrow="Registra lo que repartió la banda">
        Entrega objetos de uno en uno aquí, o{" "}
        <Link href={guildHref(slug, "/admin/loot/import")} className="text-gold hover:underline">
          importa una exportación de Gargul o RCLootCouncil
        </Link>
        . Las entregas no se pueden editar; anula el error y vuelve a registrarla.
      </PageHeader>

      <Panel title="Entrega rápida">
        <ActionForm action={awardLootAction.bind(null, slug)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Objeto" name="item" hint="ID de objeto, enlace del juego, enlace de Wowhead o el nombre de un objeto conocido">
            <input id="item" name="item" className="field" list="loot-items" required autoComplete="off" />
          </Field>
          <datalist id="loot-items">
            {options.items.map((i) => (
              <option key={i.itemId} value={`${i.name} (#${i.itemId})`} />
            ))}
          </datalist>
          <Field label="Destinatario" name="characterId" hint="Déjalo vacío si se desencantó o fue al banco">
            <Listbox
              id="characterId"
              name="characterId"
              options={[{ value: "", label: "Nadie" }, ...options.characters.map((c) => ({ value: c.id, label: fullName(c.name, c.surname) }))]}
              defaultValue=""
              searchable={options.characters.length > 12}
              searchPlaceholder="Buscar personajes"
            />
          </Field>
          <Field label="Entregado por" name="response">
            <Listbox
              id="response"
              name="response"
              options={LOOT_RESPONSES.map((r) => ({ value: r, label: LOOT_RESPONSE_LABELS[r] }))}
              defaultValue="main_spec"
            />
          </Field>
          <Field label="Jefe" name="bossId">
            <Listbox
              id="bossId"
              name="bossId"
              options={[
                { value: "", label: "Sin registrar" },
                ...options.bosses.map((b) => ({ value: b.id, label: b.name, group: b.instanceName })),
              ]}
              defaultValue=""
              searchable={options.bosses.length > 12}
              searchPlaceholder="Buscar jefes"
            />
          </Field>
          <Field label="Noche de banda" name="awardedOn">
            <input id="awardedOn" name="awardedOn" type="date" className="field" defaultValue={today} max={today} required />
          </Field>
          <Field label="Nota" name="note">
            <input id="note" name="note" className="field" maxLength={300} />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-full">
            <SubmitButton pendingLabel="Registrando…">Registrar entrega</SubmitButton>
            <FormMessage />
          </div>
        </ActionForm>
      </Panel>

      <Panel title="Botín reciente">
        <LootTable
          slug={slug}
          rows={recent}
          actions={
            canReverse
              ? (row) =>
                  row.reversal ? null : (
                    <ActionForm
                      action={reverseLootAction.bind(null, slug, row.id)}
                      confirm={`¿Anular ${row.itemName}? La entrega se queda en el historial, tachada.`}
                      className="flex min-w-56 items-start gap-2"
                    >
                      <label className="sr-only" htmlFor={`reason-${row.id}`}>
                        Motivo para anular {row.itemName}
                      </label>
                      <input id={`reason-${row.id}`} name="reason" className="field py-1 text-xs" placeholder="Motivo" required maxLength={300} />
                      <SubmitButton size="sm" variant="ghost" pendingLabel="Anulando…">
                        Anular
                      </SubmitButton>
                      <FormMessage />
                    </ActionForm>
                  )
              : undefined
          }
        />
      </Panel>
    </div>
  );
}
