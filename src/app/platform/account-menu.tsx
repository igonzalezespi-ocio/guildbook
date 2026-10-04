import Link from "next/link";
import type { ReactNode } from "react";
import { AccountSettingsLink, SignOutButton } from "@/components/account-card";
import { DropdownMenu } from "@/components/dropdown-menu";
import { GuildEmblem } from "@/components/guild-emblem";
import { RankInsignia } from "@/components/rank-insignia";
import { VerifiedSeal } from "@/components/verified-seal";
import { CLASS_INFO, fullName, specLabel } from "@/lib/game";
import { insigniaFor } from "@/lib/insignia";
import type { listUserGuilds } from "@/server/services/platform";

type UserGuild = Awaited<ReturnType<typeof listUserGuilds>>[number];

/** Guilds listed in the menu before it defers to the account page. */
const MENU_GUILD_LIMIT = 5;

const MENU_ITEM =
  "flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm text-bone transition-colors hover:bg-ink hover:text-gold focus-visible:bg-ink focus-visible:text-gold focus-visible:outline-none";

function UserAvatar({ name, image, size }: { name: string; image: string | null; size: number }) {
  const style = { width: size, height: size };
  if (image) {
    return (
      // Discord CDN avatars are already square and sized; next/image would need remote image config for them.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" style={style} referrerPolicy="no-referrer" className="shrink-0 rounded-full object-cover ring-1 ring-gold-dim" />
    );
  }
  return (
    <span
      aria-hidden
      style={{ ...style, fontSize: size * 0.45 }}
      className="flex shrink-0 items-center justify-center rounded-full bg-linear-to-b from-crimson-bright to-crimson-deep font-display font-semibold text-gold-bright ring-1 ring-gold-dim"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden className="shrink-0 text-muted transition-transform group-open:rotate-180">
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ICONS = {
  settings: "M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6.9 1.5h2.2l.4 1.8 1.2.7 1.8-.6 1.1 1.9-1.4 1.2v1.4l1.4 1.2-1.1 1.9-1.8-.6-1.2.7-.4 1.8H6.9l-.4-1.8-1.2-.7-1.8.6-1.1-1.9 1.4-1.2V6.5L2.4 5.3l1.1-1.9 1.8.6 1.2-.7Z",
  signOut: "M6.5 2.5h-3v11h3M10.5 5l3 3-3 3M13.5 8H6",
  create: "M8 3v10M3 8h10",
  support: "M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.3v.2",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} aria-hidden className="shrink-0 text-gold-dim">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-2 font-display text-[0.7rem] tracking-[0.2em] text-gold/80 uppercase">{children}</p>;
}

function GuildRow({ guild, href }: { guild: UserGuild; href: (path?: string) => string }) {
  const pending = guild.status === "applicant";
  const isOfficer = guild.status === "active" && (guild.rankTier === "admin" || guild.rankTier === "officer");
  const { main } = guild;

  return (
    <li className="group/row relative flex items-start gap-3 rounded px-2 py-2 transition-colors hover:bg-ink focus-within:bg-ink">
      <GuildEmblem guild={guild} className="h-11 w-9 shrink-0" />
      <div className="min-w-0 flex-1 leading-tight">
        <a
          href={href()}
          className="flex items-center gap-1 font-display text-sm font-semibold tracking-wide text-gold group-hover/row:text-gold-bright focus-visible:outline-none after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
        >
          <span className="truncate">{guild.name}</span>
          {guild.verifiedAt && <VerifiedSeal size={12} />}
        </a>
        {pending ? (
          <p className="mt-1 text-xs text-muted italic">Solicitud pendiente</p>
        ) : (
          <>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-xs">
              <RankInsignia insignia={insigniaFor({ insignia: guild.rankInsignia, tier: guild.rankTier })} tier={guild.rankTier} size={16} className="shrink-0" />
              {main ? (
                <span className="truncate">
                  <span className="text-bone">{fullName(main.name, main.surname)}</span>
                  <span className="ml-1.5" style={{ color: CLASS_INFO[main.wowClass].color }}>
                    {CLASS_INFO[main.wowClass].label} {specLabel(main.spec)}
                  </span>
                </span>
              ) : (
                <a
                  href={href("/members/characters")}
                  className="relative z-10 inline-flex min-w-0 items-center gap-1 text-gold underline-offset-2 hover:text-gold-bright hover:underline focus-visible:underline focus-visible:outline-none"
                  aria-label={`Añade tu personaje principal en ${guild.name}`}
                >
                  <svg viewBox="0 0 16 16" width={10} height={10} aria-hidden className="shrink-0">
                    <path d={ICONS.create} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
                  </svg>
                  <span className="truncate">Añade tu personaje principal</span>
                </a>
              )}
            </p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="truncate text-[0.7rem] tracking-wider text-gold uppercase">{guild.rankName}</p>
              {isOfficer && (
                <a
                  href={href("/admin")}
                  className="relative z-10 shrink-0 rounded border border-line px-1.5 py-0.5 font-display text-[0.6rem] tracking-widest text-gold uppercase transition-colors hover:border-gold-dim hover:text-gold-bright focus-visible:border-gold focus-visible:outline-none"
                  aria-label={`Administración de ${guild.name}`}
                >
                  Administrar
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

/** The apex account menu: who you are, the guilds you belong to, and account actions. */
export function PlatformAccountMenu({
  user,
  guilds,
  guildHref,
}: {
  user: { name: string | null; image: string | null };
  guilds: UserGuild[];
  /** Absolute URL on a guild's own host. Guild sites live on other hosts, so their links are plain anchors. */
  guildHref: (guild: UserGuild, path?: string) => string;
}) {
  const name = user.name ?? "Sesión iniciada";
  const shown = guilds.slice(0, MENU_GUILD_LIMIT);

  return (
    <DropdownMenu
      label={`Menú de la cuenta de ${name}`}
      className="group relative"
      summaryClassName="flex items-center gap-2 rounded border border-transparent px-1.5 py-1 text-sm hover:border-line focus-visible:border-gold-dim focus-visible:outline-none group-open:border-line sm:px-2"
      summary={
        <>
          <UserAvatar name={name} image={user.image} size={28} />
          <span className="hidden max-w-36 truncate text-bone sm:inline" data-testid="platform-user">
            {name}
          </span>
          <Chevron />
        </>
      }
    >
      <div
        data-testid="platform-account-menu"
        className="panel absolute right-0 mt-2 flex max-h-[calc(100dvh-5rem)] w-[min(23rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto p-3"
      >
        <div className="flex items-center gap-3 px-1 pt-1">
          <UserAvatar name={name} image={user.image} size={44} />
          <div className="min-w-0 leading-tight">
            <p className="truncate font-display text-base tracking-wide text-bone">{name}</p>
            <p className="mt-0.5 text-xs text-muted">Sesión iniciada con Discord</p>
          </div>
        </div>

        <hr className="rule-gold" />

        <section aria-label="Tus hermandades" className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <SectionLabel>Tus hermandades</SectionLabel>
            {guilds.length > MENU_GUILD_LIMIT && (
              <Link href="/account" className="px-2 text-xs text-gold underline-offset-2 hover:underline">
                Ver las {guilds.length}
              </Link>
            )}
          </div>
          {shown.length > 0 ? (
            <ul className="flex flex-col" data-testid="platform-menu-guilds">
              {shown.map((g) => (
                <GuildRow key={g.slug} guild={g} href={(path) => guildHref(g, path)} />
              ))}
            </ul>
          ) : (
            <div className="rounded border border-dashed border-line px-3 py-4 text-center">
              <p className="text-sm text-muted">Aún no te has unido a ninguna hermandad.</p>
              <div className="mt-3 flex justify-center gap-2">
                <Link href="/create" className="btn btn-gold btn-sm">
                  Crea una hermandad
                </Link>
                <Link href="/guilds" className="btn btn-ghost btn-sm">
                  Ver hermandades
                </Link>
              </div>
            </div>
          )}
        </section>

        <hr className="rule-gold" />

        <div className="flex flex-col">
          {shown.length > 0 && (
            <Link href="/create" className={`${MENU_ITEM} sm:hidden`}>
              <Icon name="create" />
              Crea una hermandad
            </Link>
          )}
          <AccountSettingsLink className={MENU_ITEM}>
            <Icon name="settings" />
            Cuenta y privacidad
          </AccountSettingsLink>
          <Link href="/support" className={MENU_ITEM}>
            <Icon name="support" />
            Ayuda y soporte
          </Link>
          <SignOutButton className={MENU_ITEM}>
            <Icon name="signOut" />
            Cerrar sesión
          </SignOutButton>
        </div>
      </div>
    </DropdownMenu>
  );
}
