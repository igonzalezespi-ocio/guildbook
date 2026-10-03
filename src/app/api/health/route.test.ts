import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("@/db", () => ({ db: { execute: (...args: unknown[]) => execute(...args) } }));

async function health() {
  const { GET } = await import("./route");
  return GET();
}

describe("GET /api/health", () => {
  it("answers 200 when the database answers", async () => {
    execute.mockImplementationOnce(async () => ({ rows: [] }));
    const res = await health();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("answers 503, without the error, when the database does not", async () => {
    execute.mockImplementationOnce(async () => {
      throw new Error("connect ECONNREFUSED 10.89.40.2:5432");
    });
    const res = await health();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("ECONNREFUSED");
  });
});
