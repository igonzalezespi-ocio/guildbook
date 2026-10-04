import type { GuildSetupState } from "@/db/schema";

/** Where apex guild creation lands the founder: the setup checklist on the new guild's host. */
export const SETUP_PATH = "/admin/setup";

export const setupUrl = (guildOrigin: string) => `${guildOrigin.replace(/\/+$/, "")}${SETUP_PATH}`;

/** Drafts are unlisted: reachable by link but never indexed. Undefined leaves published guilds on the default. */
export function guildRobots(guild: { publishedAt: Date | null }) {
  return guild.publishedAt ? undefined : ({ index: false, follow: false, googleBot: { index: false, follow: false } } as const);
}

export const SETUP_STEP_KEYS = ["look", "ranks", "charter", "lore", "recruiting", "invite", "verify", "vigil", "publish"] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export function isSetupStepKey(value: unknown): value is SetupStepKey {
  return typeof value === "string" && (SETUP_STEP_KEYS as readonly string[]).includes(value);
}

/** What the checklist reads from the guild's data. Every flag is computed, never ticked by hand. */
export interface SetupFacts {
  /** The Order of Saint Michael: its look, ranks and pages are its own, and it is always set up. */
  order: boolean;
  published: boolean;
  /** An admin saved the tabard and theme at least once. */
  lookSaved: boolean;
  /** Ranks were created, edited, reordered, deleted or replaced by a preset. */
  ranksEdited: boolean;
  /** The rank ladder is still the Order of Saint Michael's, name for name. */
  ranksMatchOrder: boolean;
  /** Some pages are still the Order's, unedited (its charter, prayer, clean chat standard or lore). */
  contentMatchesOrder: boolean;
  /** The charter was edited and no longer reads as the starter text. */
  charterEdited: boolean;
  loreEdited: boolean;
  recruitingSet: boolean;
  activeMembers: number;
  pendingApplications: number;
  discordInvite: boolean;
  verified: boolean;
  vigilUsed: boolean;
}

export type SetupStatus = "done" | "skipped" | "todo";

export interface SetupStep {
  key: SetupStepKey;
  status: SetupStatus;
  /** Needed before the guild can be published. */
  requiredToPublish: boolean;
}

/** Steps an admin must finish before a draft can be published, with what to tell them when one is missing. */
export const PUBLISH_REQUIREMENTS: { key: SetupStepKey; missing: string }[] = [
  { key: "look", missing: "Elige tu tabardo y los colores del sitio." },
  { key: "ranks", missing: "Revisa tus rangos: edítalos, elige una plantilla o confírmalos tal cual." },
  { key: "charter", missing: "Edita el reglamento para que describa tu hermandad y no el texto de ejemplo." },
];

const REQUIRED = new Set(PUBLISH_REQUIREMENTS.map((r) => r.key));

export function ranksReviewed(facts: SetupFacts, state: GuildSetupState): boolean {
  if (facts.order) return true;
  if (facts.ranksMatchOrder) return false;
  return facts.ranksEdited || Boolean(state.ranksConfirmedAt);
}

function isDone(key: SetupStepKey, facts: SetupFacts, state: GuildSetupState): boolean {
  switch (key) {
    case "look":
      return facts.order || facts.lookSaved;
    case "ranks":
      return ranksReviewed(facts, state);
    case "charter":
      return facts.order || (facts.charterEdited && !facts.contentMatchesOrder);
    case "lore":
      return facts.order || facts.loreEdited;
    case "recruiting":
      return facts.recruitingSet;
    case "invite":
      return facts.activeMembers > 1 || facts.pendingApplications > 0 || facts.discordInvite;
    case "verify":
      return facts.verified;
    case "vigil":
      return facts.vigilUsed;
    case "publish":
      return facts.published;
  }
}

export function computeSetup(facts: SetupFacts, state: GuildSetupState) {
  const skipped = new Set(state.skipped ?? []);
  const steps: SetupStep[] = SETUP_STEP_KEYS.map((key) => {
    const done = isDone(key, facts, state);
    return {
      key,
      status: done ? "done" : key !== "publish" && skipped.has(key) ? "skipped" : "todo",
      requiredToPublish: REQUIRED.has(key),
    };
  });
  const publishMissing = facts.published
    ? []
    : PUBLISH_REQUIREMENTS.filter((r) => !isDone(r.key, facts, state)).map((r) => r.missing);
  const settled = steps.filter((s) => s.status !== "todo").length;
  return {
    steps,
    done: steps.filter((s) => s.status === "done").length,
    total: steps.length,
    /** Every step is done or skipped. */
    complete: settled === steps.length,
    canPublish: !facts.published && publishMissing.length === 0,
    publishMissing,
    /** A guild created before neutral defaults, still carrying the Order's ranks or pages. */
    offerNeutralDefaults: !facts.order && (facts.ranksMatchOrder || facts.contentMatchesOrder),
    dismissed: Boolean(state.dismissedAt),
  };
}

export type SetupSummary = ReturnType<typeof computeSetup>;
