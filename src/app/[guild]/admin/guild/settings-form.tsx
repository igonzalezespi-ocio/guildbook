import { ActionForm, Field, FieldError, FormMessage, SubmitButton } from "@/components/action-form";
import { FactionChoice } from "@/components/faction-choice";
import { GameVersionBadge } from "@/components/game-version";
import { RealmSelect } from "@/components/realm-select";
import { RegionChoice } from "@/components/region";
import { RulesetChoice } from "@/components/ruleset";
import { TimezoneSelect } from "@/components/timezone-select";
import type { Faction, Region, Ruleset } from "@/lib/game";
import { type GuildVersion, VERSION_INFO } from "@/lib/game-versions";
import type { ActionResult } from "@/server/action-types";

/** Summary labels for every field `guildSettingsInput` validates. */
export const GUILD_SETTINGS_LABELS = {
  name: "Nombre",
  motto: "Lema",
  description: "Descripción de la portada",
  timezone: "Zona horaria del servidor",
  region: "Región",
  realmSlug: "Reino",
  faction: "Facción",
  ruleset: "Tipo de reino",
  discordInviteUrl: "Enlace de invitación de Discord",
  recruitmentOpen: "Reclutamiento",
  directoryListed: "Aparecer en el directorio",
  lootPublic: "Visibilidad del registro de botín",
} as const;

export interface GuildSettingsValues {
  name: string;
  motto: string | null;
  description: string;
  timezone: string;
  gameVersion: GuildVersion;
  realmSlug: string | null;
  region: Region;
  faction: Faction;
  ruleset: Ruleset;
  discordInviteUrl: string | null;
  recruitmentOpen: boolean;
  directoryListed: boolean;
  lootPublic: boolean;
  verifiedAt: Date | null;
}

export function GuildSettingsForm({
  action,
  guild,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  guild: GuildSettingsValues;
}) {
  const realms = VERSION_INFO[guild.gameVersion].realms;
  const verified = Boolean(guild.verifiedAt);
  return (
    <ActionForm action={action} className="space-y-4" labels={GUILD_SETTINGS_LABELS}>
      <Field label="Nombre" name="name">
        <input id="name" name="name" className="field" defaultValue={guild.name} required />
      </Field>
      <Field label="Lema" name="motto">
        <input id="motto" name="motto" className="field" defaultValue={guild.motto ?? ""} />
      </Field>
      <Field label="Descripción de la portada" name="description">
        <textarea id="description" name="description" className="field" defaultValue={guild.description} />
      </Field>
      <Field label="Zona horaria del servidor" name="timezone" hint="Los horarios de banda y las fechas del botín se muestran en esta zona horaria.">
        <TimezoneSelect defaultValue={guild.timezone} required />
      </Field>
      <div>
        <p className="field-label">Versión del juego</p>
        <p className="flex items-center gap-2 text-sm text-bone" data-testid="settings-game-version">
          <GameVersionBadge version={guild.gameVersion} always />
          {VERSION_INFO[guild.gameVersion].label}
        </p>
        <p className="mt-1 text-xs text-muted">La versión del juego de una hermandad no se puede cambiar.</p>
      </div>
      {realms ? (
        <div>
          <label htmlFor="realmSlug" className="field-label">
            Reino
          </label>
          <input type="hidden" name="region" value={guild.region} />
          <RealmSelect version={guild.gameVersion} defaultValue={guild.realmSlug ?? ""} disabled={verified} />
          <p className="mt-1 text-xs text-muted">
            {verified
              ? "Tu hermandad está verificada, así que su reino no puede cambiar. Si cambias su nombre o su facción, pierde la verificación hasta que vuelvas a verificarla."
              : "El nombre, el reino y la facción identifican tu hermandad en Guildbook y deben coincidir con los de la hermandad del juego. El reino fija la región y el tipo de reino."}
          </p>
          <FieldError name="realmSlug" />
          <FieldError name="region" />
        </div>
      ) : (
        <fieldset>
          <legend className="field-label">Región</legend>
          <RegionChoice defaultValue={guild.region} />
          <FieldError name="region" />
        </fieldset>
      )}
      <fieldset>
        <legend className="field-label">Facción</legend>
        <FactionChoice defaultValue={guild.faction} />
        <FieldError name="faction" />
      </fieldset>
      {!realms && (
        <fieldset>
          <legend className="field-label">Tipo de reino</legend>
          <RulesetChoice defaultValue={guild.ruleset} />
          <p className="mt-1 text-xs text-muted">
            {verified
              ? "Tu hermandad está verificada. Si cambias su nombre, región, facción o tipo de reino, pierde la verificación hasta que vuelvas a verificarla."
              : "El nombre, la región, la facción y el tipo de reino identifican tu hermandad en Guildbook y deben coincidir con los de la hermandad del juego para verificarla."}
          </p>
          <FieldError name="ruleset" />
        </fieldset>
      )}
      <Field label="Enlace de invitación de Discord" name="discordInviteUrl" hint="Se muestra en el pie del sitio, p. ej. https://discord.gg/tucodigo">
        <input
          id="discordInviteUrl"
          name="discordInviteUrl"
          type="url"
          className="field"
          defaultValue={guild.discordInviteUrl ?? ""}
          placeholder="https://discord.gg/"
        />
      </Field>
      <div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="recruitmentOpen" defaultChecked={guild.recruitmentOpen} className="h-5 w-5 accent-crimson" />
          Reclutamiento abierto
        </label>
        <FieldError name="recruitmentOpen" />
      </div>
      <div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="directoryListed" defaultChecked={guild.directoryListed} className="h-5 w-5 accent-crimson" />
          Mostrar esta hermandad en el directorio público de Guildbook
        </label>
        <FieldError name="directoryListed" />
      </div>
      <div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="lootPublic" defaultChecked={guild.lootPublic} className="h-5 w-5 accent-crimson" />
          Mostrar el registro de botín a los visitantes (los miembros siempre lo ven)
        </label>
        <FieldError name="lootPublic" />
      </div>
      <FormMessage />
      <SubmitButton>Guardar</SubmitButton>
    </ActionForm>
  );
}
