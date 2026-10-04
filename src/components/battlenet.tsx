import { ActionForm, FormMessage, SubmitButton } from "@/components/action-form";
import { StatusToast } from "@/components/status-toast";
import { emptySnapshotMessage } from "@/lib/battlenet-empty-state";
import { formatDateTime } from "@/lib/format";
import type { Faction, Region } from "@/lib/game";
import type { GuildVersion } from "@/lib/game-versions";
import { snapshotVersion } from "@/server/blizzard/filter";
import { refreshBattlenetAction, unlinkBattlenetAction } from "@/server/actions/battlenet";
import type { BattlenetLink } from "@/server/services/battlenet";

export function battlenetLinkHref(slug: string, returnTo: string): string {
  return `/api/battlenet/link?${new URLSearchParams({ guild: slug, returnTo })}`;
}

/** Full-page navigation (not next/link): the route redirects off-site to Battle.net. */
export function LinkBattlenetButton({
  slug,
  returnTo,
  children = "Vincular Battle.net",
  variant = "primary",
}: {
  slug: string;
  returnTo: string;
  children?: string;
  variant?: "primary" | "ghost";
}) {
  return (
    <a href={battlenetLinkHref(slug, returnTo)} className={`btn btn-${variant} btn-sm`}>
      {children}
    </a>
  );
}

const NOTICES: Record<string, { tone: "ok" | "error"; text: string }> = {
  linked: { tone: "ok", text: "Battle.net vinculado." },
  denied: { tone: "error", text: "Se canceló la autorización de Battle.net." },
  taken: { tone: "error", text: "Esa cuenta de Battle.net ya está vinculada a otra cuenta de Discord." },
  error: { tone: "error", text: "No hemos podido conectar con Battle.net. Inténtalo de nuevo." },
  unavailable: { tone: "error", text: "La vinculación con Battle.net aún no está configurada en este sitio." },
};

/** Result of the OAuth round trip (`?bnet=`). */
export function BattlenetNotice({ status }: { status: string | string[] | undefined }) {
  const notice = typeof status === "string" ? NOTICES[status] : undefined;
  if (!notice) return null;
  return (
    <>
      <StatusToast param="bnet" kind={notice.tone === "ok" ? "success" : "error"} message={notice.text} />
      <p
        role={notice.tone === "ok" ? "status" : "alert"}
        className={`rounded border px-3 py-2 text-sm ${notice.tone === "ok" ? "border-gold-dim text-gold" : "border-crimson text-red-300"}`}
      >
        {notice.text}
      </p>
    </>
  );
}

/** Linked account line: BattleTag, snapshot age, refresh (while the token lasts) or reconnect, and unlink. */
export function BattlenetAccount({
  link,
  slug,
  returnTo,
  timezone,
}: {
  link: BattlenetLink;
  slug: string;
  returnTo: string;
  timezone: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3" data-testid="battlenet-account">
      <div className="min-w-0 text-sm">
        <p>
          Battle.net: <span className="font-semibold text-bone">{link.battletag}</span>
        </p>
        <p className="text-xs text-muted">Personajes leídos el {formatDateTime(link.snapshotAt, timezone)}</p>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {link.canRefresh ? (
          <ActionForm action={refreshBattlenetAction.bind(null, slug)}>
            <SubmitButton variant="ghost" size="sm" pendingLabel="Actualizando…">
              Actualizar personajes
            </SubmitButton>
            <FormMessage className="mt-1" />
          </ActionForm>
        ) : (
          <LinkBattlenetButton slug={slug} returnTo={returnTo} variant="ghost">
            Reconectar para actualizar
          </LinkBattlenetButton>
        )}
        <ActionForm action={unlinkBattlenetAction.bind(null, slug)} confirm="¿Desvincular tu cuenta de Battle.net? Tus personajes se quedan, pero dejarán de estar verificados y de sincronizarse.">
          <SubmitButton variant="ghost" size="sm" pendingLabel="Desvinculando…">
            Desvincular
          </SubmitButton>
          <FormMessage className="mt-1" />
        </ActionForm>
      </div>
    </div>
  );
}

/** Why a linked account offers no characters, and what it has instead. */
export function EmptySnapshotNote({
  link,
  faction,
  region,
  version = "forever",
}: {
  link: BattlenetLink;
  faction: Faction | null;
  region?: Region | null;
  version?: GuildVersion;
}) {
  const text = emptySnapshotMessage({
    battletag: link.battletag,
    status: link.snapshotStatus,
    scan: link.scan,
    foreverCharacters: link.characters.filter((c) => snapshotVersion(c) === version),
    version,
    guildFaction: faction,
    guildRegion: region,
    now: new Date(),
  });
  return (
    <p className="text-sm text-muted" data-testid="battlenet-empty">
      {text}
    </p>
  );
}
