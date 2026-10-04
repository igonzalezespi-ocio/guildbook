"use client";

import { useEffect, useState } from "react";
import { ActionForm, Field, FieldError, FormMessage, SubmitButton, useActionResult } from "@/components/action-form";
import { FactionChoice } from "@/components/faction-choice";
import { GameVersionIcon } from "@/components/game-version";
import { Listbox, type ListboxOption } from "@/components/listbox";
import { PresetChoices } from "@/components/rank-preset-choices";
import { RealmSelect } from "@/components/realm-select";
import { RegionChoice } from "@/components/region";
import { RulesetChoice } from "@/components/ruleset";
import { TimezoneSelect } from "@/components/timezone-select";
import { type Region } from "@/lib/game";
import { DEFAULT_GUILD_VERSION, type SupportedGuildVersion, SUPPORTED_GUILD_VERSIONS, VERSION_INFO } from "@/lib/game-versions";
import { SLUG_MAX, slugProblem, suggestSlug } from "@/lib/hosts";
import { DEFAULT_RANK_PRESET } from "@/lib/rank-presets";
import { checkSlugAction, createGuildAction } from "@/server/actions/platform";

const PROBLEM_TEXT = {
  length: "Usa entre 3 y 30 caracteres",
  characters: "Minúsculas, números y guiones sueltos",
  reserved: "Ese nombre está reservado",
} as const;

type Availability =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken"; reason: string; suggestions: string[] };

const VERSION_DESCRIPTIONS: Record<SupportedGuildVersion, string> = {
  forever: "Sale el 4 de noviembre de 2026. Sin reinos: tu hermandad vive en un tipo de reino.",
  anniversary: "The Burning Crusade en los reinos Anniversary.",
};

const VERSION_OPTIONS: ListboxOption[] = SUPPORTED_GUILD_VERSIONS.map((v) => ({
  value: v,
  label: VERSION_INFO[v].label,
  description: VERSION_DESCRIPTIONS[v],
  icon: <GameVersionIcon version={v} size={15} className="text-gold-dim" />,
}));

/** Summary labels for every field `createGuildInput` validates. */
export const CREATE_GUILD_LABELS = {
  gameVersion: "Versión del juego",
  realmSlug: "Reino",
  name: "Nombre de la hermandad",
  slug: "Subdominio",
  region: "Región",
  faction: "Facción",
  ruleset: "Tipo de reino",
  timezone: "Zona horaria",
  motto: "Lema",
  directoryListed: "Aparecer en el directorio",
  rankPreset: "Rangos iniciales",
} as const;

/** The server's subdomain error, until the subdomain is edited. */
function SlugError({ slug }: { slug: string }) {
  const result = useActionResult();
  const [rejected, setRejected] = useState<string | null>(null);
  useEffect(() => {
    // Remember which subdomain the server rejected; only a new result can change it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRejected(result && !result.ok && result.fieldErrors?.slug ? slug : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);
  return <FieldError name="slug" stale={rejected !== null && rejected !== slug} />;
}

/** The live availability line; blank while the server's inline error already says the same thing. */
function SlugStatus({ status }: { status: { tone: string; text: string } | null }) {
  const result = useActionResult();
  const serverError = result && !result.ok ? result.fieldErrors?.slug?.[0] : undefined;
  const text = status && status.text !== serverError ? status.text : null;
  return (
    <p id="slug-status" className={`mt-1 min-h-4 text-xs ${status?.tone ?? ""}`} role="status" data-testid="slug-status">
      {text}
    </p>
  );
}

/** Free subdomains to pick from: the live check's, or the server's after a rejected submit. */
function SlugSuggestions({ live, onPick }: { live: string[]; onPick: (slug: string) => void }) {
  const result = useActionResult();
  const fromServer = result && !result.ok ? (result.suggestions?.slug ?? []) : [];
  const suggestions = live.length > 0 ? live : fromServer;
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs" data-testid="slug-suggestions">
      <span className="text-muted">Prueba</span>
      {suggestions.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onPick(s)}
          className="rounded border border-line px-2 py-0.5 font-mono text-bone hover:border-gold-dim hover:text-gold"
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function CreateGuildForm({
  hostPrefix,
  hostSuffix,
  initialVersion = DEFAULT_GUILD_VERSION,
}: {
  hostPrefix: string;
  hostSuffix: string;
  initialVersion?: SupportedGuildVersion;
}) {
  const [gameVersion, setGameVersion] = useState<SupportedGuildVersion>(initialVersion);
  const [realmSlug, setRealmSlug] = useState("");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [region, setRegion] = useState<Region>("us");
  const realms = VERSION_INFO[gameVersion].realms;
  const [faction, setFaction] = useState("");
  const [ruleset, setRuleset] = useState("");
  const [timezone, setTimezone] = useState("America/New_York");
  const [motto, setMotto] = useState("");
  const [listed, setListed] = useState(false);
  const [availability, setAvailability] = useState<Availability>({ state: "idle" });

  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!local) return;
    // Syncing with the browser's timezone, which is only known after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimezone(local);
  }, []);

  const problem = slug ? slugProblem(slug) : null;

  useEffect(() => {
    if (!slug || (problem && problem !== "reserved")) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setAvailability({ state: "checking" });
      const result = await checkSlugAction(slug, realms ? { gameVersion, realmSlug, region, faction } : { gameVersion, region, faction, ruleset });
      if (cancelled) return;
      setAvailability(
        result.available ? { state: "available" } : { state: "taken", reason: result.reason, suggestions: result.suggestions ?? [] },
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [slug, problem, gameVersion, realms, realmSlug, region, faction, ruleset]);

  const status = !slug
    ? null
    : problem
      ? { tone: "text-red-300", text: PROBLEM_TEXT[problem] }
      : availability.state === "available"
        ? { tone: "text-emerald-300", text: "Disponible" }
        : availability.state === "taken"
          ? { tone: "text-red-300", text: availability.reason }
          : { tone: "text-muted", text: "Comprobando…" };

  return (
    <ActionForm action={createGuildAction} className="space-y-5" labels={CREATE_GUILD_LABELS}>
      <div>
        <label htmlFor="gameVersion" className="field-label">
          Versión del juego
        </label>
        <Listbox
          id="gameVersion"
          name="gameVersion"
          options={VERSION_OPTIONS}
          value={gameVersion}
          onChange={(v) => setGameVersion(v as SupportedGuildVersion)}
          data-testid="game-version-select"
        />
        <p className="mt-1 text-xs text-muted">Cada juego es un mundo aparte. Una hermandad pertenece a uno y no se puede cambiar después.</p>
        <FieldError name="gameVersion" />
      </div>

      <Field label="Nombre de la hermandad" name="name">
        <input
          id="name"
          name="name"
          className="field"
          required
          maxLength={60}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(suggestSlug(e.target.value));
          }}
          placeholder="Order of the Silver Dawn"
        />
      </Field>

      <div>
        <label htmlFor="slug" className="field-label">
          Subdominio
        </label>
        <div className="flex items-stretch overflow-hidden rounded border border-line bg-ink focus-within:outline-2 focus-within:outline-gold-dim">
          {hostPrefix && <span className="flex items-center pl-3 font-mono text-sm text-muted">{hostPrefix}</span>}
          <input
            id="slug"
            name="slug"
            className="min-h-11 min-w-0 flex-1 bg-transparent px-3 font-mono text-bone outline-none"
            required
            maxLength={SLUG_MAX}
            value={slug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase().replace(/\s+/g, "-"));
            }}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="slug-status"
          />
          <span className="flex items-center pr-3 font-mono text-sm text-muted">{hostSuffix}</span>
        </div>
        <SlugStatus status={status} />
        <SlugSuggestions
          live={!problem || problem === "reserved" ? (availability.state === "taken" ? availability.suggestions : []) : []}
          onPick={(picked) => {
            setSlugEdited(true);
            setSlug(picked);
          }}
        />
        <SlugError slug={slug} />
      </div>

      <fieldset>
        <legend className="field-label">Región</legend>
        <RegionChoice
          value={region}
          onChange={(v) => {
            setRegion(v as Region);
            setRealmSlug("");
          }}
        />
        <p className="mt-1 text-xs text-muted">América y Europa son mundos separados, con sus propios personajes y hermandades.</p>
        <FieldError name="region" />
      </fieldset>

      {realms && (
        <div>
          <label htmlFor="realmSlug" className="field-label">
            Reino
          </label>
          <RealmSelect version={gameVersion} region={region} value={realmSlug} onChange={setRealmSlug} />
          <p className="mt-1 text-xs text-muted">El nombre, el reino y la facción identifican tu hermandad en Guildbook y deben coincidir con la hermandad del juego.</p>
          <FieldError name="realmSlug" />
        </div>
      )}

      <fieldset>
        <legend className="field-label">Facción</legend>
        <FactionChoice value={faction} onChange={setFaction} />
        <p className="mt-1 text-xs text-muted">En el juego, cada hermandad es de una sola facción, así que su web también.</p>
        <FieldError name="faction" />
      </fieldset>

      {!realms && (
        <fieldset>
          <legend className="field-label">Tipo de reino</legend>
          <RulesetChoice value={ruleset} onChange={setRuleset} />
          <p className="mt-1 text-xs text-muted">
            WoW: Forever no tiene reinos: tu hermandad vive en un tipo de reino. Nombre, región, facción y tipo de reino identifican
            juntos a tu hermandad y deben coincidir con la hermandad del juego para verificarla.
          </p>
          <FieldError name="ruleset" />
        </fieldset>
      )}

      <Field label="Zona horaria" name="timezone" hint="Las horas de las bandas se muestran en esta zona horaria.">
        <TimezoneSelect value={timezone} onChange={setTimezone} required />
      </Field>

      <Field label="Lema" name="motto" hint="Opcional. Se muestra bajo el nombre de tu hermandad.">
        <input id="motto" name="motto" className="field" maxLength={120} value={motto} onChange={(e) => setMotto(e.target.value)} placeholder="Acero y paciencia" />
      </Field>

      <fieldset>
        <legend className="field-label">Rangos iniciales</legend>
        <PresetChoices name="rankPreset" defaultKey={DEFAULT_RANK_PRESET} />
        <p className="mt-1 text-xs text-muted">Un punto de partida. Más adelante puedes renombrar, añadir y reordenar rangos para que coincidan con tu hermandad del juego.</p>
        <FieldError name="rankPreset" />
      </fieldset>

      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" name="directoryListed" checked={listed} onChange={(e) => setListed(e.target.checked)} className="mt-0.5 h-5 w-5 accent-gold" />
        <span>
          Mostrar la hermandad en el directorio público de Guildbook
          <span className="block text-xs text-muted">
            Aparece en cuanto publiques la hermandad. Puedes cambiarlo cuando quieras en los ajustes de la hermandad.
          </span>
        </span>
      </label>
      <FieldError name="directoryListed" />

      <FormMessage />
      <SubmitButton variant="gold" pendingLabel="Creando…">
        Crear hermandad
      </SubmitButton>
    </ActionForm>
  );
}
