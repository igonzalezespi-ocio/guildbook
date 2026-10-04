import Link from "next/link";
import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { Panel, Tag } from "@/components/ui";
import { VerifiedSeal } from "@/components/verified-seal";
import { db } from "@/db";
import { formatDate } from "@/lib/format";
import { FACTION_LABELS, REGION_LABELS, RULESET_INFO } from "@/lib/game";
import { realmLabel, VERSION_INFO } from "@/lib/game-versions";
import { VERIFICATION_GRACE_DAYS } from "@/lib/guild-identity";
import { guildHref } from "@/lib/paths";
import { claimGuildNameAction, claimGuildSlugAction, promoteGuildMasterAction, verifyGuildAction } from "@/server/actions/verification";
import { battlenetEnabled, blizzardConfigFromEnv } from "@/server/blizzard";
import type { Guild } from "@/server/context";
import { getRequestHost, guildOrigin } from "@/server/hosts";
import { getSlugClaim, guildMasterHandover, isPreLaunch, verificationSupported } from "@/server/services/guild-verification";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Guild Settings: explains verification, runs the check on demand, and offers name and subdomain claims. */
export async function VerifyGuildPanel({ guild }: { guild: Guild }) {
  if (!verificationSupported(guild.gameVersion)) {
    return (
      <Panel title="Verificar hermandad" actions={<Tag>Próximamente</Tag>}>
        <div className="space-y-2 text-sm" data-testid="verify-guild">
          <p className="rounded border border-gold-dim/60 bg-gold/5 px-3 py-2 text-bone" data-testid="verify-coming-soon">
            La verificación con Battle.net para hermandades de {VERSION_INFO[guild.gameVersion].label} llegará pronto. Mientras tanto tu
            hermandad funciona con normalidad, sin el sello de verificada.
          </p>
        </div>
      </Panel>
    );
  }
  const [slugClaim, current, handover] = await Promise.all([getSlugClaim(db, guild), getRequestHost(), guildMasterHandover(db, guild)]);
  const founderNotGm = !guild.verifiedAt ? guild.setup.founderNotGm : undefined;
  const enabled = battlenetEnabled(blizzardConfigFromEnv());
  const verified = Boolean(guild.verifiedAt);
  const result = guild.verificationResult;
  const preLaunch = isPreLaunch(new Date(), guild.gameVersion);
  const versionLabel = VERSION_INFO[guild.gameVersion].label;
  const where = guild.realmSlug
    ? `en ${realmLabel(guild.gameVersion, guild.realmSlug, guild.region)}`
    : `en el tipo de reino ${RULESET_INFO[guild.ruleset].label} de la región de ${REGION_LABELS[guild.region]}`;
  const claim = !verified && result?.claim ? result.claim : null;
  const lapseOn = guild.verificationFailingSince
    ? new Date(guild.verificationFailingSince.getTime() + VERIFICATION_GRACE_DAYS * DAY_MS)
    : null;
  const claimHost = slugClaim ? guildOrigin(slugClaim.slug, current).replace(/^https?:\/\//, "") : null;

  return (
    <Panel
      title="Verificar hermandad"
      actions={verified ? <VerifiedSeal label size={14} /> : <Tag>Sin verificar</Tag>}
    >
      <div className="space-y-4 text-sm" data-testid="verify-guild">
        <p className="leading-relaxed text-muted">
          Las hermandades verificadas muestran un sello en todo Guildbook y salen primero en el directorio. Para verificar, el maestro de la
          hermandad vincula Battle.net en{" "}
          <Link href={guildHref(guild.slug, "/members/characters")} className="link">
            Mis personajes
          </Link>
          . Uno de sus personajes de {versionLabel} debe ser maestro de la hermandad (rango 0) de una hermandad del juego llamada exactamente{" "}
          <strong className="text-bone">{guild.name}</strong>, de la {FACTION_LABELS[guild.faction]}, {where}. Guildbook lo vuelve a
          comprobar cada día; tras {VERIFICATION_GRACE_DAYS} días de comprobaciones fallidas, se retira el sello.
        </p>
        {!verified && founderNotGm && (
          <p className="rounded border border-gold-dim/60 bg-gold/5 px-3 py-2 text-bone" data-testid="verify-founder-not-gm">
            {founderNotGm.characterName} está en {guild.name} en el juego
            {founderNotGm.rank != null ? ` (rango ${founderNotGm.rank})` : ""} pero no es su maestro de la hermandad, así que verifica el
            maestro de la hermandad. Envíale el enlace de invitación de la{" "}
            <Link href={guildHref(guild.slug, "/admin/setup")} className="link">
              lista de configuración
            </Link>
            y, cuando se haya unido, dale un rango de administrador en Miembros.
          </p>
        )}
        {!verified && !founderNotGm && (
          <p className="leading-relaxed text-muted" data-testid="verify-not-gm">
            ¿No eres el maestro de la hermandad en el juego? La hermandad funciona del todo sin el sello. Envía al maestro de la hermandad el
            enlace de invitación de la lista de configuración; cuando se haya unido, dale un rango de administrador en Miembros para que
            pueda vincular Battle.net y comprobarlo desde aquí.
          </p>
        )}

        {!verified && preLaunch && (
          <p className="rounded border border-gold-dim/60 bg-gold/5 px-3 py-2 text-bone" data-testid="verify-prelaunch">
            La verificación se abre cuando haya personajes de WoW: Forever disponibles. Forever sale el 4 de noviembre de 2026 y Blizzard
            no publica personajes de Forever antes de esa fecha.
          </p>
        )}
        {!enabled && <p className="text-muted italic">Battle.net aún no está configurado en este sitio.</p>}

        {verified && guild.verifiedAt && (
          <p className="text-bone">
            Verificada el {formatDate(guild.verifiedAt, guild.timezone)}
            {guild.verifiedCharacterName && <>: {guild.verifiedCharacterName} es el maestro de la hermandad en el juego</>}.
          </p>
        )}
        {verified && lapseOn && (
          <p className="text-red-300" data-testid="verify-grace">
            Las últimas comprobaciones han fallado. Si ninguna sale bien, el sello se retira el {formatDate(lapseOn, guild.timezone)}.
          </p>
        )}
        {result && (!verified || !result.verified) && (
          <div className="rounded border border-line px-3 py-2" data-testid="verify-result">
            <p className={result.verified ? "text-emerald-300" : "text-bone"}>{result.message}</p>
            {guild.verificationCheckedAt && (
              <p className="mt-1 text-xs text-muted">Comprobado el {formatDate(guild.verificationCheckedAt, guild.timezone)}</p>
            )}
          </div>
        )}

        <ActionForm action={verifyGuildAction.bind(null, guild.slug)}>
          <SubmitButton variant="ghost" size="sm" pendingLabel="Comprobando…">
            {verified ? "Volver a comprobar" : "Comprobar verificación"}
          </SubmitButton>
          <FormMessage className="mt-2" />
        </ActionForm>

        {handover && (
          <div className="space-y-2 border-t border-line pt-4" data-testid="guild-master-handover">
            <h3 className="font-display text-sm tracking-wide text-gold">Ceder el rango más alto</h3>
            <p className="text-muted">
              {handover.characterName ?? "El maestro de la hermandad verificado"} verificó la hermandad pero no tiene su rango más alto,{" "}
              {handover.topRank.name}. Dáselo para que el sitio coincida con el juego. Tu propio rango no cambia; después puedes
              bajarte de rango en Miembros.
            </p>
            <ActionForm
              action={promoteGuildMasterAction.bind(null, guild.slug)}
              confirm={`¿Dar el rango ${handover.topRank.name} a ${handover.characterName ?? "el maestro de la hermandad"}?`}
            >
              <SubmitButton size="sm" variant="ghost" pendingLabel="Cediendo...">
                Darle {handover.topRank.name}
              </SubmitButton>
              <FormMessage className="mt-2" />
            </ActionForm>
          </div>
        )}

        {claim && (
          <div className="space-y-2 border-t border-line pt-4" data-testid="claim-name">
            <h3 className="font-display text-sm tracking-wide text-gold">Tu hermandad del juego es {claim.name}</h3>
            {claim.holderVerified ? (
              <p className="text-muted">
                Una hermandad verificada de Guildbook ya usa ese nombre, región, facción y tipo de reino, así que no se puede reclamar.{" "}
                <a href={`${current.apexOrigin}/support?category=battlenet`} className="text-gold underline-offset-2 hover:underline">
                  Contacta con el soporte de Guildbook
                </a>{" "}
                si crees que es un error.
              </p>
            ) : (
              <>
                <p className="text-muted">
                  {claim.holderName
                    ? `Una hermandad sin verificar, ${claim.holderName}, tiene ese nombre en Guildbook. Como maestro de la hermandad en el juego puedes reclamarlo: tu hermandad pasa a llamarse ${claim.name} y queda verificada, y la otra pasa a llamarse «${claim.name} (sin verificar)» con un aviso a sus administradores. Los subdominios y dominios propios no se mueven.`
                    : `Ninguna otra hermandad usa ese nombre. Cógelo para llamar a tu hermandad ${claim.name} y verificarla.`}
                </p>
                <ActionForm
                  action={claimGuildNameAction.bind(null, guild.slug)}
                  confirm={
                    claim.holderName
                      ? `¿Reclamar el nombre ${claim.name}? ${claim.holderName} cambiará de nombre.`
                      : `¿Llamar a tu hermandad ${claim.name} y verificarla?`
                  }
                >
                  <SubmitButton size="sm" pendingLabel="Reclamando…">
                    {claim.holderName ? `Reclamar ${claim.name}` : `Coger el nombre ${claim.name}`}
                  </SubmitButton>
                  <FormMessage className="mt-2" />
                </ActionForm>
              </>
            )}
          </div>
        )}

        {slugClaim && claimHost && (
          <div className="space-y-2 border-t border-line pt-4" data-testid="claim-slug">
            <h3 className="font-display text-sm tracking-wide text-gold">Subdominio</h3>
            <p className="text-muted">
              {slugClaim.holderName
                ? `${claimHost} coincide con el nombre de tu hermandad y lo tiene una hermandad sin verificar, ${slugClaim.holderName}. Como hermandad verificada puedes reclamarlo: esa hermandad pasa a ${slugClaim.holderMovesTo ?? "otro subdominio"} y se explica el motivo a sus administradores.`
                : `${claimHost} coincide con el nombre de tu hermandad y está libre.`}{" "}
              Tu subdominio actual se libera y no redirigirá, así que actualiza los enlaces que hayas compartido (y vuelve a emparejar las
              apps de Vigil). Los dominios propios siguen funcionando.
            </p>
            <ActionForm
              action={claimGuildSlugAction.bind(null, guild.slug)}
              confirm={`¿Mover tu hermandad a ${claimHost}? Tu subdominio actual dejará de funcionar.`}
            >
              <SubmitButton size="sm" variant="ghost" pendingLabel="Moviendo…">
                Mover a {claimHost}
              </SubmitButton>
              <FormMessage className="mt-2" />
            </ActionForm>
          </div>
        )}
      </div>
    </Panel>
  );
}
