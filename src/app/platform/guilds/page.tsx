import clsx from "clsx";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { FactionIcon } from "@/components/faction-icon";
import { RegionIcon } from "@/components/region";
import { RulesetIcon } from "@/components/ruleset";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import {
  FACTION_LABELS,
  FACTIONS,
  type Faction,
  REGION_LABELS,
  REGIONS,
  type Region,
  RULESET_INFO,
  RULESETS,
  type Ruleset,
} from "@/lib/game";
import { DEFAULT_GUILD_VERSION, findRealm, SUPPORTED_GUILD_VERSIONS, type SupportedGuildVersion, VERSION_INFO } from "@/lib/game-versions";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { listDirectoryGuilds } from "@/server/services/platform";
import { GuildCard } from "../guild-card";
import { DirectoryFilters } from "./directory-filters";
import { directoryHref } from "./filters";

export const metadata: Metadata = {
  title: "Directorio de hermandades",
  description: "Hermandades de World of Warcraft: Forever en Guildbook que buscan miembros nuevos.",
};

function pick<T extends string>(options: readonly T[], value: string | string[] | undefined): T | undefined {
  return options.find((o) => o === value);
}

function FilterChip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={clsx(
        "inline-flex min-h-9 items-center gap-1.5 rounded border px-2.5 text-xs transition-colors",
        active ? "border-gold-dim bg-gold/10 text-gold" : "border-line text-bone/80 hover:border-gold-dim hover:text-gold",
      )}
    >
      {children}
    </Link>
  );
}

export default async function DirectoryPage({ searchParams }: PageProps<"/platform/guilds">) {
  const sp = await searchParams;
  const region = pick<Region>(REGIONS, sp.region);
  const faction = pick<Faction>(FACTIONS, sp.faction);
  const ruleset = pick<Ruleset>(RULESETS, sp.ruleset);
  const version = pick<SupportedGuildVersion>(SUPPORTED_GUILD_VERSIONS, sp.version) ?? DEFAULT_GUILD_VERSION;
  const realm = typeof sp.realm === "string" ? (findRealm(version, sp.realm)?.slug ?? undefined) : undefined;
  const [current, guilds] = await Promise.all([getRequestHost(), listDirectoryGuilds(db, { version, realm, region, faction, ruleset })]);
  const filtered = Boolean(region || faction || ruleset || realm);
  const base = { version, realm };

  return (
    <div>
      <PageHeader title="Directorio de hermandades" eyebrow="Guildbook">
        Hermandades que han elegido aparecer aquí. Las verificadas, cuyo maestro de la hermandad demostró su rango en el juego
        con Battle.net, salen primero. Los oficiales pueden añadir la suya en Administración &gt; Hermandad.
      </PageHeader>
      <nav aria-label="Filtrar hermandades" className="mb-6" data-testid="directory-filters">
        <DirectoryFilters version={version} realm={realm} region={region} faction={faction} ruleset={ruleset} />
        <noscript>
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs tracking-wider text-gold-dim uppercase">Juego</span>
              {SUPPORTED_GUILD_VERSIONS.map((v) => (
                <FilterChip key={v} href={directoryHref({ version: v, region, faction, ruleset })} active={version === v}>
                  {VERSION_INFO[v].label}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs tracking-wider text-gold-dim uppercase">Región</span>
              <FilterChip href={directoryHref({ ...base, faction, ruleset })} active={!region}>
                Cualquiera
              </FilterChip>
              {REGIONS.map((r) => (
                <FilterChip key={r} href={directoryHref({ ...base, region: r, faction, ruleset })} active={region === r}>
                  <RegionIcon size={13} className="text-gold-dim" />
                  {REGION_LABELS[r]}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs tracking-wider text-gold-dim uppercase">Facción</span>
              <FilterChip href={directoryHref({ ...base, region, ruleset })} active={!faction}>
                Cualquiera
              </FilterChip>
              {FACTIONS.map((f) => (
                <FilterChip key={f} href={directoryHref({ ...base, region, faction: f, ruleset })} active={faction === f}>
                  <FactionIcon faction={f} size={14} decorative />
                  {FACTION_LABELS[f]}
                </FilterChip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-16 text-xs tracking-wider text-gold-dim uppercase">Tipo</span>
              <FilterChip href={directoryHref({ ...base, region, faction })} active={!ruleset}>
                Cualquiera
              </FilterChip>
              {RULESETS.map((r) => (
                <FilterChip key={r} href={directoryHref({ ...base, region, faction, ruleset: r })} active={ruleset === r}>
                  <RulesetIcon ruleset={r} size={13} className="text-gold-dim" />
                  {RULESET_INFO[r].label}
                </FilterChip>
              ))}
            </div>
          </div>
        </noscript>
      </nav>
      {guilds.length === 0 ? (
        <p className="text-center text-muted">
          {filtered ? (
            <>
              Ninguna hermandad del directorio coincide con esos filtros. <Link href={directoryHref({ version })} className="link">Ver todas las hermandades</Link>.
            </>
          ) : (
            <>
              Aún no hay hermandades{version === DEFAULT_GUILD_VERSION ? "" : ` de ${VERSION_INFO[version].label}`} en el directorio.{" "}
              <Link href={version === DEFAULT_GUILD_VERSION ? "/create" : `/create?version=${version}`} className="link">
                Crea la primera
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="directory">
          {guilds.map((g) => (
            <GuildCard key={g.slug} guild={g} href={guildOrigin(g.slug, current, g.customDomain)}>
              <span>{g.members === 1 ? "1 miembro" : `${g.members} miembros`}</span>
              <span className={g.recruitmentOpen ? "text-gold" : undefined}>{g.recruitmentOpen ? "Reclutando" : "No recluta"}</span>
            </GuildCard>
          ))}
        </ul>
      )}
    </div>
  );
}
