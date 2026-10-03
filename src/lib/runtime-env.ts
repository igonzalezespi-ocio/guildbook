/**
 * True when the app runs as a production deployment, wherever it is hosted. Vercel sets VERCEL_ENV; a self-hosted
 * container only has NODE_ENV, which `next start` and `next build` set to "production". Test-only switches
 * (AUTH_TEST_MODE, BATTLENET_MOCK) must check this, not VERCEL_ENV alone: off Vercel that variable is never set.
 */
export function isProductionRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}
