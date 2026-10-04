import Link from "next/link";
import { ClassIcon } from "@/components/class-icon";
import { GuildEmblem } from "@/components/guild-emblem";
import type { Db } from "@/db/types";
import { CLASS_INFO, CLASSES, DAYS_OF_WEEK, type WowClass } from "@/lib/game";
import { formatClock, timezoneAbbrev } from "@/lib/format";
import { currentTier, hasLaunched, launchLabel, nextScheduleSlot } from "@/lib/showcase";
import type { TabardConfig } from "@/lib/tabard/config";
import { type LookColumns, guildLook, isOrderLook } from "@/lib/tabard/look";
import { swatchOf } from "@/lib/tabard/palette";
import { computeTheme, type SelectableBase, themeCss } from "@/lib/tabard/theme";
import { getProgression, listRecruitmentNeeds, listScheduleSlots } from "@/server/services/content";
import { type CarouselSite, PreviewCarousel } from "./preview-carousel";

/** The public links in a guild site's header, for a signed-out visitor. */
const NAV = ["Reglamento", "Historia", "Plantilla", "Progreso", "Addons"];

type Slot = { dayOfWeek: number; startTime: string; endTime: string; label: string };
type Tier = { name: string; killed: number; total: number };

interface PreviewSite {
  key: string;
  name: string;
  motto: string | null;
  address: string;
  look: LookColumns;
  recruitmentOpen: boolean;
  timezone: string;
  slots: Slot[];
  needs: WowClass[];
  tier: Tier | null;
  link: { href: string; label: string } | null;
}

type ShowcaseGuild = { id: string; name: string; motto: string | null; recruitmentOpen: boolean; timezone: string } & LookColumns;

/** The showcase guild's real schedule, open recruitment needs and progression, from the guild home page's services. */
export async function loadShowcase(db: Db, guild: ShowcaseGuild, address: string, href: string, now: Date): Promise<PreviewSite> {
  const [slots, needs, progression] = await Promise.all([
    listScheduleSlots(db, guild.id),
    listRecruitmentNeeds(db, guild.id),
    getProgression(db, guild.id),
  ]);
  const order = isOrderLook(guild);
  return {
    key: "showcase",
    name: guild.name,
    motto: guild.motto ?? (order ? "Quis ut Deus" : null),
    address,
    look: guild,
    recruitmentOpen: guild.recruitmentOpen,
    timezone: guild.timezone,
    slots,
    needs: CLASSES.filter((c) => needs.some((n) => n.wowClass === c && n.priority !== "closed")),
    tier: currentTier(progression, now),
    link: { href, label: `Visita ${guild.name}` },
  };
}

const exampleLook = (tabard: TabardConfig, base: SelectableBase): LookColumns => ({
  tabardBackground: tabard.background,
  tabardBorder: tabard.border,
  tabardBorderStyle: tabard.borderStyle,
  tabardEmblemColor: tabard.emblemColor,
  tabardEmblemId: tabard.emblemId,
  themeBase: base,
  themeOverrides: {},
});

/** Illustrative guilds (not in the database) that show off tabard themes. */
export function exampleSites(domain: string): PreviewSite[] {
  return [
    {
      key: "greenwood",
      name: "Wardens of the Greenwood",
      motto: "Root and branch",
      address: `greenwood.${domain}`,
      look: exampleLook({ background: 25, border: 14, borderStyle: "double", emblemColor: 15, emblemId: 193 }, "parchment"),
      recruitmentOpen: true,
      timezone: "America/Los_Angeles",
      slots: [
        { dayOfWeek: 3, startTime: "19:30", endTime: "22:30", label: "Banda principal" },
        { dayOfWeek: 6, startTime: "18:00", endTime: "21:00", label: "Banda principal" },
      ],
      needs: ["hunter", "druid", "priest"],
      tier: { name: "Molten Core", killed: 6, total: 10 },
      link: null,
    },
    {
      key: "emberfall",
      name: "Emberfall",
      motto: "From ash, iron",
      address: `emberfall.${domain}`,
      look: exampleLook({ background: 5, border: 3, borderStyle: "studded", emblemColor: 3, emblemId: 21 }, "modern"),
      recruitmentOpen: true,
      timezone: "America/Chicago",
      slots: [
        { dayOfWeek: 1, startTime: "20:00", endTime: "23:00", label: "Banda principal" },
        { dayOfWeek: 4, startTime: "20:00", endTime: "23:00", label: "Banda principal" },
      ],
      needs: ["rogue", "warlock", "shaman"],
      tier: { name: "Molten Core", killed: 9, total: 10 },
      link: null,
    },
  ];
}

const label = "text-[0.6rem] tracking-wider text-gold-dim uppercase";

function Frame({ site, now, example }: { site: PreviewSite; now: Date; example: boolean }) {
  const order = isOrderLook(site.look);
  const scope = `[data-preview-theme="${site.key}"]`;
  const look = guildLook(site.look);
  const guild = { ...site.look, name: site.name };
  const next = nextScheduleSlot(site.slots, site.timezone, now);
  const launched = hasLaunched(now);
  // Nobody has killed anything before launch, including the illustrative guilds.
  const tier = site.tier && (example && !launched ? { ...site.tier, killed: 0 } : site.tier);

  return (
    <div
      data-preview-theme={site.key}
      className={order ? "bg-ink-2 bg-[radial-gradient(ellipse_at_top,rgb(168_24_47/0.16),transparent_65%)]" : undefined}
    >
      {!order && <style dangerouslySetInnerHTML={{ __html: themeCss(computeTheme(look.tabard, look.base as SelectableBase, look.overrides), scope) }} />}
      <div className="px-5 pt-4 pb-6 sm:px-8">
        <div className="flex items-center justify-between gap-4 border-b border-line/70 pb-3">
          <span className="flex min-w-0 items-center gap-2">
            <GuildEmblem guild={guild} className="h-7 w-6 shrink-0" />
            <span className="truncate font-display text-xs font-bold tracking-widest text-gold uppercase">{site.name}</span>
          </span>
          <span className="hidden items-center gap-3.5 font-display text-[0.6rem] tracking-wider text-bone/85 md:flex">
            {NAV.map((item) => (
              <span key={item}>{item}</span>
            ))}
            {site.recruitmentOpen && <span className="btn btn-primary min-h-0 px-2 py-0.5 text-[0.6rem]">Únete</span>}
          </span>
        </div>

        <div className="grid items-center gap-6 pt-6 sm:grid-cols-[auto_1fr] sm:gap-8">
          <GuildEmblem guild={guild} className="mx-auto h-24 w-20 sm:h-28 sm:w-24" />
          <div className="text-center sm:text-left">
            <p className="font-title text-2xl text-gold sm:text-3xl">{site.name}</p>
            {site.motto && <p className="mt-1 font-display text-xs tracking-[0.3em] text-crimson-bright uppercase">{site.motto}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2 sm:justify-start">
              {site.recruitmentOpen && (
                <span className="btn btn-primary min-h-0 px-3 py-1.5 text-[0.65rem]">{order ? "Únete a la Orden" : "Solicita unirte"}</span>
              )}
              <span className="btn btn-ghost min-h-0 px-3 py-1.5 text-[0.65rem]">Lee el reglamento</span>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="panel p-3">
            <p className={label}>Próxima banda</p>
            {next ? (
              <>
                <p className="mt-1 text-sm font-semibold text-bone">
                  {DAYS_OF_WEEK[next.dayOfWeek]}, {next.label}
                </p>
                <p className="text-xs text-gold">
                  {formatClock(next.startTime)} – {formatClock(next.endTime)} {timezoneAbbrev(site.timezone, now)}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted italic">Horario por anunciar.</p>
            )}
          </div>
          <div className="panel p-3">
            <p className={label}>Reclutamiento</p>
            {!site.recruitmentOpen ? (
              <p className="mt-1 text-xs text-muted italic">Cerrado por ahora.</p>
            ) : site.needs.length === 0 ? (
              <p className="mt-1 text-xs text-muted italic">Todas las clases son bienvenidas.</p>
            ) : (
              <>
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {site.needs.map((c) => (
                    <ClassIcon key={c} wowClass={c} size={20} decorative />
                  ))}
                </p>
                <p className="mt-1 truncate text-xs text-muted">{site.needs.map((c) => CLASS_INFO[c].label).join(", ")}</p>
              </>
            )}
          </div>
          <div className="panel p-3">
            <p className={label}>Progreso</p>
            {tier ? (
              <>
                <p className="mt-1 text-sm font-semibold text-bone">{tier.name}</p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink">
                  <div className="h-full rounded-full bg-linear-to-r from-gold-dim to-gold" style={{ width: `${(tier.killed / tier.total) * 100}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {tier.killed === 0 && !launched ? `Abre el ${launchLabel()}` : `${tier.killed} de ${tier.total} jefes`}
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-muted italic">Aún no hay bandas registradas.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A miniature guild site in a browser frame for the apex home page, cycling through a real guild and a few
 * example tabard themes. The frames are decorative; the real link sits in the caption underneath.
 */
export function SitePreview({ sites, now }: { sites: PreviewSite[]; now: Date }) {
  const carousel: CarouselSite[] = sites.map((site) => ({
    key: site.key,
    name: site.name,
    address: site.address,
    swatch: {
      field: swatchOf("background", site.look.tabardBackground).hex,
      border: swatchOf("border", site.look.tabardBorder).hex,
      emblem: swatchOf("emblem", site.look.tabardEmblemColor).hex,
    },
    frame: <Frame site={site} now={now} example={!site.link} />,
    caption: site.link ? (
      <>
        Una web de hermandad en Guildbook.{" "}
        <a href={site.link.href} className="link">
          {site.link.label}
        </a>
      </>
    ) : (
      <>
        {site.name} es un ejemplo de tema de tabardo.{" "}
        <Link href="/create" className="link">
          Tu hermandad aquí
        </Link>
      </>
    ),
  }));
  return <PreviewCarousel sites={carousel} />;
}
