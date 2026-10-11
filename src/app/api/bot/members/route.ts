import { db } from "@/db";
import { handleListMembers } from "@/server/bot-api";

/** Members, rank tiers and characters, for the Discord bot's roles (Discord bot only; `?guild=<slug>`). */
export async function GET(request: Request) {
  return handleListMembers(db, request);
}
