"use client";

import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import type { ActionResult } from "@/server/action-types";

/** Destructive action gated on typing a name; the server checks the name again. */
export function ConfirmDeleteForm({
  action,
  expected,
  buttonLabel,
  pendingLabel,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  expected: string;
  buttonLabel: string;
  pendingLabel: string;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === expected.trim().toLowerCase();
  return (
    <ActionForm action={action} className="space-y-3">
      <div>
        <label htmlFor="confirmName" className="field-label">
          Escribe <span className="font-semibold text-bone">{expected}</span> para confirmar
        </label>
        <input
          id="confirmName"
          name="confirmName"
          className="field"
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <fieldset disabled={!matches} className="disabled:opacity-50">
        <SubmitButton variant="danger" pendingLabel={pendingLabel}>
          {buttonLabel}
        </SubmitButton>
      </fieldset>
      <FormMessage />
    </ActionForm>
  );
}
