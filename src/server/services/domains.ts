import { randomBytes } from "node:crypto";
import { and, asc, count, eq } from "drizzle-orm";
import { guildDomains } from "@/db/schema";
import type { Db } from "@/db/types";
import { type Actor, assertCan } from "@/lib/authz/policy";
import { type HostConfig, hostConfigFromEnv, LOCAL_ROOT } from "@/lib/hosts";
import { customDomainInput } from "@/lib/validation";
import { recordAudit } from "@/server/audit";
import { isUniqueViolation } from "@/server/db-errors";
import { forgetCustomDomain } from "@/server/domain-lookup";
import { DomainError, NotFoundError } from "@/server/errors";
import type { DomainProvider } from "@/server/vercel-domains";

export const MAX_DOMAINS_PER_GUILD = 3;
export const TXT_PREFIX = "_guildbook";
export const TXT_VALUE_PREFIX = "guildbook-site-verification=";
/** Vercel's documented targets for custom domains. */
export const VERCEL_A_RECORD = "76.76.21.21";
export const VERCEL_CNAME = "cname.vercel-dns.com";

export interface DomainDeps {
  /** Null when VERCEL_TOKEN and VERCEL_PROJECT_ID aren't set: ownership is checked, routing is set up by hand. */
  provider: DomainProvider | null;
  resolveTxt: (name: string) => Promise<string[][]>;
  hosts?: HostConfig;
}

export type GuildDomain = typeof guildDomains.$inferSelect;

/** The DNS records an officer adds at their registrar. */
export function dnsInstructions(domain: GuildDomain) {
  const isApex = domain.domain.split(".").length === 2;
  return [
    isApex
      ? { type: "A", name: "@", value: VERCEL_A_RECORD, purpose: "Apunta el dominio a Guildbook" }
      : { type: "CNAME", name: domain.domain.split(".")[0]!, value: VERCEL_CNAME, purpose: "Apunta el dominio a Guildbook" },
    { type: "TXT", name: `${TXT_PREFIX}.${domain.domain}`, value: `${TXT_VALUE_PREFIX}${domain.verificationToken}`, purpose: "Demuestra que la hermandad controla el dominio" },
  ];
}

/** The guild's first verified custom domain, used as its canonical host. */
export async function primaryCustomDomain(db: Db, guildId: string): Promise<string | null> {
  const [row] = await db
    .select({ domain: guildDomains.domain })
    .from(guildDomains)
    .where(and(eq(guildDomains.guildId, guildId), eq(guildDomains.status, "verified")))
    .orderBy(asc(guildDomains.createdAt))
    .limit(1);
  return row?.domain ?? null;
}

export async function listGuildDomains(db: Db, guildId: string): Promise<GuildDomain[]> {
  return db.select().from(guildDomains).where(eq(guildDomains.guildId, guildId)).orderBy(asc(guildDomains.createdAt));
}

function assertNotPlatformDomain(domain: string, hosts: HostConfig) {
  const own = [hosts.rootDomain, ...hosts.altDomains, LOCAL_ROOT, "vercel.app"];
  if (own.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    throw new DomainError("Usa un dominio que sea tuyo. Los subdominios de Guildbook dependen del identificador de la hermandad.");
  }
}

export async function addGuildDomain(db: Db, actor: Actor, raw: unknown, deps: DomainDeps): Promise<GuildDomain> {
  assertCan(actor, "domain.manage");
  const { domain } = customDomainInput.parse(raw);
  assertNotPlatformDomain(domain, deps.hosts ?? hostConfigFromEnv());
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(guildDomains).where(eq(guildDomains.guildId, actor.guildId));
  if (n >= MAX_DOMAINS_PER_GUILD) throw new DomainError(`Una hermandad puede conectar hasta ${MAX_DOMAINS_PER_GUILD} dominios.`);

  let row: GuildDomain;
  try {
    row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(guildDomains)
        .values({ guildId: actor.guildId, domain, verificationToken: randomBytes(16).toString("hex"), createdByUserId: actor.userId })
        .returning();
      await recordAudit(tx, actor, { action: "domain.add", targetType: "guild_domain", targetId: inserted!.id, after: { domain } });
      return inserted!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new DomainError("Ese dominio ya está conectado a una hermandad.");
    throw err;
  }

  if (deps.provider) {
    try {
      await deps.provider.add(domain);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se ha podido añadir el dominio al proyecto de alojamiento";
      [row] = await db.update(guildDomains).set({ lastError: message }).where(eq(guildDomains.id, row.id)).returning() as [GuildDomain];
    }
  }
  return row;
}

async function hasTxtToken(domain: GuildDomain, resolveTxt: DomainDeps["resolveTxt"]): Promise<boolean> {
  try {
    const records = await resolveTxt(`${TXT_PREFIX}.${domain.domain}`);
    return records.some((chunks) => chunks.join("").trim() === `${TXT_VALUE_PREFIX}${domain.verificationToken}`);
  } catch {
    return false;
  }
}

/**
 * Checks ownership (the TXT token) and, when the Vercel API is configured, that the domain is attached to the
 * project and its DNS points at Vercel. The TXT check stops one guild claiming a domain another guild set up.
 */
export async function verifyGuildDomain(db: Db, actor: Actor, id: string, deps: DomainDeps, now = new Date()): Promise<GuildDomain> {
  assertCan(actor, "domain.manage");
  const [domain] = await db.select().from(guildDomains).where(and(eq(guildDomains.guildId, actor.guildId), eq(guildDomains.id, id)));
  if (!domain) throw new NotFoundError("Domain");

  const problems: string[] = [];
  if (!(await hasTxtToken(domain, deps.resolveTxt))) {
    problems.push(`Aún no se encuentra el registro TXT ${TXT_PREFIX}.${domain.domain}`);
  }
  if (deps.provider) {
    try {
      let status = await deps.provider.status(domain.domain);
      if (!status.attached) {
        await deps.provider.add(domain.domain);
        status = await deps.provider.status(domain.domain);
      }
      if (!status.verified) {
        problems.push(
          status.challenges.length
            ? `Vercel pide TXT ${status.challenges.map((c) => `${c.domain} = ${c.value}`).join(", ")}`
            : "Vercel aún no ha verificado el dominio",
        );
      }
      if (status.misconfigured) problems.push("El DNS aún no apunta a Guildbook");
    } catch (err) {
      problems.push(err instanceof Error ? err.message : "Ha fallado la comprobación del proveedor de alojamiento");
    }
  }

  const verified = problems.length === 0;
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(guildDomains)
      .set({
        status: verified ? "verified" : "failed",
        lastError: verified ? null : problems.join(". "),
        lastCheckedAt: now,
        verifiedAt: verified ? (domain.verifiedAt ?? now) : null,
      })
      .where(eq(guildDomains.id, domain.id))
      .returning();
    if (verified !== (domain.status === "verified")) {
      await recordAudit(tx, actor, {
        action: verified ? "domain.verify" : "domain.unverify",
        targetType: "guild_domain",
        targetId: domain.id,
        before: { status: domain.status },
        after: { status: verified ? "verified" : "failed" },
      });
    }
    return rows;
  });
  forgetCustomDomain(domain.domain);
  return updated!;
}

export async function removeGuildDomain(db: Db, actor: Actor, id: string, deps: DomainDeps): Promise<void> {
  assertCan(actor, "domain.manage");
  const domain = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(guildDomains)
      .where(and(eq(guildDomains.guildId, actor.guildId), eq(guildDomains.id, id)))
      .returning();
    if (!deleted) throw new NotFoundError("Domain");
    await recordAudit(tx, actor, { action: "domain.remove", targetType: "guild_domain", targetId: id, before: { domain: deleted.domain } });
    return deleted;
  });
  forgetCustomDomain(domain.domain);
  if (deps.provider) await deps.provider.remove(domain.domain).catch(() => undefined);
}
