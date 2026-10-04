"use client";

import { useEffect, useState } from "react";
import { ActionForm, Field, FieldError, FormMessage, SubmitButton } from "@/components/action-form";
import { Listbox, type ListboxOption } from "@/components/listbox";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_KEYS,
  SUPPORT_MESSAGE_MAX,
  SUPPORT_MESSAGE_MIN,
  SUPPORT_SUBJECT_MAX,
  type SupportCategory,
} from "@/lib/support";
import { submitSupportTicketAction } from "@/server/actions/support";

/** Summary labels for every field `supportTicketInput` validates. */
export const SUPPORT_LABELS = {
  category: "Categoría",
  guildId: "Hermandad relacionada",
  subject: "Asunto",
  message: "Mensaje",
  replyTo: "Correo de respuesta",
} as const;

const CATEGORY_OPTIONS: ListboxOption[] = SUPPORT_CATEGORY_KEYS.map((key) => ({
  value: key,
  label: SUPPORT_CATEGORIES[key].label,
  description: SUPPORT_CATEGORIES[key].description,
}));

export function SupportForm({
  guilds,
  defaultCategory,
  defaultEmail,
  context,
}: {
  guilds: { id: string; name: string; detail: string }[];
  defaultCategory?: SupportCategory;
  defaultEmail: string;
  context: { userId: string; discordName: string; appVersion: string };
}) {
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("");
  const [userAgent, setUserAgent] = useState("");

  useEffect(() => {
    // The referring page and browser are only known in the browser, after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(document.referrer);
    setUserAgent(navigator.userAgent);
  }, []);

  const guildOptions: ListboxOption[] = [
    { value: "", label: "Ninguna en concreto" },
    ...guilds.map((g) => ({ value: g.id, label: g.name, description: g.detail })),
  ];
  const length = message.trim().length;

  return (
    <ActionForm action={submitSupportTicketAction} className="space-y-5" labels={SUPPORT_LABELS}>
      <input type="hidden" name="page" value={page} />

      <Field label="Categoría" name="category">
        <Listbox
          id="category"
          name="category"
          options={CATEGORY_OPTIONS}
          defaultValue={defaultCategory}
          placeholder="Elige una categoría"
          required
          requiredMessage="Elige una categoría"
          data-testid="support-category"
        />
      </Field>

      {guilds.length > 0 && (
        <Field label="Hermandad relacionada" name="guildId" hint="Opcional. Elige la hermandad de la que trata, si hay alguna.">
          <Listbox id="guildId" name="guildId" options={guildOptions} defaultValue="" data-testid="support-guild" />
        </Field>
      )}

      <Field label="Asunto" name="subject">
        <input id="subject" name="subject" className="field" required maxLength={SUPPORT_SUBJECT_MAX} placeholder="Resumen breve" />
      </Field>

      <div>
        <label htmlFor="message" className="field-label">
          Mensaje
        </label>
        <textarea
          id="message"
          name="message"
          className="field min-h-40"
          required
          maxLength={SUPPORT_MESSAGE_MAX}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-describedby="message-hint"
          placeholder="Qué ha pasado, qué esperabas y, si puedes, los pasos para reproducirlo"
        />
        <p id="message-hint" className="mt-1 flex justify-between gap-2 text-xs text-muted">
          <span>Al menos {SUPPORT_MESSAGE_MIN} caracteres.</span>
          <span className={length > 0 && length < SUPPORT_MESSAGE_MIN ? "text-red-300" : undefined} data-testid="support-message-count">
            {length}/{SUPPORT_MESSAGE_MAX}
          </span>
        </p>
        <FieldError name="message" />
      </div>

      <Field
        label="Correo de respuesta"
        name="replyTo"
        hint="Opcional. Discord no siempre nos comparte tu correo; si lo dejas en blanco, te responderemos por Discord."
      >
        <input id="replyTo" name="replyTo" type="email" className="field" defaultValue={defaultEmail} maxLength={254} autoComplete="email" />
      </Field>

      <details className="rounded border border-line px-3 py-2 text-xs text-muted">
        <summary className="cursor-pointer text-bone/80">Se envía con tu solicitud</summary>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 break-all">
          <dt className="text-gold-dim">ID de usuario</dt>
          <dd className="font-mono">{context.userId}</dd>
          <dt className="text-gold-dim">Discord</dt>
          <dd>{context.discordName}</dd>
          <dt className="text-gold-dim">Página</dt>
          <dd>{page || "Esta página"}</dd>
          <dt className="text-gold-dim">Navegador</dt>
          <dd>{userAgent || "Tu navegador"}</dd>
          <dt className="text-gold-dim">Versión de la app</dt>
          <dd className="font-mono">{context.appVersion}</dd>
        </dl>
      </details>

      <FormMessage />
      <SubmitButton variant="gold" pendingLabel="Enviando…">
        Enviar solicitud
      </SubmitButton>
    </ActionForm>
  );
}
