import { db } from "@/db";
import { handleGetGroup, handleUpdateGroup } from "@/server/bot-api";

export async function GET(request: Request, { params }: RouteContext<"/api/bot/groups/[id]">) {
  return handleGetGroup(db, request, (await params).id);
}

/** Status, Discord message and reminder of a group. */
export async function PATCH(request: Request, { params }: RouteContext<"/api/bot/groups/[id]">) {
  return handleUpdateGroup(db, request, (await params).id);
}
