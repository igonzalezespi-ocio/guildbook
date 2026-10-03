import { describe, expect, it } from "vitest";
import { testModesEnabledInProduction } from "./startup-checks";

describe("testModesEnabledInProduction", () => {
  it("flags test-only switches on a self-hosted production server", () => {
    expect(testModesEnabledInProduction({ NODE_ENV: "production", AUTH_TEST_MODE: "1", BATTLENET_MOCK: "1" })).toEqual([
      "AUTH_TEST_MODE",
      "BATTLENET_MOCK",
    ]);
  });
  it("lets a clean production server start", () => {
    expect(testModesEnabledInProduction({ NODE_ENV: "production" })).toEqual([]);
  });
  it("lets development and e2e use the switches", () => {
    expect(testModesEnabledInProduction({ NODE_ENV: "development", AUTH_TEST_MODE: "1" })).toEqual([]);
  });
});
