import type { Metadata } from "next";
import { EmptyState, FactionBadge, PageHeader, Panel } from "@/components/ui";
import { db } from "@/db";
import { type Faction, FACTION_LABELS, FACTIONS } from "@/lib/game";
import { formatDate } from "@/lib/format";
import { guildWording } from "@/lib/guild-wording";
import { getGuild } from "@/server/context";
import { guildSocialMetadata } from "@/server/guild-metadata";
import { getProgression } from "@/server/services/content";

export async function generateMetadata({ params }: PageProps<"/[guild]/progression">): Promise<Metadata> {
  return { title: "Progreso", ...(await guildSocialMetadata((await params).guild, "progression")) };
}

export default async function ProgressionPage({ params }: PageProps<"/[guild]/progression">) {
  const { guild: slug } = await params;
  const guild = await getGuild(slug);
  const progression = await getProgression(db, guild.id);
  const factions = guild.faction ? [guild.faction] : FACTIONS;
  const columnLabel = (f: Faction) => (guild.faction ? "Primera muerte" : FACTION_LABELS[f]);

  return (
    <div>
      <PageHeader title="Progreso" eyebrow={guildWording(guild).progressionEyebrow} />
      {progression.length === 0 && <EmptyState>Aún no se sigue ninguna banda.</EmptyState>}
      <div className="grid gap-6 lg:grid-cols-2">
        {progression.map((instance) => {
          const firstKills = factions.map((f) => ({
            faction: f,
            killed: instance.bosses.filter((b) => b.kills.some((k) => k.faction === f)).length,
          }));
          return (
            <Panel
              key={instance.id}
              title={instance.name}
              actions={
                <span className="flex items-center gap-3 text-xs text-muted">
                  {firstKills.map((fk) => (
                    <span key={fk.faction} className="flex items-center gap-1.5">
                      {!guild.faction && <FactionBadge faction={fk.faction} />}
                      <span className="text-gold">
                        {fk.killed}/{instance.bosses.length}
                      </span>
                    </span>
                  ))}
                </span>
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs tracking-wider text-gold-dim uppercase">
                    <th className="pb-2 font-normal">Jefe</th>
                    {factions.map((f) => (
                      <th key={f} className="pb-2 text-right font-normal">
                        {columnLabel(f)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {instance.bosses.map((boss) => (
                    <tr key={boss.id}>
                      <td className="py-2">{boss.name}</td>
                      {factions.map((f) => {
                        const first = boss.kills.find((k) => k.faction === f);
                        return (
                          <td key={f} className="py-2 text-right">
                            {first ? (
                              <span className="text-gold">{formatDate(first.killedAt, guild.timezone)}</span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
