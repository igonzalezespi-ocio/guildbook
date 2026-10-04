import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { Listbox } from "@/components/listbox";
import { VISIBILITIES, VISIBILITY_LABELS, type Visibility } from "@/lib/vigil/visibility";
import { setVigilDefaultVisibilityAction, setVigilVisibilityAction } from "@/server/actions/vigil";

function VisibilitySelect({ value, label }: { value: Visibility; label: string }) {
  return (
    <Listbox
      name="visibility"
      defaultValue={value}
      aria-label={label}
      size="sm"
      className="min-w-44"
      options={VISIBILITIES.map((v) => ({ value: v, label: v === "private" ? "Privado (solo yo)" : VISIBILITY_LABELS[v] }))}
    />
  );
}

export function ReportVisibilityForm({ slug, id, value }: { slug: string; id: string; value: Visibility }) {
  return (
    <ActionForm action={setVigilVisibilityAction.bind(null, slug, id)} className="flex flex-wrap items-center gap-2">
      <VisibilitySelect value={value} label="Quién puede ver este informe" />
      <SubmitButton size="sm" variant="ghost">
        Guardar
      </SubmitButton>
      <FormMessage className="w-full" />
    </ActionForm>
  );
}

export function DefaultVisibilityForm({ slug, value }: { slug: string; value: Visibility }) {
  return (
    <ActionForm action={setVigilDefaultVisibilityAction.bind(null, slug)} className="flex flex-wrap items-center gap-3">
      <VisibilitySelect value={value} label="Compartir por defecto en los informes nuevos" />
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="applyToExisting" className="accent-[var(--color-gold)]" />
        Aplicar a todos mis informes
      </label>
      <SubmitButton size="sm" variant="ghost">
        Guardar
      </SubmitButton>
      <FormMessage className="w-full" />
    </ActionForm>
  );
}
