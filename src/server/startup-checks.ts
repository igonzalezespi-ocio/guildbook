import { isProductionRuntime } from "@/lib/runtime-env";

/** Names of the test-only switches that are on, if this is a production runtime; empty otherwise. */
export function testModesEnabledInProduction(env: Record<string, string | undefined> = process.env): string[] {
  if (!isProductionRuntime(env)) return [];
  return ["AUTH_TEST_MODE", "BATTLENET_MOCK"].filter((name) => env[name] === "1");
}

/**
 * Test-only switches otherwise throw lazily, on the first request that loads auth or the Battle.net config. A
 * production server with one of them on must not start at all.
 */
export function refuseTestModesInProduction() {
  const enabled = testModesEnabledInProduction();
  if (enabled.length === 0) return;
  console.error(`Refusing to start: ${enabled.join(", ")} must never be enabled in production.`);
  process.exit(1);
}
