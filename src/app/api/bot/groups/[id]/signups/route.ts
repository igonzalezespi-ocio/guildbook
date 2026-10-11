import { db } from "@/db";
import { handleBench, handleRemoveSignup, handleSignUp } from "@/server/bot-api";

/** Sign up, or change character, role or bench. */
export async function POST(request: Request, { params }: RouteContext<"/api/bot/groups/[id]/signups">) {
  return handleSignUp(db, request, (await params).id);
}

/** Bench or unbench yourself, or someone else (leader or officer). */
export async function PATCH(request: Request, { params }: RouteContext<"/api/bot/groups/[id]/signups">) {
  return handleBench(db, request, (await params).id);
}

/** Leave, or remove someone (leader or officer). */
export async function DELETE(request: Request, { params }: RouteContext<"/api/bot/groups/[id]/signups">) {
  return handleRemoveSignup(db, request, (await params).id);
}
