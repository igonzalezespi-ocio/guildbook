import { z } from "zod";
import { AuthorizationError } from "@/lib/authz/policy";
import type { ActionResult } from "@/server/action-types";
import { DomainError } from "@/server/errors";

/** Expected failures (validation, permissions, domain rules) as a form result; anything else is rethrown. */
export function actionError(err: unknown): ActionResult {
  if (err instanceof z.ZodError) {
    const flat = z.flattenError(err);
    return {
      ok: false,
      error: flat.formErrors[0] ?? "Corrige estos campos:",
      fieldErrors: flat.fieldErrors as Record<string, string[] | undefined>,
    };
  }
  if (err instanceof DomainError && err.field) {
    return {
      ok: false,
      error: "Corrige estos campos:",
      fieldErrors: { [err.field]: [err.message] },
      ...(err.suggestions?.length ? { suggestions: { [err.field]: err.suggestions } } : {}),
    };
  }
  if (err instanceof AuthorizationError || err instanceof DomainError) {
    return { ok: false, error: err.message };
  }
  throw err;
}
