import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { Listbox } from "@/components/listbox";
import { Panel, Tag } from "@/components/ui";
import { db } from "@/db";
import { TIER_LABELS } from "@/lib/authz/tiers";
import type { Guild } from "@/server/context";
import { updateConfirmedJoinSettingsAction } from "@/server/actions/admin";
import { CONFIRMED_JOIN_TIERS } from "@/server/services/confirmed-members";
import { listRanks } from "@/server/services/ranks";

/** Whether members Battle.net confirms in the in-game guild join without review, and at which rank. */
export async function ConfirmedJoinPanel({ guild }: { guild: Guild }) {
  const ranks = await listRanks(db, guild.id);
  const accept = ranks.find((r) => r.id === guild.acceptRankId);
  const choices = ranks.filter((r) => CONFIRMED_JOIN_TIERS.includes(r.tier));
  const options = [
    {
      value: "",
      label: accept ? `Igual que los aspirantes aceptados (${accept.name})` : "Igual que los aspirantes aceptados",
      description: "Sigue el rango elegido en Rangos",
    },
    ...choices.map((r) => ({ value: r.id, label: r.name, description: TIER_LABELS[r.tier] })),
  ];

  return (
    <Panel title="Miembros confirmados en el juego" actions={guild.verifiedAt ? undefined : <Tag>Requiere verificación</Tag>}>
      <ActionForm action={updateConfirmedJoinSettingsAction.bind(null, guild.slug)} className="space-y-4 text-sm">
        <p className="leading-relaxed text-muted">
          Cuando alguien con una cuenta de Battle.net vinculada abre tu página de solicitud y Battle.net muestra uno de sus
          personajes en tu hermandad del juego, puede unirse con un clic tras aceptar el reglamento. Los administradores
          reciben un aviso por cada entrada.
          {!guild.verifiedAt && " Esto solo se aplica cuando la hermandad está verificada."}
        </p>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="autoApproveInGuild"
            defaultChecked={guild.autoApproveInGuild}
            className="mt-0.5 h-5 w-5 accent-crimson"
            data-testid="auto-approve-toggle"
          />
          <span>Dejar que los miembros confirmados en el juego entren sin revisar su solicitud</span>
        </label>
        <Field label="Rango con el que entran" name="autoApproveRankId">
          <Listbox id="autoApproveRankId" name="autoApproveRankId" options={options} defaultValue={guild.autoApproveRankId ?? ""} />
        </Field>
        <FormMessage />
        <SubmitButton variant="ghost">Guardar</SubmitButton>
      </ActionForm>
    </Panel>
  );
}
