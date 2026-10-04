import Link from "next/link";
import { AddonIcon } from "@/components/addon-icon";
import { ClassIcon } from "@/components/class-icon";
import { GuildEmblem } from "@/components/guild-emblem";
import { isOpenPriority, PriorityIcon } from "@/components/priority-icon";
import { ScheduleList } from "@/components/schedule-list";
import { ClassName, FactionBadge, Panel } from "@/components/ui";
import { db } from "@/db";
import { can } from "@/lib/authz/policy";
import { CLASS_INFO, CLASSES, ROLE_LABELS } from "@/lib/game";
import { guildHref } from "@/lib/paths";
import { getGuild, getViewer } from "@/server/context";
import { listAddons, listRecruitmentNeeds, listScheduleSlots } from "@/server/services/content";

export default async function HomePage({ params }: PageProps<"/[guild]">) {
  const { guild: slug } = await params;
  const guild = await getGuild(slug);
  const viewer = await getViewer(guild.id);
  const [slots, needs, addonList] = await Promise.all([
    listScheduleSlots(db, guild.id),
    listRecruitmentNeeds(db, guild.id),
    listAddons(db, guild.id),
  ]);
  const openNeeds = needs.filter((n) => n.priority !== "closed");
  const isMember = can(viewer.actor, "member.area");
  const order = guild.preset === "order";
  const motto = guild.motto ?? (order ? "Quis ut Deus" : null);

  return (
    <div className="space-y-10">
      <section className="flex flex-col items-center pt-4 text-center">
        <GuildEmblem guild={guild} className={`h-40 w-32 sm:h-52 sm:w-44 ${order ? "drop-shadow-[0_0_24px_rgba(168,24,47,0.45)]" : "drop-shadow-[0_0_24px_color-mix(in_srgb,var(--theme-glow)_45%,transparent)]"}`} />
        <h1 className="mt-6 font-title text-3xl text-gold sm:text-5xl">{guild.name}</h1>
        {motto && <p className="mt-2 font-display text-lg tracking-[0.35em] text-crimson-bright uppercase">{motto}</p>}
        <hr className="rule-gold mt-5 w-56" />
        <p className="mt-5 max-w-2xl leading-relaxed text-bone/90">{guild.description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {!isMember && guild.publishedAt && guild.recruitmentOpen && (
            <Link href={guildHref(slug, "/apply")} className="btn btn-primary">
              {order ? "Solicita el ingreso en la Orden" : "Solicita unirte"}
            </Link>
          )}
          <Link href={guildHref(slug, "/charter")} className="btn btn-ghost">
            Leer el reglamento
          </Link>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Horario de bandas">
          <ScheduleList slots={slots} timezone={guild.timezone} showFaction={!guild.faction} />
        </Panel>

        <Panel title="Reclutamiento">
          {!guild.recruitmentOpen ? (
            <p className="text-sm text-muted italic">El reclutamiento está cerrado ahora mismo. Los miembros sociales siempre pueden escribirnos por Discord.</p>
          ) : openNeeds.length === 0 ? (
            <p className="text-sm text-muted italic">Aceptamos solicitudes de todas las clases.</p>
          ) : (
            <ul className="space-y-2">
              {CLASSES.filter((c) => openNeeds.some((n) => n.wowClass === c)).map((c) => (
                <li key={c} className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 last:border-0">
                  <span className="inline-flex items-center gap-2">
                    <ClassIcon wowClass={c} size={28} decorative />
                    <ClassName wowClass={c}>{CLASS_INFO[c].label}</ClassName>
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {openNeeds
                      .filter((n) => n.wowClass === c)
                      .map((n) => (
                        <span key={n.id} className="flex items-center gap-1.5 rounded border border-line px-2 py-0.5 text-xs text-bone">
                          {ROLE_LABELS[n.role]}
                          {isOpenPriority(n.priority) && <PriorityIcon priority={n.priority} size={14} />}
                          {!guild.faction && n.faction && <FactionBadge faction={n.faction} />}
                        </span>
                      ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {(order || addonList.length > 0) && (
        <Panel title={order ? "Addons propios de la Orden" : "Addons de la hermandad"}>
          <p className="mb-4 text-sm leading-relaxed text-bone/90">
            {order
              ? "Nuestros miembros crean addons pensados para cómo hace bandas la Orden: preparación, asignaciones y valoración del rendimiento. Están a disposición de todos los miembros."
              : "Addons que crean y usan nuestros miembros: preparación, asignaciones y valoración del rendimiento."}
          </p>
          {addonList.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2">
              {addonList.slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-start gap-3 rounded border border-line p-3">
                  <AddonIcon addon={a} size={32} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="font-display font-semibold text-gold">{a.name}</p>
                    <p className="text-sm text-muted">{a.summary}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href={guildHref(slug, "/addons")} className="link mt-4 inline-block text-sm">
            Ver todos los addons →
          </Link>
        </Panel>
      )}

      {order && (
        <section className="parchment mx-auto max-w-3xl p-6 text-center sm:p-8">
          <p className="font-display text-sm tracking-[0.25em] uppercase">Sancte Michael Archangele</p>
          <p className="mt-3 leading-relaxed italic">
            Saint Michael the Archangel, defend us in battle. Be our protection against the wickedness and snares of the
            devil…
          </p>
          <Link href={`${guildHref(slug, "/charter")}#prayer`} className="mt-3 inline-block text-sm underline">
            Leer la oración completa
          </Link>
        </section>
      )}
    </div>
  );
}
