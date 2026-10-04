import { describe, expect, it } from "vitest";
import { hostConfigFromEnv } from "@/lib/hosts";
import { type RequestHost, servesSingleGuild } from "./hosts";

const host = (route: RequestHost["route"]): RequestHost => ({
  config: hostConfigFromEnv({}),
  host: "clan.example",
  protocol: "https:",
  origin: "https://clan.example",
  route,
  apexOrigin: "https://clan.example",
  centralSignIn: false,
});

describe("servesSingleGuild", () => {
  it("is true on a host that serves its default guild as its own apex", () => {
    expect(servesSingleGuild(host({ kind: "fallback", defaultGuildSlug: "clan" }))).toBe(true);
  });
  it("is false on the apex, on guild hosts and on a fallback host without a default guild", () => {
    expect(servesSingleGuild(host({ kind: "apex" }))).toBe(false);
    expect(servesSingleGuild(host({ kind: "guild", slug: "clan", custom: false }))).toBe(false);
    expect(servesSingleGuild(host({ kind: "fallback", defaultGuildSlug: null }))).toBe(false);
  });
});
