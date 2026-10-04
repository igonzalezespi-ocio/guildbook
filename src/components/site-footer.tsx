import Link from "next/link";
import type { ReactNode } from "react";
import { FactionIcon } from "@/components/faction-icon";
import { GitHubIcon } from "@/components/github-icon";
import { GameVersionIcon } from "@/components/game-version";
import { GuildEmblem } from "@/components/guild-emblem";
import { RegionIcon } from "@/components/region";
import { RulesetIcon } from "@/components/ruleset";
import { VerifiedSeal } from "@/components/verified-seal";
import { XIcon } from "@/components/x-icon";
import { db } from "@/db";
import { can } from "@/lib/authz/policy";
import { SOURCE_URL, X_URL } from "@/lib/brand";
import { formatClock, timezoneAbbrev } from "@/lib/format";
import { DAYS_OF_WEEK, FACTION_LABELS, REGION_LABELS, RULESET_INFO } from "@/lib/game";
import { realmLabel, VERSION_INFO } from "@/lib/game-versions";
import { guildHref } from "@/lib/paths";
import { type Guild, offersApply, type Viewer } from "@/server/context";
import { getRequestHost } from "@/server/hosts";
import { listScheduleSlots } from "@/server/services/content";

function FooterHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 font-display text-xs font-semibold tracking-[0.25em] text-gold uppercase">{children}</h2>;
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="text-sm text-bone/80 transition-colors hover:text-gold">
        {children}
      </Link>
    </li>
  );
}

export async function SiteFooter({ guild, viewer }: { guild: Guild; viewer: Viewer }) {
  const h = (p: string) => guildHref(guild.slug, p);
  const [slots, current] = await Promise.all([listScheduleSlots(db, guild.id), getRequestHost()]);
  const tz = timezoneAbbrev(guild.timezone);
  const isMember = can(viewer.actor, "member.area");
  const isOfficer = can(viewer.actor, "admin.area");
  const year = new Date().getFullYear();
  const order = guild.preset === "order";
  const motto = guild.motto ?? (order ? "Quis ut Deus" : null);

  return (
    <footer className="mt-10 border-t border-line bg-ink-2/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <section className="flex flex-col items-center text-center sm:items-start sm:text-left">
          <Link href={h("/")} className="flex items-center gap-3">
            <GuildEmblem guild={guild} className="h-14 w-11 shrink-0" />
            <span className="font-display text-base font-bold tracking-widest text-gold uppercase">{guild.name}</span>
          </Link>
          {guild.verifiedAt && <VerifiedSeal label size={14} className="mt-2" />}
          {motto && <p className="mt-3 font-display text-xs tracking-[0.3em] text-crimson-bright uppercase">{motto}</p>}
          <p className="mt-3 line-clamp-4 text-sm leading-relaxed text-muted">{guild.description}</p>
        </section>

        <nav aria-label="Pie de página" className="text-center sm:text-left">
          <FooterHeading>{order ? "La Orden" : "La hermandad"}</FooterHeading>
          <ul className="space-y-2">
            <FooterLink href={h("/charter")}>Reglamento</FooterLink>
            <FooterLink href={h("/lore")}>{order ? "Historia de la Orden" : "Nuestra historia"}</FooterLink>
            {order && <FooterLink href={`${h("/charter")}#prayer`}>Oración a san Miguel</FooterLink>}
            <FooterLink href={h("/roster")}>Plantilla</FooterLink>
            <FooterLink href={h("/progression")}>Progreso</FooterLink>
            <FooterLink href={h("/addons")}>Addons propios</FooterLink>
            {isMember && <FooterLink href={h("/members/characters")}>Mis personajes</FooterLink>}
            {isOfficer && <FooterLink href={h("/admin")}>Administración</FooterLink>}
          </ul>
        </nav>

        <section className="text-center sm:text-left">
          <FooterHeading>Noches de banda</FooterHeading>
          {slots.length === 0 ? (
            <p className="text-sm text-muted italic">Horario por anunciar.</p>
          ) : (
            <ul className="space-y-2">
              {slots.map((s) => (
                <li key={s.id} className="text-sm">
                  <span className="block font-semibold text-bone">{DAYS_OF_WEEK[s.dayOfWeek]}</span>
                  <span className="text-muted">
                    De {formatClock(s.startTime)} a {formatClock(s.endTime)} {tz}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl className="mt-4 space-y-1 text-xs text-muted">
            {guild.gameVersion !== "forever" && (
              <div>
                <dt className="inline text-gold-dim">Juego </dt>
                <dd className="inline-flex items-center gap-1 align-middle" data-testid="footer-game-version">
                  <GameVersionIcon version={guild.gameVersion} size={13} className="text-gold-dim" />
                  {VERSION_INFO[guild.gameVersion].label}
                </dd>
              </div>
            )}
            {guild.realmSlug && (
              <div>
                <dt className="inline text-gold-dim">Reino </dt>
                <dd className="inline align-middle" data-testid="footer-realm">
                  {realmLabel(guild.gameVersion, guild.realmSlug, guild.region)}
                </dd>
              </div>
            )}
            <div>
              <dt className="inline text-gold-dim">Región </dt>
              <dd className="inline-flex items-center gap-1 align-middle" data-testid="footer-region">
                <RegionIcon size={13} className="text-gold-dim" />
                {REGION_LABELS[guild.region]}
              </dd>
            </div>
            <div>
              <dt className="inline text-gold-dim">Facción </dt>
              <dd className="inline-flex items-center gap-1 align-middle">
                <FactionIcon faction={guild.faction} size={14} decorative />
                {FACTION_LABELS[guild.faction]}
              </dd>
            </div>
            <div>
              <dt className="inline text-gold-dim">Tipo de reino </dt>
              <dd className="inline-flex items-center gap-1 align-middle" data-testid="footer-ruleset">
                <RulesetIcon ruleset={guild.ruleset} size={13} className="text-gold-dim" />
                {RULESET_INFO[guild.ruleset].label}
              </dd>
            </div>
          </dl>
        </section>

        <section className="flex flex-col items-center text-center sm:items-start sm:text-left">
          <FooterHeading>{order ? "Únete a la Orden" : "Únete"}</FooterHeading>
          {guild.publishedAt ? (
            <p className="text-sm text-muted">
              El reclutamiento está{" "}
              <strong className={guild.recruitmentOpen ? "text-gold" : "text-bone"}>
                {guild.recruitmentOpen ? "abierto" : "cerrado"}
              </strong>
              .{" "}
              {guild.recruitmentOpen
                ? order
                  ? "Cualquier jugador que respete la fe puede enviar su solicitud."
                  : "Lee el reglamento y envía tu solicitud en este sitio."
                : "Los miembros sociales siempre pueden ponerse en contacto."}
            </p>
          ) : (
            <p className="text-sm text-muted" data-testid="footer-opening-soon">
              <strong className="text-bone">Abre pronto.</strong> Las solicitudes se abren cuando la hermandad se publique.
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
            {offersApply(viewer, guild) && guild.recruitmentOpen && (
              <Link href={h("/apply")} className="btn btn-primary btn-sm">
                Únete
              </Link>
            )}
            {guild.discordInviteUrl && (
              <a href={guild.discordInviteUrl} className="btn btn-ghost btn-sm" target="_blank" rel="noopener noreferrer">
                Únete a nuestro Discord
              </a>
            )}
          </div>
        </section>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto max-w-6xl px-4 py-6 text-center">
          <hr className="rule-gold mx-auto mb-4 w-24" />
          {order && (
            <p className="mb-4 font-display text-sm text-gold-dim italic">Sancte Michael Archangele, defende nos in proelio.</p>
          )}
          <p className="text-xs text-muted">
            &copy; {year} {guild.name}. Web de hermandad hecha por fans en Guildbook, sin relación con Blizzard Entertainment.
          </p>
          <p className="mt-1 text-xs text-muted">
            World of Warcraft y Blizzard Entertainment son marcas comerciales o marcas registradas de Blizzard
            Entertainment, Inc. El arte del juego, incluidos los iconos de clase, es &copy; Blizzard Entertainment, Inc.
          </p>
          <nav aria-label="Legal" className="mt-3 flex justify-center gap-4 text-xs">
            <a href={`${current.apexOrigin}/terms`} className="text-bone/70 hover:text-gold">
              Términos
            </a>
            <a href={`${current.apexOrigin}/privacy`} className="text-bone/70 hover:text-gold">
              Privacidad
            </a>
            <a href={`${current.apexOrigin}/support`} className="text-bone/70 hover:text-gold">
              Soporte
            </a>
          </nav>
          <p className="mt-3 inline-flex items-center gap-2 text-[11px] text-muted">
            <span>
              Funciona con{" "}
              <a href={current.apexOrigin} className="text-bone/70 hover:text-gold">
                Guildbook
              </a>
            </span>
            <a
              href={SOURCE_URL}
              aria-label="Código fuente de Guildbook en GitHub"
              className="text-muted hover:text-gold"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitHubIcon size={12} />
            </a>
            <a
              href={X_URL}
              aria-label="Guildbook en X"
              className="text-muted hover:text-gold"
              target="_blank"
              rel="noopener noreferrer"
            >
              <XIcon size={11} />
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
