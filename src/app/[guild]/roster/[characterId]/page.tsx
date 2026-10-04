import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ClassIcon } from "@/components/class-icon";
import { LootTable } from "@/components/loot-table";
import { RankInsignia } from "@/components/rank-insignia";
import { RegionTag } from "@/components/region";
import { CharacterLink, ClassName, FactionBadge, GuildMemberTag, PageHeader, Panel, RoleBadge, Tag, VerifiedMark } from "@/components/ui";
import { db } from "@/db";
import { TIER_LABELS } from "@/lib/authz/tiers";
import { CLASS_INFO, fullName, PROFESSION_LABELS, specLabel } from "@/lib/game";
import { formatDate } from "@/lib/format";
import { guildWording } from "@/lib/guild-wording";
import { insigniaFor } from "@/lib/insignia";
import { canViewLoot } from "@/lib/loot/access";
import { getGuild, getViewer } from "@/server/context";
import { getPublicCharacter, type PublicCharacter } from "@/server/services/characters";
import { characterLoot } from "@/server/services/loot";

const loadCharacter = cache(async (slug: string, characterId: string) => {
  const guild = await getGuild(slug);
  const character = await getPublicCharacter(db, guild.id, characterId);
  if (!character) notFound();
  return { guild, character };
});

const classLine = (c: { level: number; spec: string; wowClass: PublicCharacter["wowClass"] }) =>
  `${CLASS_INFO[c.wowClass].label} ${specLabel(c.spec)} de nivel ${c.level}`;

export async function generateMetadata({ params }: PageProps<"/[guild]/roster/[characterId]">): Promise<Metadata> {
  const { guild: slug, characterId } = await params;
  const { guild, character } = await loadCharacter(slug, characterId);
  return {
    title: fullName(character.name, character.surname),
    description: `${classLine(character)} ${guildWording(guild).characterOf}.`,
  };
}

function otherCharactersTitle(others: PublicCharacter["otherCharacters"]) {
  const hasMain = others.some((o) => o.isMain);
  const hasAlts = others.some((o) => !o.isMain);
  if (hasMain && hasAlts) return "Principal y alters";
  return hasMain ? "Principal" : "Alters";
}

export default async function CharacterPage({ params }: PageProps<"/[guild]/roster/[characterId]">) {
  const { guild: slug, characterId } = await params;
  const { guild, character: c } = await loadCharacter(slug, characterId);
  const insignia = insigniaFor({ insignia: c.rankInsignia, tier: c.rankTier });
  const viewer = await getViewer(guild.id);
  const loot = canViewLoot(viewer.actor, guild) ? await characterLoot(db, viewer.actor, c.id) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={fullName(c.name, c.surname)} eyebrow={c.isMain ? "Personaje principal" : "Personaje alter"}>
        <p className="inline-flex items-center gap-2 text-base sm:text-lg">
          <ClassIcon wowClass={c.wowClass} size={28} decorative />
          <ClassName wowClass={c.wowClass}>{classLine(c)}</ClassName>
        </p>
        <div className="mt-2 flex flex-wrap justify-center gap-1.5">
          <RoleBadge role={c.role} />
          {!guild.faction && <FactionBadge faction={c.faction} />}
          {c.verified && (
            <Tag className="gap-1 border-gold-dim text-gold">
              <VerifiedMark size={11} decorative />
              Verificado
            </Tag>
          )}
          {guild.verifiedAt && c.verified && c.inGuildConfirmedAt && <GuildMemberTag guildName={guild.name} />}
          {c.verified && c.region && <RegionTag region={c.region} className="self-center" />}
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Panel title="Rango">
          <div className="flex items-center gap-4">
            <RankInsignia insignia={insignia} tier={c.rankTier} size={64} className="shrink-0" />
            <div className="min-w-0 space-y-1">
              <p className="font-display text-lg leading-tight text-gold">{c.rankName}</p>
              <p className="text-xs leading-none tracking-wider text-gold-dim uppercase">{TIER_LABELS[c.rankTier]}</p>
              {c.joinedAt && (
                <p className="pt-1 text-sm leading-snug break-words text-muted">
                  {guildWording(guild).joined} el <time dateTime={c.joinedAt.toISOString()}>{formatDate(c.joinedAt, guild.timezone)}</time>
                </p>
              )}
            </div>
          </div>
        </Panel>

        {c.professions.length > 0 && (
          <Panel title="Profesiones">
            <ul className="divide-y divide-line">
              {c.professions.map((p) => (
                <li key={p.profession} className="flex items-baseline justify-between py-1.5 text-sm">
                  <span className="text-bone">{PROFESSION_LABELS[p.profession]}</span>
                  {p.skill != null && <span className="text-gold">{p.skill}</span>}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {c.otherCharacters.length > 0 && (
          <Panel title={otherCharactersTitle(c.otherCharacters)} className="sm:col-span-2">
            <ul className="divide-y divide-line">
              {c.otherCharacters.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 truncate">
                      <CharacterLink guildSlug={slug} character={o} className="truncate" />
                      {o.verified && <VerifiedMark size={12} />}
                    </p>
                    <p className="text-xs text-muted">{classLine(o)}</p>
                  </div>
                  {o.isMain && <span className="shrink-0 text-xs tracking-widest text-gold uppercase">Principal</span>}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        {loot && (
          <Panel title="Botín" className="sm:col-span-2">
            <LootTable slug={slug} rows={loot} showRecipient={false} empty="Aún no hay botín registrado para este personaje." />
          </Panel>
        )}
      </div>
    </div>
  );
}
