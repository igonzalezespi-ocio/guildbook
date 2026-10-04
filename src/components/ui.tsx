import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { FactionIcon } from "@/components/faction-icon";
import {
  ADDON_STATUS_LABELS,
  APPLICATION_STATUS_LABELS,
  CLASS_INFO,
  FACTION_LABELS,
  type Faction,
  fullName,
  ROLE_LABELS,
  type RaidRole,
  type WowClass,
} from "@/lib/game";
import { characterHref } from "@/lib/paths";

export function PageHeader({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  return (
    <header className="mb-6 text-center sm:mb-8">
      {eyebrow && <p className="mb-1 text-xs tracking-[0.3em] break-words text-gold-dim uppercase">{eyebrow}</p>}
      <h1 className="text-2xl font-bold break-words text-gold sm:text-4xl">{title}</h1>
      <hr className="rule-gold mx-auto mt-4 w-40" />
      {children && <div className="mt-4 text-muted">{children}</div>}
    </header>
  );
}

export function Panel({ title, children, className, actions }: { title?: string; children: ReactNode; className?: string; actions?: ReactNode }) {
  return (
    <section className={clsx("panel p-4 sm:p-6", className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold text-gold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A class colour, darkened by light guild themes (which set `--class-<name>`) to stay readable. */
export const classColor = (c: WowClass) => `var(--class-${c}, ${CLASS_INFO[c].color})`;

export function ClassName({ wowClass, children }: { wowClass: WowClass; children?: ReactNode }) {
  return (
    <span style={{ color: classColor(wowClass) }} className="font-semibold">
      {children ?? CLASS_INFO[wowClass].label}
    </span>
  );
}

/** A class-colored character name linking to their public character page. */
export function CharacterLink({
  guildSlug,
  character,
  className,
}: {
  guildSlug: string;
  character: { id: string; name: string; surname: string; wowClass: WowClass };
  className?: string;
}) {
  return (
    <Link
      href={characterHref(guildSlug, character.id)}
      style={{ color: classColor(character.wowClass) }}
      className={clsx("font-semibold decoration-1 underline-offset-3 hover:underline focus-visible:underline", className)}
    >
      {fullName(character.name, character.surname)}
    </Link>
  );
}

/** Small bordered label for secondary metadata (tier, level, profession). */
export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded border border-line px-1.5 py-0.5 text-[0.65rem] tracking-wider text-muted uppercase",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function RoleBadge({ role }: { role: RaidRole }) {
  return <Tag>{ROLE_LABELS[role]}</Tag>;
}

export function FactionBadge({ faction }: { faction: Faction }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded py-0.5 pr-1.5 pl-0.5 text-[0.65rem] font-semibold tracking-wider uppercase",
        faction === "alliance" ? "bg-[#1b2a4a] text-[#9fb8ec]" : "bg-[#4a1b1b] text-[#ec9f9f]",
      )}
    >
      <FactionIcon faction={faction} size={14} decorative className="border-0" />
      {FACTION_LABELS[faction]}
    </span>
  );
}

/** Small gold seal: name, class and level were verified through Battle.net. `decorative` when text beside it says so. */
export function VerifiedMark({
  size = 14,
  className,
  decorative = false,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "Verificado con Battle.net" })}
      className={clsx("inline-block shrink-0 align-[-0.125em] text-highlight", className)}
    >
      {!decorative && <title>Verificado con Battle.net</title>}
      <path
        fill="currentColor"
        d="M8 .8l1.7 1.3 2.1-.2.8 2 2 .9-.2 2.1L15.7 8l-1.3 1.7.2 2.1-2 .8-.8 2-2.1-.2L8 15.7l-1.7-1.3-2.1.2-.8-2-2-.8.2-2.1L.3 8l1.3-1.7-.2-2.1 2-.9.8-2 2.1.2z"
      />
      <path d="M5 8.2l2 2 4-4.1" fill="none" stroke="var(--color-ink)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A character Battle.net shows in the guild's in-game guild (`characters.in_guild_confirmed_at`). */
export function GuildMemberTag({ guildName, className }: { guildName: string; className?: string }) {
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded border border-gold-dim/70 px-1.5 py-0.5 text-[0.65rem] tracking-wider text-gold uppercase", className)}
      title={`Battle.net muestra a este personaje en ${guildName} dentro del juego`}
      data-testid="guild-member-tag"
    >
      <VerifiedMark size={10} decorative />
      Miembro verificado
    </span>
  );
}

/** Officer-facing verification state of an application or character. */
export function VerificationBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded border border-gold-dim px-2 py-0.5 text-xs text-gold">
      <VerifiedMark size={12} decorative />
      Verificado con Battle.net
    </span>
  ) : (
    <span className="inline-flex items-center rounded border border-line px-2 py-0.5 text-xs text-muted">Sin verificar</span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted italic">{children}</p>;
}

export function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    pending: "border-gold-dim text-gold",
    accepted: "border-emerald-700 text-emerald-300",
    trial: "border-sky-700 text-sky-300",
    declined: "border-crimson text-red-300",
    withdrawn: "border-line text-muted",
    released: "border-emerald-700 text-emerald-300",
    beta: "border-sky-700 text-sky-300",
    in_development: "border-gold-dim text-gold",
    planned: "border-line text-muted",
  };
  return (
    <span className={clsx("rounded border px-2 py-0.5 text-xs capitalize", tone[status] ?? "border-line text-muted")}>
      {APPLICATION_STATUS_LABELS[status] ?? ADDON_STATUS_LABELS[status] ?? status.replace("_", " ")}
    </span>
  );
}
