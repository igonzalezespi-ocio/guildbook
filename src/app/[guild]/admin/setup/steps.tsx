import clsx from "clsx";
import type { SetupStatus, SetupStepKey } from "@/lib/guild-setup";
import { LORE_SLUG } from "@/lib/lore";

export interface StepCopy {
  title: string;
  body: string;
  /** Admin path of the editor for this step. */
  href: string;
  cta: string;
}

export const STEP_COPY: Record<SetupStepKey, StepCopy> = {
  look: {
    title: "Tabardo y colores",
    body: "Diseña tu tabardo del juego, o impórtalo del juego cuando salga WoW: Forever. Será tu escudo, tus iconos y tus vistas previas de enlaces, y marca los colores de tu sitio.",
    href: "/admin/guild#tabard",
    cta: "Diseñar tabardo",
  },
  ranks: {
    title: "Rangos",
    body: "Pon nombre a tus rangos y elige qué puede hacer cada uno. Empieza con una plantilla de abajo o monta tu propia escala.",
    href: "/admin/ranks",
    cta: "Editar rangos",
  },
  charter: {
    title: "Reglamento",
    body: "Sustituye el reglamento de ejemplo por las normas de tu hermandad, para que los aspirantes sepan qué esperas.",
    href: "/admin/content/charter",
    cta: "Editar reglamento",
  },
  lore: {
    title: "Vuestra historia",
    body: "Cuenta a los visitantes quiénes sois: cómo empezó la hermandad, qué valoráis y cómo es una noche con vosotros.",
    href: `/admin/content/${LORE_SLUG}`,
    cta: "Escribir vuestra historia",
  },
  recruiting: {
    title: "Reclutamiento",
    body: "Indica las clases y roles que buscas, o cierra el reclutamiento si estáis completos.",
    href: "/admin/recruitment",
    cta: "Configurar reclutamiento",
  },
  invite: {
    title: "Invitar miembros",
    body: "Comparte tu sitio con tu hermandad y añade tu invitación de Discord. Los miembros inician sesión con Discord y envían su solicitud desde el sitio.",
    href: "/admin/guild",
    cta: "Añadir invitación de Discord",
  },
  verify: {
    title: "Verificar con Battle.net",
    body: "Las hermandades verificadas tienen un sello y salen primero en el directorio. El maestro de la hermandad del juego vincula Battle.net y Guildbook comprueba su personaje.",
    href: "/admin/guild#verify",
    cta: "Abrir verificación",
  },
  vigil: {
    title: "App de Vigil",
    body: "Vigil analiza cada pull de tu registro de combate: rotación, tiempo activo de auras y reutilizaciones. La app de escritorio sube los registros mientras juegas.",
    href: "/vigil",
    cta: "Configurar Vigil",
  },
  publish: {
    title: "Publicar",
    body: "Los borradores no aparecen en listados: cualquiera con el enlace puede entrar, pero la hermandad queda fuera del directorio y de los buscadores, y las solicitudes siguen cerradas.",
    href: "/admin/setup#publish",
    cta: "Publicar",
  },
};

const STATUS_LABEL: Record<SetupStatus, string> = { done: "Hecho", skipped: "Omitido", todo: "Pendiente" };

/** A step's status as a small seal: a gold check when done, a dash when skipped, an open ring when still to do. */
export function StepStatusIcon({ status, className }: { status: SetupStatus; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={24}
      height={24}
      role="img"
      aria-label={STATUS_LABEL[status]}
      className={clsx("shrink-0", status === "done" ? "text-gold" : "text-muted", className)}
    >
      <circle cx="12" cy="12" r="10" fill={status === "done" ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5} />
      {status === "done" && (
        <path d="M7.5 12.3l3 3 6-6.3" fill="none" stroke="var(--color-ink)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {status === "skipped" && <path d="M8 12h8" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />}
    </svg>
  );
}

export function SetupProgress({ done, total }: { done: number; total: number }) {
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-label="Progreso de la configuración"
    >
      <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${Math.round((done / total) * 100)}%` }} />
    </div>
  );
}
