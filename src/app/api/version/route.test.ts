import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/version", () => {
  it("answers the baked-in revision", async () => {
    vi.stubEnv("APP_REVISION", "38af92edc397f971e2500b800fa8a397149a3516");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revision: "38af92edc397f971e2500b800fa8a397149a3516" });
  });

  it("says unknown when the build did not set it", async () => {
    vi.stubEnv("APP_REVISION", "");
    expect(await (await GET()).json()).toEqual({ revision: "unknown" });
  });
});
