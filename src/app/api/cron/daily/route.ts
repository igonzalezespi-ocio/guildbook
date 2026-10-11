import { type NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { getBlizzardClient } from "@/server/blizzard";
import { battlenetEnabled } from "@/server/blizzard/config";
import { cronAuthorized } from "@/server/cron";
import { purgeStaleApplications } from "@/server/services/account";
import { syncAllGuilds } from "@/server/services/battlenet";
import { purgePastGroups } from "@/server/services/groups";
import { recheckVerifiedGuilds } from "@/server/services/guild-verification";
import { refreshItemCache } from "@/server/services/items";
import { purgeStaleLootDrafts } from "@/server/services/loot";

export const maxDuration = 300;

/**
 * Daily housekeeping: application retention, stale loot import drafts, past Discord groups, the Battle.net level sync and the verified
 * guild re-check when Battle.net is configured, and the item cache (Blizzard data is refreshed, or deleted once 30 days old, even when unconfigured).
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const retention = await purgeStaleApplications(db);
  const lootDrafts = await purgeStaleLootDrafts(db);
  const groups = await purgePastGroups(db);
  const client = getBlizzardClient();
  const enabled = battlenetEnabled(client.config);
  const sync = enabled ? await syncAllGuilds(db, client) : "skipped";
  const verification = enabled ? await recheckVerifiedGuilds(db, client) : "skipped";
  const items = await refreshItemCache(db, enabled && !client.config.mock ? client : null);
  return NextResponse.json({ ok: true, retention: { deletedApplications: retention.deleted, lootDrafts, groups }, sync, verification, items });
}
