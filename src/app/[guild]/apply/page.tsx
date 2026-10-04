import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { ApplicationForm } from "@/components/application-form";
import { ConfirmedJoinForm } from "@/components/confirmed-join-form";
import { BattlenetAccount, BattlenetNotice, EmptySnapshotNote, LinkBattlenetButton } from "@/components/battlenet";
import { ClassName, PageHeader, Panel, StatusPill, VerifiedMark } from "@/components/ui";
import { db } from "@/db";
import { can } from "@/lib/authz/policy";
import { formatDate } from "@/lib/format";
import { fullName } from "@/lib/game";
import { guildHref } from "@/lib/paths";
import { applyAction, applyWithInviteAction, joinAsConfirmedMemberAction, withdrawApplicationAction } from "@/server/actions/member";
import { getGuild, getViewer } from "@/server/context";
import { guildSocialMetadata } from "@/server/guild-metadata";
import { battlenetEnabled, blizzardConfigFromEnv, getBlizzardClient } from "@/server/blizzard";
import { listOwnApplications, validDraftInvite } from "@/server/services/applications";
import { getEligibleCharacters } from "@/server/services/battlenet";
import { findConfirmedJoin } from "@/server/services/confirmed-members";

export async function generateMetadata({ params }: PageProps<"/[guild]/apply">): Promise<Metadata> {
  return { title: "Únete", ...(await guildSocialMetadata((await params).guild, "apply")) };
}

export default async function ApplyPage({ params, searchParams }: PageProps<"/[guild]/apply">) {
  const { guild: slug } = await params;
  const sp = await searchParams;
  const guild = await getGuild(slug);
  const viewer = await getViewer(guild.id);
  const order = guild.preset === "order";
  const title = order ? "Solicita el ingreso en la Orden" : `Solicita unirte a ${guild.name}`;
  const eyebrow = order ? "Postulantado" : "Reclutamiento";
  const invite = !guild.publishedAt && validDraftInvite(guild, sp.invite) ? String(sp.invite) : null;
  const applyPath = invite ? `/apply?invite=${encodeURIComponent(invite)}` : "/apply";

  if (!guild.publishedAt && !invite && !can(viewer.actor, "member.area")) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={title} eyebrow={eyebrow} />
        <Panel>
          <p className="leading-relaxed" data-testid="apply-draft">
            {guild.name} todavía se está preparando y aún no acepta solicitudes. Vuelve pronto
            {guild.discordInviteUrl ? " o, mientras tanto, pasa a saludar por Discord" : ""}.
          </p>
          {guild.discordInviteUrl && (
            <a href={guild.discordInviteUrl} className="btn btn-ghost mt-4" rel="noopener noreferrer" target="_blank">
              Únete a nuestro Discord
            </a>
          )}
        </Panel>
      </div>
    );
  }

  if (!viewer.user) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={title} eyebrow={eyebrow} />
        <Panel>
          <p className="mb-4 leading-relaxed">
            {order && "La Order of Saint Michael es una hermandad católica, abierta a cualquier jugador que respete la fe. "}
            Inicia sesión con Discord para empezar tu solicitud. Usamos tu cuenta de Discord para contactar contigo y
            darte los roles de la hermandad.
          </p>
          <Link
            href={`${guildHref(slug, "/login")}?callbackUrl=${encodeURIComponent(guildHref(slug, applyPath))}`}
            className="btn btn-primary w-full"
          >
            Inicia sesión con Discord para solicitar
          </Link>
        </Panel>
      </div>
    );
  }

  if (can(viewer.actor, "member.area")) {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader title={title} />
        <Panel>
          <p>
            Ya eres miembro de {order ? "la Orden" : guild.name}
            {viewer.rank ? ` (${viewer.rank.name})` : ""}.{order && " Pax tecum."}
          </p>
        </Panel>
      </div>
    );
  }

  const history = await listOwnApplications(db, viewer.actor);
  const pending = history.find((a) => a.status === "pending");
  const bnetEnabled = battlenetEnabled(blizzardConfigFromEnv());
  const bnet = bnetEnabled ? await getEligibleCharacters(db, viewer.actor) : { link: null, characters: [] };
  const applyHref = guildHref(slug, applyPath);
  const showForm = !pending && guild.recruitmentOpen;
  const confirmed =
    bnet.link && guild.verifiedAt
      ? await findConfirmedJoin(db, viewer.actor, getBlizzardClient(), { cached: true }).catch(() => null)
      : null;
  const offer = confirmed?.ok ? confirmed.offer : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader title={title} eyebrow={eyebrow}>
        {showForm && (
          <>
            Lee el{" "}
            <Link href={guildHref(slug, "/charter")} className="link">
              reglamento
            </Link>{" "}
            antes de enviar tu solicitud.
          </>
        )}
      </PageHeader>

      <BattlenetNotice status={sp.bnet} />

      {offer && (
        <Panel title="Entra como miembro">
          <ConfirmedJoinForm
            action={joinAsConfirmedMemberAction.bind(null, slug, invite)}
            character={offer.character}
            inGameGuildName={offer.inGameGuildName}
            rankName={offer.rank.name}
            charterHref={guildHref(slug, "/charter")}
            faithPledge={order}
            gameVersion={guild.gameVersion}
          />
        </Panel>
      )}

      {pending ? (
        <Panel title="Tu solicitud" actions={<StatusPill status={pending.status} />}>
          <p className="mb-4">
            <ClassName wowClass={pending.wowClass}>{fullName(pending.characterName, pending.characterSurname)}</ClassName>
            {pending.verified && <VerifiedMark className="ml-1" />} — enviada el{" "}
            {formatDate(pending.createdAt, guild.timezone)}. Un oficial la revisará y contactará contigo por Discord.
          </p>
          <ActionForm action={withdrawApplicationAction.bind(null, slug, pending.id)} confirm="¿Retirar tu solicitud?">
            <SubmitButton variant="ghost" size="sm">
              Retirar solicitud
            </SubmitButton>
            <FormMessage className="mt-2" />
          </ActionForm>
        </Panel>
      ) : !guild.recruitmentOpen ? (
        offer ? null : (
        <Panel>
          <p>El reclutamiento está cerrado ahora mismo. Vuelve pronto o escríbenos por Discord.</p>
        </Panel>
        )
      ) : (
        <Panel title={offer ? "O envía una solicitud para que la revisen" : undefined}>
          {bnetEnabled && (
            <div className="mb-5 space-y-3 border-b border-line pb-5">
              {bnet.link ? (
                <>
                  <BattlenetAccount link={bnet.link} slug={slug} returnTo={applyHref} timezone={guild.timezone} />
                  {bnet.characters.length === 0 && (
                    <EmptySnapshotNote link={bnet.link} faction={guild.faction} region={guild.region} />
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm text-muted">
                    Vincula Battle.net para elegir tu personaje, así los oficiales verán el nombre, la clase y el nivel verificados.
                    También puedes escribir tu personaje a mano abajo; los oficiales lo verán como Sin verificar.
                  </p>
                  <LinkBattlenetButton slug={slug} returnTo={applyHref} />
                </div>
              )}
            </div>
          )}
          <ApplicationForm
            action={invite ? applyWithInviteAction.bind(null, slug, invite) : applyAction.bind(null, slug)}
            characters={bnet.characters}
            showFaction={!guild.faction}
            defaultDiscord={viewer.user.name ?? ""}
            guildName={guild.name}
            faithPledge={order}
            gameVersion={guild.gameVersion}
          />
        </Panel>
      )}

      {history.filter((a) => a.status !== "pending").length > 0 && (
        <Panel title="Solicitudes anteriores">
          <ul className="divide-y divide-line text-sm">
            {history
              .filter((a) => a.status !== "pending")
              .map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <span className="flex flex-wrap items-baseline gap-x-3">
                    <span>{fullName(a.characterName, a.characterSurname)}</span>
                    <span className="text-xs text-muted">Enviada el {formatDate(a.createdAt, guild.timezone)}</span>
                  </span>
                  <StatusPill status={a.status} />
                </li>
              ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
