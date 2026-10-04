"use client";

import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { ActionForm, Field, FieldError, FormMessage, SubmitButton, useActionResult } from "@/components/action-form";
import { ClassSpecFields } from "@/components/class-spec-fields";
import type { BattlenetCharacterSnapshot } from "@/db/schema";
import { CLASS_INFO, raceLabel } from "@/lib/game";
import { type GuildVersion, hasSurnames, maxLevelFor } from "@/lib/game-versions";
import { scrollIntoViewGently, scrollToTop } from "@/lib/scroll";
import type { ActionResult } from "@/server/action-types";

/** Rejections without field errors scroll to the message; `ActionForm` focuses the first invalid field otherwise. */
function ScrollToFirstError() {
  const result = useActionResult();
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!result || result.ok) return;
    if (Object.values(result.fieldErrors ?? {}).some((e) => e?.length)) return;
    const target = anchor.current?.closest("form")?.querySelector('[role="alert"]');
    if (target) scrollIntoViewGently(target);
    else scrollToTop();
  }, [result]);

  return <span ref={anchor} hidden />;
}

/**
 * With Battle.net characters the applicant picks one; name, level and class are then shown read-only
 * (the server takes them from the snapshot) while surname, spec and role stay editable. Manual entry remains
 * available and is marked Unverified for officers.
 */
export function ApplicationForm({
  action,
  characters,
  showFaction,
  defaultDiscord,
  guildName,
  faithPledge,
  gameVersion = "forever",
}: {
  action: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  characters: BattlenetCharacterSnapshot[];
  showFaction: boolean;
  defaultDiscord: string;
  guildName: string;
  /** The Order asks applicants to respect its Catholic faith; other guilds only ask them to keep the charter. */
  faithPledge: boolean;
  /** The guild's game version: level cap, and whether characters have surnames. */
  gameVersion?: GuildVersion;
}) {
  const maxLevel = maxLevelFor(gameVersion);
  const surnames = hasSurnames(gameVersion);
  const [manual, setManual] = useState(characters.length === 0);
  const [selectedId, setSelectedId] = useState(characters[0]?.id ?? "");
  const selected = manual ? undefined : characters.find((c) => c.id === selectedId);

  // On success the page re-renders with the Pending card at the top and this form unmounts, so scroll from here.
  const submit = async (prev: ActionResult | null, fd: FormData) => {
    const result = await action(prev, fd);
    if (result.ok) scrollToTop();
    return result;
  };

  return (
    <ActionForm action={submit} className="space-y-5">
      <ScrollToFirstError />
      {selected ? (
        <>
          <fieldset>
            <legend className="field-label">Elige tu personaje</legend>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {characters.map((c) => (
                <label
                  key={c.id}
                  className={clsx(
                    "flex cursor-pointer items-start gap-3 rounded border px-3 py-2 transition-colors",
                    c.id === selectedId ? "border-gold bg-ink-3" : "border-line hover:border-gold-dim",
                  )}
                >
                  <input
                    type="radio"
                    name="bnetCharacterId"
                    value={c.id}
                    checked={c.id === selectedId}
                    onChange={() => setSelectedId(c.id)}
                    className="mt-1 h-4 w-4 accent-crimson"
                  />
                  <span className="min-w-0 leading-tight">
                    <span className="block font-semibold" style={{ color: CLASS_INFO[c.wowClass].color }}>
                      {c.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {CLASS_INFO[c.wowClass].label} {raceLabel(c.race)} de nivel {c.level}
                    </span>
                    {c.guildName && <span className="block truncate text-xs text-gold-dim">&lt;{c.guildName}&gt;</span>}
                  </span>
                </label>
              ))}
            </div>
            <FieldError name="bnetCharacterId" />
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" name="characterName">
              <input id="characterName" className="field cursor-default opacity-90" value={selected.name} readOnly />
            </Field>
            {surnames && (
              <Field
                label="Apellido"
                name="characterSurname"
                hint={selected.surname ? undefined : "Battle.net aún no facilita apellidos, así que escribe el tuyo."}
              >
                <input
                  key={selected.id}
                  id="characterSurname"
                  name="characterSurname"
                  className="field"
                  required
                  maxLength={12}
                  autoComplete="off"
                  defaultValue={selected.surname ?? ""}
                  readOnly={Boolean(selected.surname)}
                />
              </Field>
            )}
            <Field label="Nivel" name="level">
              <input id="level" className="field cursor-default opacity-90" value={selected.level} readOnly />
            </Field>
          </div>
          <ClassSpecFields key={selected.id} lockedClass={selected.wowClass} showFaction={false} />
          <p className="text-xs text-muted">
            El nombre, el nivel y la clase vienen de Battle.net.{" "}
            <button type="button" className="link" onClick={() => setManual(true)}>
              Mi personaje no aparece
            </button>
          </p>
        </>
      ) : (
        <>
          {characters.length > 0 && (
            <p className="text-xs text-muted">
              Los personajes añadidos a mano aparecen como «Sin verificar» para los oficiales.{" "}
              <button type="button" className="link" onClick={() => setManual(false)}>
                Elegir un personaje de Battle.net
              </button>
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre" name="characterName">
              <input id="characterName" name="characterName" className="field" required maxLength={12} autoComplete="off" />
            </Field>
            {surnames && (
              <Field label="Apellido" name="characterSurname">
                <input id="characterSurname" name="characterSurname" className="field" required maxLength={12} autoComplete="off" />
              </Field>
            )}
          </div>
          <ClassSpecFields showFaction={showFaction} />
          <Field label="Nivel" name="level">
            <input id="level" name="level" type="number" min={1} max={maxLevel} defaultValue={maxLevel} className="field" required />
          </Field>
        </>
      )}

      <Field label="Experiencia en bandas" name="raidExperience" hint="¿Qué bandas has completado, en qué época y con qué rol?">
        <textarea id="raidExperience" name="raidExperience" className="field" required />
      </Field>
      <Field label="Disponibilidad" name="availability" hint="¿Qué noches y horas puedes ir de banda? Indica tu zona horaria.">
        <textarea id="availability" name="availability" className="field" required />
      </Field>
      <Field label={`¿Por qué ${guildName}?`} name="whyThisGuild">
        <textarea id="whyThisGuild" name="whyThisGuild" className="field" required />
      </Field>
      <Field label="Usuario de Discord" name="discordHandle">
        <input id="discordHandle" name="discordHandle" className="field" required defaultValue={defaultDiscord} />
      </Field>
      <div>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="respectsFaith" className="mt-1 h-5 w-5 accent-crimson" required />
          <span>
            {faithPledge
              ? "He leído el Reglamento. Respetaré la fe católica de la Orden y cumpliré su norma de chat limpio."
              : "He leído el Reglamento y lo cumpliré."}
          </span>
        </label>
      </div>
      <FormMessage />
      <SubmitButton pendingLabel="Enviando…">Enviar solicitud</SubmitButton>
    </ActionForm>
  );
}
