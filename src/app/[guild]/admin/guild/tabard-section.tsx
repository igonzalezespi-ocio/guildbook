import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { Crest } from "@/components/crest";
import { TabardBuilder } from "@/components/tabard-builder";
import { Panel, Tag } from "@/components/ui";
import { brandFile, guildBrand } from "@/lib/brand";
import { tabardKey } from "@/lib/tabard/config";
import { guildLook, isOrderLook } from "@/lib/tabard/look";
import type { SelectableBase } from "@/lib/tabard/theme";
import { importInGameTabardAction, updateGuildTabardAction } from "@/server/actions/tabard";
import { battlenetEnabled, blizzardConfigFromEnv } from "@/server/blizzard";
import type { Guild } from "@/server/context";
import { isPreLaunch, verificationSupported } from "@/server/services/guild-verification";
import { type GuildVersion, VERSION_INFO } from "@/lib/game-versions";

const ORDER_SIZES = [16, 32, 44, 80, 128, 176];

function DiscordIconLink({ href }: { href: string }) {
  return (
    <a href={href} download className="btn btn-ghost btn-sm" data-testid="discord-icon-download">
      Descargar icono para Discord (PNG de 512 px)
    </a>
  );
}

/** Copies the crest from the guild's in-game profile. Before launch there are no Forever guilds to read. */
function ImportTabard({ slug, gameVersion }: { slug: string; gameVersion: GuildVersion }) {
  const supported = verificationSupported(gameVersion);
  const enabled = supported && battlenetEnabled(blizzardConfigFromEnv());
  const preLaunch = isPreLaunch(new Date(), gameVersion);
  return (
    <ActionForm action={importInGameTabardAction.bind(null, slug)} className="mb-6 rounded border border-line bg-ink/40 p-4" toast={false}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="max-w-prose">
          <h3 className="font-display text-sm tracking-wide text-bone">Importa tu tabardo del juego</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted" data-testid="tabard-import-note">
            {!supported
              ? `La importación desde ${VERSION_INFO[gameVersion].label} llegará pronto. De momento, diseña tu tabardo abajo.`
              : !enabled
              ? "Battle.net no está conectado en este sitio, así que no se puede leer el tabardo del juego. Diséñalo abajo."
              : preLaunch
                ? "La importación se abre cuando existan personajes de WoW: Forever. Hasta el lanzamiento, diseña tu tabardo abajo; después, con un clic se copian el emblema y los colores de tu hermandad del juego."
                : "Copia el emblema y los colores de tu hermandad del juego usando el personaje de Battle.net vinculado del maestro de la hermandad. Después puedes seguir ajustándolo."}
          </p>
        </div>
        {enabled && (
          <SubmitButton variant="ghost" size="sm" pendingLabel="Importando...">
            Importar del juego
          </SubmitButton>
        )}
      </div>
      <FormMessage className="mt-3" />
    </ActionForm>
  );
}

// TODO: a banner image for the home hero. The project has no file storage yet (no Vercel Blob or similar); add
// the upload here once it does.

/** Guild settings: the in-game tabard (crest and icons) and the site theme it drives. */
export function TabardSection({ guild }: { guild: Guild }) {
  const brand = guildBrand(guild);
  const discordHref = isOrderLook(guild) ? "/brand/discord-icon.png" : `${brandFile(brand, "discord-icon.png")}&download`;

  if (isOrderLook(guild)) {
    return (
      <Panel title="Tabardo y tema" actions={<Tag>Bloqueado</Tag>}>
        <div className="space-y-4 text-sm">
          <p className="leading-relaxed text-muted">
            La Order of Saint Michael conserva su escudo dibujado a mano (un estandarte carmesí, borde dorado y cruz patada blanca) y
            su propio tema carmesí y dorado. Están bloqueados y son exclusivos de la Orden, así que aquí no hay nada que cambiar.
          </p>
          <div className="flex flex-wrap items-end gap-4 rounded border border-line bg-ink/40 p-3">
            {ORDER_SIZES.map((px) => (
              <span key={px} className="inline-flex" style={{ width: px, height: px * 1.2 }}>
                <Crest className="h-full w-full" />
              </span>
            ))}
          </div>
          <DiscordIconLink href={discordHref} />
        </div>
      </Panel>
    );
  }

  const look = guildLook(guild);
  return (
    <Panel title="Tabardo y tema" actions={<DiscordIconLink href={discordHref} />}>
      <p className="mb-5 text-sm leading-relaxed text-muted">
        Recrea el tabardo de tu hermandad con los mismos emblemas y colores que en el juego, sobre un estandarte de Guildbook. Su color de fondo pasa a ser el acento principal del sitio, el color del borde
        su ribete (títulos, separadores, bordes de paneles) y el color del emblema sus realces. Al guardar también se regeneran el
        favicon, los iconos de la app, la vista previa de enlaces y el icono de Discord.
      </p>
      <ImportTabard slug={guild.slug} gameVersion={guild.gameVersion} />
      <TabardBuilder
        key={tabardKey(look.tabard)}
        action={updateGuildTabardAction.bind(null, guild.slug)}
        initial={{ tabard: look.tabard, base: look.base as SelectableBase, overrides: look.overrides }}
        guild={{ name: guild.name, motto: guild.motto }}
      />
    </Panel>
  );
}
