import { db } from "@/db";
import { handleCreateGroup, handleListGroups } from "@/server/bot-api";

/** Groups still coming up (Discord bot only; `?guild=<slug>`). */
export async function GET(request: Request) {
  return handleListGroups(db, request);
}

/** A new group, led by the Discord user in `actorDiscordId`. */
export async function POST(request: Request) {
  return handleCreateGroup(db, request);
}
