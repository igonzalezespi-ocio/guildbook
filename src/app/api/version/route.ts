import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The commit this image was built from, so anyone can see which release is live. `APP_REVISION` is baked in by the
 * release workflow; a local build says "unknown". Reveals nothing beyond a public commit id.
 */
export async function GET() {
  const revision = process.env.APP_REVISION?.trim() || "unknown";
  return NextResponse.json({ revision }, { headers: { "Cache-Control": "no-store" } });
}
