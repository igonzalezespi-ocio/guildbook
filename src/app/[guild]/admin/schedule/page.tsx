import type { Metadata } from "next";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/ui";
import { Listbox } from "@/components/listbox";
import { FACTION_OPTIONS } from "@/components/select-options";
import { db } from "@/db";
import type { raidScheduleSlots } from "@/db/schema";
import { DAYS_OF_WEEK } from "@/lib/game";
import { timezoneAbbrev } from "@/lib/format";
import { guildHref } from "@/lib/paths";
import { deleteScheduleSlotAction, saveScheduleSlotAction } from "@/server/actions/admin";
import { requirePage } from "@/server/context";
import { listScheduleSlots } from "@/server/services/content";

export const metadata: Metadata = { title: "Horario de bandas" };

function SlotFields({ slot, showFaction }: { slot?: typeof raidScheduleSlots.$inferSelect; showFaction: boolean }) {
  return (
    <div className={`grid gap-3 sm:items-end ${showFaction ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
      {slot && <input type="hidden" name="id" value={slot.id} />}
      <Field label="Día" name="dayOfWeek">
        <Listbox
          name="dayOfWeek"
          aria-label="Día"
          options={DAYS_OF_WEEK.map((d, i) => ({ value: String(i), label: d }))}
          defaultValue={String(slot?.dayOfWeek ?? 2)}
        />
      </Field>
      <Field label="Inicio" name="startTime">
        <input name="startTime" type="time" className="field" defaultValue={slot?.startTime ?? "20:00"} required />
      </Field>
      <Field label="Fin" name="endTime">
        <input name="endTime" type="time" className="field" defaultValue={slot?.endTime ?? "23:00"} required />
      </Field>
      <Field label="Etiqueta" name="label">
        <input name="label" className="field" defaultValue={slot?.label ?? "Banda principal"} required />
      </Field>
      {showFaction && (
        <Field label="Facción" name="faction">
          <Listbox name="faction" aria-label="Facción" options={[{ value: "", label: "Ambas" }, ...FACTION_OPTIONS]} defaultValue={slot?.faction ?? ""} />
        </Field>
      )}
    </div>
  );
}

export default async function SchedulePage({ params }: PageProps<"/[guild]/admin/schedule">) {
  const { guild: slug } = await params;
  const { guild } = await requirePage(slug, "schedule.edit", guildHref(slug, "/admin/schedule"));
  const slots = await listScheduleSlots(db, guild.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Horario de bandas" eyebrow={`Horas en hora del servidor (${timezoneAbbrev(guild.timezone)})`} />
      {slots.map((slot) => (
        <Panel key={slot.id}>
          <ActionForm action={saveScheduleSlotAction.bind(null, slug)} className="space-y-3">
            <SlotFields slot={slot} showFaction={!guild.faction} />
            <div className="flex items-center gap-3">
              <SubmitButton variant="ghost" size="sm">
                Guardar
              </SubmitButton>
              <FormMessage />
            </div>
          </ActionForm>
          <ActionForm action={deleteScheduleSlotAction.bind(null, slug, slot.id)} className="mt-2" confirm="¿Borrar esta noche de banda?">
            <SubmitButton variant="danger" size="sm">
              Borrar
            </SubmitButton>
          </ActionForm>
        </Panel>
      ))}
      <Panel title="Añadir noche de banda">
        <ActionForm action={saveScheduleSlotAction.bind(null, slug)} className="space-y-3">
          <SlotFields showFaction={!guild.faction} />
          <FormMessage />
          <SubmitButton>Añadir</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
