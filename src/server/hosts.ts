import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import {
  apexOrigin,
  guildSubdomainOrigin,
  type HostConfig,
  hostConfigFromEnv,
  isLocalHost,
  normalizeHost,
  parseHost,
  sharesSessionCookie,
  validateRedirectTarget,
} from "@/lib/hosts";
import { lookupCustomDomainSlug } from "@/server/domain-lookup";

export type ResolvedHost =
  | { kind: "apex" }
  | { kind: "guild"; slug: string; custom: boolean }
  | { kind: "fallback"; defaultGuildSlug: string | null }
  | { kind: "redirect"; host: string }
  | { kind: "reserved" };

/** `parseHost` plus the database lookup for custom domains. Unknown custom hosts fall back like previews do. */
export async function resolveHost(rawHost: string, config: HostConfig = hostConfigFromEnv()): Promise<ResolvedHost> {
  const route = parseHost(rawHost, config);
  switch (route.kind) {
    case "custom": {
      const slug = await lookupCustomDomainSlug(route.host);
      return slug ? { kind: "guild", slug, custom: true } : { kind: "fallback", defaultGuildSlug: config.defaultGuildSlug };
    }
    case "guild":
      return { kind: "guild", slug: route.slug, custom: false };
    case "reserved":
      return { kind: "reserved" };
    default:
      return route;
  }
}

export interface RequestHost {
  config: HostConfig;
  /** Hostname with port. */
  host: string;
  protocol: "http:" | "https:";
  origin: string;
  route: ResolvedHost;
  apexOrigin: string;
  /** Guild subdomains and custom domains sign in on the apex; fallback hosts sign in on themselves. */
  centralSignIn: boolean;
}

export function protocolFor(host: string, forwardedProto: string | null): "http:" | "https:" {
  if (forwardedProto) return forwardedProto.split(",")[0]!.trim() === "http" ? "http:" : "https:";
  return isLocalHost(host) ? "http:" : "https:";
}

export async function describeHost(host: string, forwardedProto: string | null): Promise<RequestHost> {
  const config = hostConfigFromEnv();
  const protocol = protocolFor(host, forwardedProto);
  const route = await resolveHost(host, config);
  return {
    config,
    host,
    protocol,
    origin: `${protocol}//${host}`,
    route,
    apexOrigin: apexOrigin(config, { protocol, host }),
    centralSignIn: route.kind === "guild",
  };
}

/** The current request's host, resolved once per render. */
export const getRequestHost = cache(async (): Promise<RequestHost> => {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  return describeHost(host, h.get("x-forwarded-proto"));
});

export function hostFromRequest(request: Request): Promise<RequestHost> {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  return describeHost(host, request.headers.get("x-forwarded-proto"));
}

/**
 * Validates a destination on the root domain, a guild subdomain, a local host or a verified custom domain.
 * Returns the absolute URL, or null.
 */
export async function validateDestination(raw: string | null | undefined, base: string): Promise<string | null> {
  const config = hostConfigFromEnv();
  const quick = validateRedirectTarget(raw, base, { config });
  if (quick || !raw) return quick;
  let host: string;
  try {
    host = normalizeHost(new URL(raw).hostname);
  } catch {
    return null;
  }
  const slug = await lookupCustomDomainSlug(host);
  return validateRedirectTarget(raw, base, { config, isVerifiedCustomDomain: (h) => h === host && slug !== null });
}

/**
 * Where to send the browser after signing in on the apex, so the session reaches `target`: straight there when
 * the shared cookie covers its host, otherwise through the one-time handoff that sets a cookie on that host.
 */
export function afterSignInUrl(target: string, current: RequestHost): string {
  const url = new URL(target);
  if (url.origin === current.origin || sharesSessionCookie(url.host, current.config)) return target;
  const start = new URL("/api/handoff/start", current.apexOrigin);
  start.searchParams.set("to", target);
  return start.toString();
}

/** A guild's public origin: its subdomain, or its verified custom domain when it has one. */
export function guildOrigin(slug: string, current: RequestHost, customDomain?: string | null): string {
  if (customDomain && !isLocalHost(current.host)) return `https://${customDomain}`;
  if (current.route.kind === "fallback" && current.route.defaultGuildSlug === slug) return current.origin;
  return guildSubdomainOrigin(slug, current.config, current);
}

/**
 * A host that serves one guild as its own apex (DEFAULT_GUILD_SLUG on a host that is not a guild subdomain). The
 * platform's legal and account pages render there, but the directory and guild creation do not exist on it.
 */
export function servesSingleGuild(current: RequestHost): boolean {
  return current.route.kind === "fallback" && current.route.defaultGuildSlug !== null;
}
