import Link from "next/link";
import { type ReactNode, useId } from "react";
import { RankInsignia } from "@/components/rank-insignia";
import { VerifiedMark } from "@/components/ui";
import { CLASS_INFO, fullName, specLabel } from "@/lib/game";
import { insigniaFor } from "@/lib/insignia";
import { characterHref, guildHref } from "@/lib/paths";
import { battlenetEnabled, blizzardConfigFromEnv } from "@/server/blizzard";
import type { Viewer } from "@/server/context";
import { signOutAction } from "@/server/actions/member";

/** Main character's full name, falling back to the Discord display name. */
export function accountName(viewer: Viewer): string {
  return viewer.main ? fullName(viewer.main.name, viewer.main.surname) : (viewer.user?.name ?? "Sesión iniciada");
}

/** Profile card for the signed-in viewer: insignia, main character, level line and rank. */
export function AccountCard({ viewer, guildSlug }: { viewer: Viewer; guildSlug: string }) {
  const { main, rank } = viewer;
  const h = (p: string) => guildHref(guildSlug, p);

  const name = <p className="truncate font-display text-base tracking-wide text-bone">{accountName(viewer)}</p>;

  let identity;
  let action: ReactNode = null;
  if (main) {
    identity = (
      <Link href={characterHref(guildSlug, main.id)} className="group block space-y-0.5">
        <p className="flex items-center gap-1.5 font-display text-base tracking-wide text-bone group-hover:text-gold">
          <span className="truncate">{accountName(viewer)}</span>
          {main.verified && <VerifiedMark size={12} />}
        </p>
        <p className="text-xs text-muted">
          <span style={{ color: CLASS_INFO[main.wowClass].color }}>
            {CLASS_INFO[main.wowClass].label} {specLabel(main.spec)}
          </span>{" "}
          de nivel {main.level}
        </p>
      </Link>
    );
  } else if (viewer.membershipStatus === "active") {
    identity = name;
    action = <AddMainCharacterLink href={h("/members/characters")} />;
  } else if (viewer.membershipStatus === "applicant") {
    identity = (
      <>
        {name}
        <Link href={h("/apply")} className="text-xs text-gold underline-offset-2 hover:underline">
          Solicitud pendiente
        </Link>
      </>
    );
  } else {
    identity = (
      <>
        {name}
        <p className="text-xs text-muted">Sesión iniciada con Discord</p>
      </>
    );
  }

  return (
    <div data-testid="account-card" className="space-y-3 px-1 py-1">
      <div className="flex items-center gap-3">
        {rank && <RankInsignia insignia={insigniaFor(rank)} tier={rank.tier} size={44} className="shrink-0" />}
        <div className="min-w-0 space-y-0.5 leading-tight">
          {identity}
          {rank && <p className="text-xs tracking-wider text-gold uppercase">{rank.name}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Call to action for an active member without a main character; the characters page offers Battle.net import and manual registration. */
function AddMainCharacterLink({ href }: { href: string }) {
  const helperId = useId();
  const helper = battlenetEnabled(blizzardConfigFromEnv()) ? "Vincula Battle.net o añádelo a mano" : "Regístralo para aparecer en la plantilla";
  return (
    <Link
      href={href}
      aria-describedby={helperId}
      data-testid="add-main-character"
      className="group flex items-center gap-2.5 rounded border border-gold-dim bg-gold/5 px-2.5 py-2.5 transition-colors hover:border-gold hover:bg-gold/10 focus-visible:border-gold focus-visible:bg-gold/10 focus-visible:outline-none"
    >
      <span aria-hidden className="btn-primary flex size-7 shrink-0 items-center justify-center rounded-full">
        <svg viewBox="0 0 16 16" width={12} height={12}>
          <path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block font-display text-[0.8125rem] font-semibold text-gold group-hover:text-gold-bright">
          Añade tu personaje principal
        </span>
        <span id={helperId} className="mt-0.5 block text-[0.7rem] text-muted">
          {helper}
        </span>
      </span>
    </Link>
  );
}

/** Guild hosts redirect /account to the Guildbook apex, where the account lives, so this is a full navigation. */
export function AccountSettingsLink({ className = "btn btn-ghost btn-sm w-full", children = "Cuenta y privacidad" }: { className?: string; children?: ReactNode }) {
  return (
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/account" className={className} data-testid="account-settings-link">
      {children}
    </a>
  );
}

export function SignOutButton({ className = "btn btn-ghost btn-sm w-full", children = "Cerrar sesión" }: { className?: string; children?: ReactNode }) {
  return (
    <form action={signOutAction}>
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}
