import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { AddonIcon } from "@/components/addon-icon";
import { BattlenetAccount, BattlenetNotice, EmptySnapshotNote, LinkBattlenetButton } from "@/components/battlenet";
import { RegionTag } from "@/components/region";
import { Listbox } from "@/components/listbox";
import { ROLE_OPTIONS } from "@/components/select-options";
import {
  CharacterLink,
  ClassName,
  EmptyState,
  FactionBadge,
  GuildMemberTag,
  PageHeader,
  Panel,
  RoleBadge,
  Tag,
  VerifiedMark,
} from "@/components/ui";
import { db } from "@/db";
import type { BattlenetCharacterSnapshot } from "@/db/schema";
import { formatDateTime } from "@/lib/format";
import { CLASS_INFO, fullName, PROFESSION_LABELS, raceLabel, specLabel } from "@/lib/game";
import { hasSurnames, realmLabel, SUPPORTED_GUILD_VERSIONS, VERSION_INFO } from "@/lib/game-versions";
import { guildHref } from "@/lib/paths";
import { importBattlenetCharacterAction } from "@/server/actions/battlenet";
import { archiveCharacterAction, setMainCharacterAction } from "@/server/actions/member";
import { battlenetEnabled, blizzardConfigFromEnv, snapshotRegion } from "@/server/blizzard";
import { snapshotVersion } from "@/server/blizzard/filter";
import { requirePage } from "@/server/context";
import { getEligibleCharacters } from "@/server/services/battlenet";
import { type CharacterWithProfessions, listOwnCharacters } from "@/server/services/characters";

export const metadata: Metadata = { title: "Mis personajes" };

function ImportRow({
  slug,
  bnet,
  existing,
  surnames,
}: {
  slug: string;
  bnet: BattlenetCharacterSnapshot;
  existing: CharacterWithProfessions | undefined;
  surnames: boolean;
}) {
  const info = CLASS_INFO[bnet.wowClass];
  const summary = (
    <div className="min-w-0">
      <p className="font-semibold" style={{ color: info.color }}>
        {bnet.name}
      </p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
        {info.label} {raceLabel(bnet.race)} de nivel {bnet.level}, {bnet.realmName}
        <RegionTag region={snapshotRegion(bnet)} />
      </p>
      {bnet.guildName && <p className="text-xs text-gold-dim">&lt;{bnet.guildName}&gt;</p>}
    </div>
  );

  if (existing?.bnetCharacterId === bnet.id) {
    return (
      <li className="flex items-center justify-between gap-3 py-3">
        {summary}
        <span className="flex items-center gap-1.5 text-xs text-gold">
          <VerifiedMark size={12} decorative />
          Importado como {fullName(existing.name, existing.surname)}
        </span>
      </li>
    );
  }

  return (
    <li className="py-3">
      <ActionForm action={importBattlenetCharacterAction.bind(null, slug)} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="bnetCharacterId" value={bnet.id} />
        <div className="w-full">{summary}</div>
        {!surnames ? null : bnet.surname ? (
          <input type="hidden" name="surname" value={bnet.surname} />
        ) : (
          <label className="flex flex-col text-xs text-muted">
            Apellido
            <input
              name="surname"
              required
              maxLength={12}
              autoComplete="off"
              defaultValue={existing?.surname}
              aria-label={`Apellido de ${bnet.name}`}
              className="field mt-1 min-h-9 w-32 py-1 text-sm"
            />
          </label>
        )}
        <div className="flex flex-col text-xs text-muted">
          <span aria-hidden>Especialización</span>
          <Listbox
            name="spec"
            options={info.specs.map((s) => ({ value: s, label: specLabel(s) }))}
            defaultValue={existing?.spec}
            aria-label={`Especialización de ${bnet.name}`}
            size="sm"
            className="mt-1 w-36"
          />
        </div>
        <div className="flex flex-col text-xs text-muted">
          <span aria-hidden>Rol</span>
          <Listbox
            name="role"
            options={ROLE_OPTIONS}
            defaultValue={existing?.role}
            aria-label={`Rol de ${bnet.name}`}
            size="sm"
            className="mt-1 w-32"
          />
        </div>
        <SubmitButton size="sm" pendingLabel="Importando…">
          {existing ? "Verificar" : "Importar"}
        </SubmitButton>
        <FormMessage className="w-full" />
      </ActionForm>
    </li>
  );
}

export default async function CharactersPage({ params, searchParams }: PageProps<"/[guild]/members/characters">) {
  const { guild: slug } = await params;
  const sp = await searchParams;
  const returnTo = guildHref(slug, "/members/characters");
  const { guild, actor } = await requirePage(slug, "character.manageOwn", returnTo);
  const bnetEnabled = battlenetEnabled(blizzardConfigFromEnv());
  const [characters, bnet] = await Promise.all([
    listOwnCharacters(db, actor),
    bnetEnabled ? getEligibleCharacters(db, actor) : Promise.resolve({ link: null, characters: [] }),
  ]);
  const matchFor = (b: BattlenetCharacterSnapshot) =>
    characters.find((c) => c.bnetCharacterId === b.id) ??
    characters.find((c) => !c.bnetCharacterId && c.name.toLowerCase() === b.name.toLowerCase());
  const toImport = bnet.characters.filter((b) => characters.every((c) => c.bnetCharacterId !== b.id)).length;
  const versionLabel = VERSION_INFO[guild.gameVersion].label;
  const surnames = hasSurnames(guild.gameVersion);
  const otherVersions = bnet.link
    ? SUPPORTED_GUILD_VERSIONS.filter((v) => v !== guild.gameVersion).flatMap((v) => {
        const count = bnet.link!.characters.filter((c) => snapshotVersion(c) === v).length;
        return count > 0 ? [`${count} ${count === 1 ? "personaje" : "personajes"} de ${VERSION_INFO[v].label}`] : [];
      })
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Mis personajes" />
      <BattlenetNotice status={sp.bnet} />

      {bnetEnabled && (
        <Panel>
          {bnet.link ? (
            <div className="space-y-3">
              <BattlenetAccount link={bnet.link} slug={slug} returnTo={returnTo} timezone={guild.timezone} />
              {bnet.characters.length === 0 ? (
                <EmptySnapshotNote link={bnet.link} faction={guild.faction} region={guild.region} version={guild.gameVersion} />
              ) : (
                <details className="group" open={sp.bnet === "linked" || undefined}>
                  <summary className="btn btn-primary btn-sm cursor-pointer list-none">
                    Importar personajes{toImport > 0 ? ` (${toImport})` : ""}
                  </summary>
                  <p className="mt-3 text-xs text-muted">
                    El nombre, la clase y el nivel vienen de Battle.net y se mantienen sincronizados. Elige tu especialización y tu rol
                    {surnames ? ", y escribe tu apellido si Battle.net no lo da" : ""}.
                    {guild.realmSlug ? ` Los personajes que están en ${guild.name} en el juego aparecen como miembros verificados.` : ""}
                  </p>
                  <h3 className="mt-3 font-display text-sm tracking-wide text-gold" data-testid="import-version-heading">
                    Personajes de {versionLabel}
                    {guild.realmSlug ? ` en ${realmLabel(guild.gameVersion, guild.realmSlug, guild.region)}` : ""}
                  </h3>
                  <ul className="divide-y divide-line">
                    {bnet.characters.map((b) => (
                      <ImportRow key={b.id} slug={slug} bnet={b} existing={matchFor(b)} surnames={surnames} />
                    ))}
                  </ul>
                </details>
              )}
              {otherVersions.length > 0 && (
                <p className="text-xs text-muted" data-testid="other-version-characters">
                  También en esta cuenta: {otherVersions.join(", ")}. Se unen a hermandades de su propio juego.
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Vincula Battle.net para importar tus personajes como verificados y mantener sus niveles sincronizados.
              </p>
              <LinkBattlenetButton slug={slug} returnTo={returnTo} />
            </div>
          )}
        </Panel>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Link href={guildHref(slug, "/vigil")} className="inline-flex items-center gap-2 text-sm text-gold hover:underline">
          <AddonIcon icon="eye" size={24} />
          Revisa tus combates en Vigil
        </Link>
        <Link href={guildHref(slug, "/members/characters/new")} className={`btn ${bnetEnabled ? "btn-ghost" : "btn-primary"}`}>
          Registrar personaje
        </Link>
      </div>
      {characters.length === 0 && <EmptyState>Registra tu primer personaje para aparecer en la plantilla.</EmptyState>}
      <ul className="space-y-3">
        {characters.map((c) => (
          <li key={c.id} className="panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="flex flex-wrap items-center gap-x-1.5 text-lg">
                  <CharacterLink guildSlug={slug} character={c} />
                  {c.verified && <VerifiedMark />}
                  {c.isMain && <span className="ml-1 text-xs tracking-widest text-gold uppercase">Principal</span>}
                </p>
                <p className="text-sm text-muted">
                  <ClassName wowClass={c.wowClass} /> {specLabel(c.spec)} de nivel {c.level}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {!guild.faction && <FactionBadge faction={c.faction} />}
                  <RoleBadge role={c.role} />
                  {!c.verified && <Tag>Sin verificar</Tag>}
                  {guild.verifiedAt && c.verified && c.inGuildConfirmedAt && <GuildMemberTag guildName={guild.name} />}
                  {c.verified && c.region && <RegionTag region={c.region} className="self-center" />}
                </div>
                {c.verified && c.syncedAt && (
                  <p className="mt-1 text-xs text-muted">Sincronizado desde Battle.net el {formatDateTime(c.syncedAt, guild.timezone)}</p>
                )}
                {c.professions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.professions.map((p) => (
                      <Tag key={p.profession}>
                        {PROFESSION_LABELS[p.profession]}
                        {p.skill && <span className="ml-1 text-gold">{p.skill}</span>}
                      </Tag>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href={guildHref(slug, `/members/characters/${c.id}`)} className="btn btn-ghost btn-sm">
                  Editar
                </Link>
                {!c.isMain && (
                  <ActionForm action={setMainCharacterAction.bind(null, slug, c.id)}>
                    <SubmitButton variant="ghost" size="sm">
                      Hacer principal
                    </SubmitButton>
                  </ActionForm>
                )}
                <ActionForm action={archiveCharacterAction.bind(null, slug, c.id)} confirm={`¿Quitar a ${fullName(c.name, c.surname)} de tus personajes?`}>
                  <SubmitButton variant="danger" size="sm">
                    Quitar
                  </SubmitButton>
                  <FormMessage />
                </ActionForm>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
