import type { Metadata } from "next";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { AddonIcon } from "@/components/addon-icon";
import { PageHeader, Panel } from "@/components/ui";
import { Listbox } from "@/components/listbox";
import { db } from "@/db";
import type { addons } from "@/db/schema";
import { ADDON_ICON_INFO, addonIconFor } from "@/lib/addon-icons";
import { guildHref } from "@/lib/paths";
import { deleteAddonAction, saveAddonAction } from "@/server/actions/admin";
import { requirePage } from "@/server/context";
import { listAddons } from "@/server/services/content";

export const metadata: Metadata = { title: "Addons" };

const STATUSES = [
  ["planned", "Previsto"],
  ["in_development", "En desarrollo"],
  ["beta", "Beta"],
  ["released", "Publicado"],
] as const;

function AddonFields({ addon }: { addon?: typeof addons.$inferSelect }) {
  const p = addon?.id ?? "new";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {addon && <input type="hidden" name="id" value={addon.id} />}
      <Field label="Nombre" name="name">
        <input id={`${p}-name`} name="name" className="field" defaultValue={addon?.name} required />
      </Field>
      <Field label="Identificador (slug)" name="slug">
        <input id={`${p}-slug`} name="slug" className="field" defaultValue={addon?.slug} required />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Resumen" name="summary">
          <input id={`${p}-summary`} name="summary" className="field" defaultValue={addon?.summary} required />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Descripción (Markdown)" name="descriptionMd">
          <textarea id={`${p}-desc`} name="descriptionMd" className="field" defaultValue={addon?.descriptionMd} />
        </Field>
      </div>
      <Field label="Estado" name="status">
        <Listbox
          id={`${p}-status`}
          name="status"
          aria-label="Estado"
          options={STATUSES.map(([value, label]) => ({ value, label }))}
          defaultValue={addon?.status ?? "planned"}
        />
      </Field>
      <Field label="Versión" name="version">
        <input id={`${p}-version`} name="version" className="field" defaultValue={addon?.version ?? ""} />
      </Field>
      <Field label="URL de descarga (https)" name="downloadUrl">
        <input id={`${p}-dl`} name="downloadUrl" type="url" className="field" defaultValue={addon?.downloadUrl ?? ""} />
      </Field>
      <Field label="URL del código fuente (https)" name="sourceUrl">
        <input id={`${p}-src`} name="sourceUrl" type="url" className="field" defaultValue={addon?.sourceUrl ?? ""} />
      </Field>
    </div>
  );
}

export default async function AdminAddonsPage({ params }: PageProps<"/[guild]/admin/addons">) {
  const { guild: slug } = await params;
  const { guild } = await requirePage(slug, "addons.edit", guildHref(slug, "/admin/addons"));
  const list = await listAddons(db, guild.id);

  return (
    <div className="space-y-6">
      <PageHeader title="Addons" />
      {list.map((a) => (
        <Panel key={a.id}>
          <div className="mb-4 flex items-center gap-3">
            <AddonIcon addon={a} size={32} className="shrink-0" />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gold">{a.name}</h2>
              <p className="text-xs text-muted">Icono: {ADDON_ICON_INFO[addonIconFor(a)].label}, elegido a partir del identificador o el nombre</p>
            </div>
          </div>
          <ActionForm action={saveAddonAction.bind(null, slug)} className="space-y-3">
            <AddonFields addon={a} />
            <div className="flex items-center gap-3">
              <SubmitButton variant="ghost" size="sm">
                Guardar
              </SubmitButton>
              <FormMessage />
            </div>
          </ActionForm>
          <ActionForm action={deleteAddonAction.bind(null, slug, a.id)} className="mt-2" confirm={`¿Borrar ${a.name}?`}>
            <SubmitButton variant="danger" size="sm">
              Borrar
            </SubmitButton>
          </ActionForm>
        </Panel>
      ))}
      <Panel title="Añadir addon">
        <ActionForm action={saveAddonAction.bind(null, slug)} className="space-y-3">
          <AddonFields />
          <FormMessage />
          <SubmitButton>Añadir addon</SubmitButton>
        </ActionForm>
      </Panel>
    </div>
  );
}
