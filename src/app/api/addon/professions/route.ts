import { db } from "@/db";
import { handleProfessions } from "@/server/addon-sync-api";

/** The guild's profession levels from the addon sync app (Bearer sync key). */
export async function POST(request: Request) {
  return handleProfessions(db, request);
}
