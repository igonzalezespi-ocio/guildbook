"use client";

import clsx from "clsx";
import { createContext, type ReactNode, startTransition, useActionState, useContext, useEffect, useId, useRef } from "react";
import { useFormStatus } from "react-dom";
import { consumeFlash } from "@/components/toaster";
import { toast } from "@/lib/toast";
import type { ActionResult } from "@/server/action-types";

type FormAction = (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;

interface FormContext {
  state: ActionResult | null;
  pending: boolean;
  formId: string;
  labels: Readonly<Record<string, string>>;
}

const ResultContext = createContext<FormContext>({ state: null, pending: false, formId: "", labels: {} });

const errorSlotId = (formId: string, name: string) => `${formId}-${name}-error`;
const summaryId = (formId: string) => `${formId}-summary`;

/** `discordInviteUrl` to "Discord invite url", for fields a form didn't label. */
/** Spanish names for form fields, used when a form has no label for a failing field. */
const FIELD_NAMES: Record<string, string> = {
  acceptRankId: "Rango de aceptados",
  applicantRankId: "Rango de aspirantes",
  autoApproveRankId: "Rango al entrar",
  availability: "Disponibilidad",
  awardedOn: "Fecha de entrega",
  bodyMd: "Contenido",
  bossId: "Jefe",
  category: "Categoría",
  characterId: "Personaje",
  characterName: "Nombre",
  characterSurname: "Apellido",
  code: "Código",
  dayOfWeek: "Día",
  description: "Descripción",
  discordHandle: "Usuario de Discord",
  discordInviteUrl: "Invitación de Discord",
  domain: "Dominio",
  endTime: "Hora de fin",
  faction: "Facción",
  guildId: "Hermandad",
  item: "Objeto",
  killedOn: "Fecha de la muerte",
  label: "Etiqueta",
  level: "Nivel",
  message: "Mensaje",
  motto: "Lema",
  name: "Nombre",
  note: "Nota",
  professions: "Profesiones",
  raidExperience: "Experiencia en bandas",
  realmSlug: "Reino",
  reason: "Motivo",
  region: "Región",
  replyTo: "Correo de respuesta",
  respectsFaith: "Compromiso",
  response: "Motivo",
  role: "Rol",
  ruleset: "Tipo de reino",
  slug: "Subdominio",
  spec: "Especialización",
  startTime: "Hora de inicio",
  subject: "Asunto",
  summary: "Resumen",
  surname: "Apellido",
  timezone: "Zona horaria",
  title: "Título",
  trialRankId: "Rango de prueba",
  whyThisGuild: "¿Por qué esta hermandad?",
  wowClass: "Clase",
};

export function humanizeField(name: string): string {
  if (FIELD_NAMES[name]) return FIELD_NAMES[name];
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Field errors in form order: fields with inputs in DOM order first, then any the form has no input for. */
function failingFields(state: ActionResult | null): [string, string][] {
  if (!state || state.ok || !state.fieldErrors) return [];
  return Object.entries(state.fieldErrors).flatMap(([name, errors]) => (errors?.length ? [[name, errors[0]!] as [string, string]] : []));
}

/** Native controls, plus custom ones (`Listbox`) whose trigger names its field with `data-field-name`. */
const CONTROLS = "input, select, textarea, [data-field-name]";

function fieldControls(form: HTMLFormElement, name: string): HTMLElement[] {
  return [...form.querySelectorAll<HTMLElement>(CONTROLS)].filter(
    (el) =>
      (el.dataset.fieldName ?? el.getAttribute("name")) === name &&
      el.getAttribute("type") !== "hidden" &&
      !el.hasAttribute("data-listbox-value"),
  );
}

/**
 * A success `message` also shows as a toast, as does an error with no field to point at. The success toast is raised
 * as soon as the action resolves, before `refresh()` re-renders the page, because that re-render often unmounts the
 * form. Actions that `redirect()` never resolve here and use `setFlash` instead, which the `Toaster` picks up.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  toast: announce = true,
  labels = {},
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  confirm?: string;
  toast?: boolean;
  /** Field names to the labels the error summary uses; unlisted fields get a humanized name. */
  labels?: Readonly<Record<string, string>>;
}) {
  const run: FormAction = async (prev, formData) => {
    const result = await action(prev, formData);
    if (announce && result.ok && result.message) toast.success(result.message);
    consumeFlash();
    return result;
  };
  const [state, formAction, pending] = useActionState(run, null);
  const formRef = useRef<HTMLFormElement>(null);
  const formId = useId().replace(/:/g, "");

  // Submissions are dispatched by hand so a rejected one keeps what the user entered (React resets a form after any
  // `action` it runs); a successful one resets like React's own, restoring the re-rendered defaults.
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    for (const el of form.querySelectorAll<HTMLElement>("[data-aria-invalid-managed]")) {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("data-aria-invalid-managed");
      const describedBy = el.dataset.ariaDescribedbyOriginal;
      if (describedBy) el.setAttribute("aria-describedby", describedBy);
      else el.removeAttribute("aria-describedby");
      delete el.dataset.ariaDescribedbyOriginal;
    }
    const failing = failingFields(state);
    if (failing.length === 0) return;
    let first: { el: HTMLElement; index: number } | null = null;
    const all = [...form.querySelectorAll<HTMLElement>(CONTROLS)];
    for (const [name] of failing) {
      const slot = document.getElementById(errorSlotId(formId, name));
      const describer = slot ? slot.id : summaryId(formId);
      for (const el of fieldControls(form, name)) {
        const original = el.getAttribute("aria-describedby");
        if (original) el.dataset.ariaDescribedbyOriginal = original;
        el.setAttribute("aria-describedby", [original, describer].filter(Boolean).join(" "));
        el.setAttribute("aria-invalid", "true");
        el.setAttribute("data-aria-invalid-managed", "");
        const index = all.indexOf(el);
        if (!first || index < first.index) first = { el, index };
      }
    }
    const target = first?.el ?? document.getElementById(summaryId(formId));
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.focus({ preventScroll: true });
  }, [state, formId]);

  useEffect(() => {
    if (!announce || !state || state.ok) return;
    const failing = failingFields(state);
    if (failing.length === 0) {
      toast.error(state.error);
      return;
    }
    if (formRef.current?.querySelector("[data-form-message]")) return;
    toast.error(failing.map(([name, message]) => `${labels[name] ?? humanizeField(name)}: ${message}`).join(". "));
  }, [state, announce, labels]);

  return (
    <ResultContext.Provider value={{ state, pending, formId, labels }}>
      <form
        ref={formRef}
        action={formAction}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          if (confirm && !window.confirm(confirm)) return;
          const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
          startTransition(() => formAction(data));
        }}
      >
        {children}
      </form>
    </ResultContext.Provider>
  );
}

export function useActionResult() {
  return useContext(ResultContext).state;
}

/**
 * The form's outcome. A validation failure lists every failing field with its label and message, including fields
 * the form has no input for, so a server-side rule never leaves the user with nothing to fix.
 */
export function FormMessage({ className }: { className?: string }) {
  const { state, formId, labels } = useContext(ResultContext);
  const failing = failingFields(state);
  if (!state || (state.ok && !state.message)) return <span hidden data-form-message />;
  if (state.ok) {
    return (
      <p role="status" className={clsx("text-sm text-emerald-300", className)} data-form-message>
        {state.message}
      </p>
    );
  }
  return (
    <div
      id={summaryId(formId)}
      role="alert"
      tabIndex={-1}
      className={clsx("text-sm text-red-300 outline-none", className)}
      data-form-message
      data-testid="form-error-summary"
    >
      <p>{state.error}</p>
      {failing.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {failing.map(([name, message]) => (
            <li key={name} data-summary-field={name}>
              <strong className="font-semibold">{labels[name] ?? humanizeField(name)}:</strong> {message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The inline error slot for a field; always rendered (empty when valid) so inputs can point at it. */
export function FieldError({ name, stale = false }: { name: string; /** The value changed since the error; show nothing. */ stale?: boolean }) {
  const { state, formId } = useContext(ResultContext);
  const errors = state && !state.ok && !stale ? state.fieldErrors?.[name] : undefined;
  return (
    <p
      id={errorSlotId(formId, name)}
      className="mt-1 text-xs text-red-300 empty:hidden"
      data-error-slot={name}
      data-field-error={errors?.length ? name : undefined}
    >
      {errors?.[0]}
    </p>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size,
  pendingLabel,
}: {
  children: ReactNode;
  variant?: "primary" | "ghost" | "danger" | "gold";
  size?: "sm";
  pendingLabel?: string;
}) {
  const status = useFormStatus();
  const form = useContext(ResultContext);
  const pending = status.pending || form.pending;
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx("btn", `btn-${variant}`, size === "sm" && "btn-sm")}
    >
      {pending ? (pendingLabel ?? "Guardando…") : children}
    </button>
  );
}

export function Field({
  label,
  name,
  htmlFor,
  children,
  hint,
}: {
  label: string;
  name: string;
  /** The control's id when it isn't `name`, e.g. when two forms on one page have the same fields. */
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={htmlFor ?? name} className="field-label">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <FieldError name={name} />
    </div>
  );
}
