"use client";

import Link from "next/link";
import { ActionForm, Field, FormMessage, SubmitButton } from "@/components/action-form";
import { ClassSpecFields } from "@/components/class-spec-fields";
import type { BattlenetCharacterSnapshot } from "@/db/schema";
import { CLASS_INFO } from "@/lib/game";
import { type GuildVersion, hasSurnames } from "@/lib/game-versions";
import type { ActionResult } from "@/server/action-types";

/**
 * One-click join for a member Battle.net confirms in the in-game guild. The character comes from Battle.net; the
 * member picks spec and role, enters a surname Battle.net doesn't provide, and accepts the charter.
 */
export function ConfirmedJoinForm({
  action,
  character,
  inGameGuildName,
  rankName,
  charterHref,
  faithPledge,
  gameVersion,
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  character: BattlenetCharacterSnapshot;
  inGameGuildName: string;
  rankName: string;
  charterHref: string;
  faithPledge: boolean;
  gameVersion: GuildVersion;
}) {
  const askSurname = hasSurnames(gameVersion) && !character.surname;
  return (
    <div data-testid="confirmed-join">
    <ActionForm action={action} className="space-y-5">
      <input type="hidden" name="bnetCharacterId" value={character.id} />
      <p className="leading-relaxed">
        Battle.net muestra a{" "}
        <span className="font-semibold" style={{ color: CLASS_INFO[character.wowClass].color }}>
          {character.name}
        </span>{" "}
        en &lt;{inGameGuildName}&gt; en {character.realmName}, así que puedes entrar como {rankName} sin esperar a que un
        oficial revise una solicitud.
      </p>
      <p className="text-xs text-muted">
        {CLASS_INFO[character.wowClass].label} {character.race} de nivel {character.level}
      </p>
      {askSurname && (
        <Field label="Apellido" name="surname" htmlFor="confirmed-join-surname" hint="Battle.net aún no facilita apellidos, así que escribe el tuyo.">
          <input id="confirmed-join-surname" name="surname" className="field" required maxLength={12} autoComplete="off" />
        </Field>
      )}
      <ClassSpecFields lockedClass={character.wowClass} showFaction={false} idPrefix="confirmed-join-" />
      <div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="respectsFaith" className="mt-1 h-5 w-5 accent-crimson" required data-testid="confirmed-join-charter" />
          <span>
            He leído el{" "}
            <Link href={charterHref} className="link" target="_blank">
              Reglamento
            </Link>
            {faithPledge
              ? ". Respetaré la fe católica de la Orden y cumpliré su norma de chat limpio."
              : " y lo cumpliré."}
          </span>
        </label>
      </div>
      <FormMessage />
      <SubmitButton pendingLabel="Entrando…">Entrar como miembro</SubmitButton>
    </ActionForm>
    </div>
  );
}
