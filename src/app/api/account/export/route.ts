import { NextResponse } from "next/server";
import { db } from "@/db";
import { getSessionUser } from "@/server/context";
import { exportUserData } from "@/server/services/account";

export const dynamic = "force-dynamic";

/** "Export my data": everything stored about the signed-in user, as a JSON download. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Inicia sesión para exportar tus datos." }, { status: 401 });
  const data = await exportUserData(db, user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="guildbook-data-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
