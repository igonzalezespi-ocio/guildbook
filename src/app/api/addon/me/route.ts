import { db } from "@/db";
import { handleMe } from "@/server/addon-sync-api";

/** Which guild a sync key belongs to, for the addon sync app's setup. */
export async function GET(request: Request) {
  return handleMe(db, request);
}
