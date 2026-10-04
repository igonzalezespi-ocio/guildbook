import type { Metadata } from "next";
import Link from "next/link";
import { ClassIcon } from "@/components/class-icon";
import { FactionIcon } from "@/components/faction-icon";
import { RankInsignia } from "@/components/rank-insignia";
import { CharacterLink, ClassName, EmptyState, FactionBadge, GuildMemberTag, PageHeader, RoleBadge, VerifiedMark } from "@/components/ui";
import { db } from "@/db";
import { CLASS_INFO, CLASSES, FACTION_LABELS, FACTIONS, type Faction, specLabel } from "@/lib/game";
import { maxLevelFor } from "@/lib/game-versions";
import { guildWording } from "@/lib/guild-wording";
import { insigniaFor } from "@/lib/insignia";
import { guildHref } from "@/lib/paths";
import { getGuild } from "@/server/context";
import { guildSocialMetadata } from "@/server/guild-metadata";
import { getRoster } from "@/server/services/characters";

export async function generateMetadata({ params }: PageProps<"/[guild]/roster">): Promise<Metadata> {
  return { title: "Plantilla", ...(await guildSocialMetadata((await params).guild, "roster")) };
}

export default async function RosterPage({ params, searchParams }: PageProps<"/[guild]/roster">) {
  const { guild: slug } = await params;
  const sp = await searchParams;
  const guild = await getGuild(slug);
  const multiFaction = !guild.faction;
  const faction = multiFaction ? (FACTIONS.find((f) => f === sp.faction) as Faction | undefined) : undefined;
  const roster = (await getRoster(db, guild.id)).filter((c) => !faction || c.faction === faction);

  const maxLevel = maxLevelFor(guild.gameVersion);
  const filterLink = (f?: Faction) => (f ? `${guildHref(slug, "/roster")}?faction=${f}` : guildHref(slug, "/roster"));

  return (
    <div>
      <PageHeader title="Plantilla" eyebrow={guildWording(guild).rosterEyebrow(roster.length)} />
      {multiFaction && (
        <div className="mb-6 flex justify-center gap-2">
          {[undefined, ...FACTIONS].map((f) => (
            <Link
              key={f ?? "all"}
              href={filterLink(f)}
              className={`btn btn-sm ${faction === f ? "btn-primary" : "btn-ghost"}`}
            >
              {f && <FactionIcon faction={f} size={16} decorative className="border-0" />}
              {f ? FACTION_LABELS[f] : "Todas"}
            </Link>
          ))}
        </div>
      )}
      {roster.length === 0 ? (
        <EmptyState>Aún no hay miembros.</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CLASSES.map((c) => {
            const members = roster.filter((m) => m.wowClass === c);
            if (members.length === 0) return null;
            return (
              <section key={c} className="panel p-4" style={{ borderTopColor: CLASS_INFO[c].color, borderTopWidth: 3 }}>
                <h2 className="mb-3 flex items-center justify-between text-lg">
                  <span className="inline-flex items-center gap-2">
                    <ClassIcon wowClass={c} size={28} decorative />
                    <ClassName wowClass={c} />
                  </span>
                  <span className="text-xs text-muted">{members.length}</span>
                </h2>
                <ul className="divide-y divide-line">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 truncate">
                          <CharacterLink guildSlug={slug} character={m} className="truncate" />
                          {m.verified && <VerifiedMark size={12} />}
                          {guild.verifiedAt && m.verified && m.inGuildConfirmedAt && <GuildMemberTag guildName={guild.name} className="ml-1" />}
                        </p>
                        <p className="text-xs text-muted">
                          {specLabel(m.spec)}
                          {m.level < maxLevel && ` · nivel ${m.level}`}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gold-dim">
                          <RankInsignia insignia={insigniaFor({ insignia: m.rankInsignia, tier: m.rankTier })} tier={m.rankTier} size={18} />
                          {m.rankName}
                        </p>
                        {m.alts.length > 0 && (
                          <p className="mt-0.5 text-xs text-muted">
                            <span className="mr-1">{m.alts.length === 1 ? "Alter:" : "Alters:"}</span>
                            {m.alts.map((a, i) => (
                              <span key={a.id}>
                                {i > 0 && ", "}
                                <CharacterLink guildSlug={slug} character={a} className="font-normal" />
                                {a.verified && <VerifiedMark size={10} className="ml-0.5" />}
                              </span>
                            ))}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <RoleBadge role={m.role} />
                        {multiFaction && !faction && <FactionBadge faction={m.faction} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
