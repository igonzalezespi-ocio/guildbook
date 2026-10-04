import { z } from "zod";

/** What a support request is about, in the order the form lists them. */
export const SUPPORT_CATEGORIES = {
  account: { label: "Cuenta e inicio de sesión", description: "Inicio de sesión con Discord, tu perfil, exportar o borrar tus datos" },
  guild_setup: { label: "Configurar la hermandad", description: "Crear una hermandad, subdominios, dominios propios, rangos y páginas" },
  battlenet: { label: "Verificación de Battle.net", description: "Vincular Battle.net, verificar personajes o tu hermandad" },
  vigil: { label: "App de escritorio Vigil", description: "La app complementaria, el emparejamiento y la subida de combates" },
  billing: { label: "Facturación", description: "Los planes de pago aún no están activos; pregunta por ellos aquí" },
  bug: { label: "Informar de un error", description: "Algo no funciona o se ve mal" },
  other: { label: "Otro", description: "Cualquier otra cosa" },
} as const;

export type SupportCategory = keyof typeof SUPPORT_CATEGORIES;
export const SUPPORT_CATEGORY_KEYS = Object.keys(SUPPORT_CATEGORIES) as [SupportCategory, ...SupportCategory[]];

export const SUPPORT_SUBJECT_MAX = 120;
export const SUPPORT_MESSAGE_MIN = 20;
export const SUPPORT_MESSAGE_MAX = 5000;
/** Tickets one user may send in `SUPPORT_RATE_WINDOW_MS`. */
export const SUPPORT_RATE_LIMIT = 5;
export const SUPPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

/** Recorded with each ticket so a reply doesn't have to ask for it. */
export interface SupportTicketContext {
  discordId?: string | null;
  discordUsername?: string | null;
  displayName?: string | null;
  /** The page the user came from, as the browser reported it. */
  page?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
  host?: string | null;
}

const optionalId = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.uuid("Elige una de tus hermandades").nullable());

export const supportTicketInput = z.object({
  category: z.enum(SUPPORT_CATEGORY_KEYS, "Elige una categoría"),
  guildId: optionalId,
  subject: z
    .string()
    .trim()
    .min(1, "El asunto es obligatorio")
    .max(SUPPORT_SUBJECT_MAX, `El asunto debe tener como máximo ${SUPPORT_SUBJECT_MAX} caracteres`),
  message: z
    .string()
    .trim()
    .min(SUPPORT_MESSAGE_MIN, `Cuéntanos un poco más: al menos ${SUPPORT_MESSAGE_MIN} caracteres`)
    .max(SUPPORT_MESSAGE_MAX, `El mensaje debe tener como máximo ${SUPPORT_MESSAGE_MAX} caracteres`),
  replyTo: z
    .string()
    .trim()
    .max(254, "El correo es demasiado largo")
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.email("Escribe un correo como tu@ejemplo.com").nullable()),
});

export type SupportTicketInput = z.infer<typeof supportTicketInput>;

/** The short reference shown to the user and in the email subject, e.g. `GB-1A2B3C4D`. */
export function ticketReference(id: string): string {
  return `GB-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}
