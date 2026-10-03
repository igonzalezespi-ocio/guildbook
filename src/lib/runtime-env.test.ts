import { describe, expect, it } from "vitest";
import { isProductionRuntime } from "./runtime-env";

describe("isProductionRuntime", () => {
  it("treats a self-hosted `next start` (NODE_ENV only) as production", () => {
    expect(isProductionRuntime({ NODE_ENV: "production" })).toBe(true);
  });
  it("treats Vercel production as production", () => {
    expect(isProductionRuntime({ VERCEL_ENV: "production" })).toBe(true);
  });
  it("leaves development, tests and Vercel previews alone", () => {
    expect(isProductionRuntime({ NODE_ENV: "development" })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "test" })).toBe(false);
    expect(isProductionRuntime({ NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
  });
});
