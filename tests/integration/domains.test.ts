import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, guildDomains } from "@/db/schema";
import type { Db } from "@/db/types";
import type { HostConfig } from "@/lib/hosts";
import { AuthorizationError } from "@/lib/authz/policy";
import { lookupCustomDomainSlug } from "@/server/domain-lookup";
import { DomainError } from "@/server/errors";
import { addGuildDomain, type DomainDeps, dnsInstructions, MAX_DOMAINS_PER_GUILD, removeGuildDomain, verifyGuildDomain } from "@/server/services/domains";
import type { DomainProvider, DomainProviderStatus } from "@/server/vercel-domains";
import { createGuild, createMember, createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;

const hosts: HostConfig = { rootDomain: "guildbook.io", altDomains: ["guildbook.gg"], defaultGuildSlug: null, cookieDomain: "guildbook.io" };

/** DNS as a map of TXT name to values. */
function fakeDns(records: Record<string, string[]> = {}) {
  return {
    records,
    resolveTxt: async (name: string) => {
      const values = records[name];
      if (!values) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      return values.map((v) => [v]);
    },
  };
}

function fakeProvider(initial: Partial<DomainProviderStatus> = {}) {
  const state = { attached: false, verified: true, misconfigured: false, challenges: [], ...initial } as DomainProviderStatus;
  const calls: string[] = [];
  const provider: DomainProvider = {
    add: async (domain) => {
      calls.push(`add ${domain}`);
      state.attached = true;
    },
    status: async () => ({ ...state }),
    remove: async (domain) => {
      calls.push(`remove ${domain}`);
      state.attached = false;
    },
  };
  return { provider, state, calls };
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(() => close());

describe("custom domains", () => {
  it("adds a domain as pending with DNS instructions", async () => {
    const g = await createGuild(db);
    const admin = await createMember(db, g, "Grand Master");
    const dns = fakeDns();
    const row = await addGuildDomain(db, admin, { domain: "https://OrderOfSaintMichael.com/charter" }, { provider: null, resolveTxt: dns.resolveTxt, hosts });
    expect(row).toMatchObject({ domain: "orderofsaintmichael.com", status: "pending", guildId: g.guild.id });
    expect(row.verificationToken).toMatch(/^[0-9a-f]{32}$/);

    const records = dnsInstructions(row);
    expect(records[0]).toMatchObject({ type: "A", name: "@", value: "76.76.21.21" });
    expect(records[1]).toMatchObject({ type: "TXT", name: "_guildbook.orderofsaintmichael.com", value: `guildbook-site-verification=${row.verificationToken}` });
    expect(dnsInstructions({ ...row, domain: "www.osm.gg" })[0]).toMatchObject({ type: "CNAME", name: "www", value: "cname.vercel-dns.com" });
  });

  it("moves from pending to failed to verified on the TXT check (manual mode)", async () => {
    const g = await createGuild(db);
    const admin = await createMember(db, g, "Grand Master");
    const dns = fakeDns();
    const deps: DomainDeps = { provider: null, resolveTxt: dns.resolveTxt, hosts };
    const row = await addGuildDomain(db, admin, { domain: "silverdawn.gg" }, deps);

    const failed = await verifyGuildDomain(db, admin, row.id, deps);
    expect(failed.status).toBe("failed");
    expect(failed.lastError).toContain("_guildbook.silverdawn.gg");
    expect(await lookupCustomDomainSlug("silverdawn.gg", db)).toBeNull();

    dns.records["_guildbook.silverdawn.gg"] = ["guildbook-site-verification=wrong"];
    expect((await verifyGuildDomain(db, admin, row.id, deps)).status).toBe("failed");

    dns.records["_guildbook.silverdawn.gg"] = [`guildbook-site-verification=${row.verificationToken}`];
    const verified = await verifyGuildDomain(db, admin, row.id, deps);
    expect(verified).toMatchObject({ status: "verified", lastError: null });
    expect(verified.verifiedAt).toBeInstanceOf(Date);
    expect(await lookupCustomDomainSlug("silverdawn.gg", db)).toBe(g.guild.slug);

    const audits = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.targetId, row.id));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["domain.add", "domain.verify"]));

    // Losing the record unverifies it and the proxy stops routing it.
    delete dns.records["_guildbook.silverdawn.gg"];
    expect((await verifyGuildDomain(db, admin, row.id, deps)).status).toBe("failed");
    expect(await lookupCustomDomainSlug("silverdawn.gg", db)).toBeNull();
  });

  it("also requires the hosting provider to verify and route the domain when configured", async () => {
    const g = await createGuild(db);
    const admin = await createMember(db, g, "Grand Master");
    const { provider, state, calls } = fakeProvider({ misconfigured: true });
    const dns = fakeDns();
    const deps: DomainDeps = { provider, resolveTxt: dns.resolveTxt, hosts };
    const row = await addGuildDomain(db, admin, { domain: "guild.example.org" }, deps);
    expect(calls).toEqual(["add guild.example.org"]);

    dns.records["_guildbook.guild.example.org"] = [`guildbook-site-verification=${row.verificationToken}`];
    const misconfigured = await verifyGuildDomain(db, admin, row.id, deps);
    expect(misconfigured.status).toBe("failed");
    expect(misconfigured.lastError).toContain("El DNS aún no apunta a Guildbook");

    state.misconfigured = false;
    expect((await verifyGuildDomain(db, admin, row.id, deps)).status).toBe("verified");

    await removeGuildDomain(db, admin, row.id, deps);
    expect(calls).toContain("remove guild.example.org");
    expect(await db.select().from(guildDomains).where(eq(guildDomains.id, row.id))).toHaveLength(0);
  });

  it("rejects platform domains, duplicates and more than the limit", async () => {
    const g = await createGuild(db);
    const admin = await createMember(db, g, "Grand Master");
    const deps: DomainDeps = { provider: null, resolveTxt: fakeDns().resolveTxt, hosts };
    for (const domain of ["guildbook.io", "osm.guildbook.io", "guildbook.gg", "x.vercel.app", "osm.localhost"]) {
      await expect(addGuildDomain(db, admin, { domain }, deps), domain).rejects.toThrow(DomainError);
    }
    await expect(addGuildDomain(db, admin, { domain: "not a domain" }, deps)).rejects.toThrow();

    await addGuildDomain(db, admin, { domain: "claimed.gg" }, deps);
    const other = await createGuild(db);
    const otherAdmin = await createMember(db, other, "Grand Master");
    await expect(addGuildDomain(db, otherAdmin, { domain: "claimed.gg" }, deps)).rejects.toThrow("ya está conectado");

    for (let i = 1; i < MAX_DOMAINS_PER_GUILD; i++) await addGuildDomain(db, admin, { domain: `extra${i}.gg` }, deps);
    await expect(addGuildDomain(db, admin, { domain: "one-too-many.gg" }, deps)).rejects.toThrow(/hasta/);
  });

  it("is limited to admins and to the guild's own domains", async () => {
    const g = await createGuild(db);
    const admin = await createMember(db, g, "Grand Master");
    const officer = await createMember(db, g, "Marshal");
    const deps: DomainDeps = { provider: null, resolveTxt: fakeDns().resolveTxt, hosts };
    await expect(addGuildDomain(db, officer, { domain: "officer.gg" }, deps)).rejects.toThrow(AuthorizationError);

    const row = await addGuildDomain(db, admin, { domain: "mine.gg" }, deps);
    const other = await createGuild(db);
    const otherAdmin = await createMember(db, other, "Grand Master");
    await expect(verifyGuildDomain(db, otherAdmin, row.id, deps)).rejects.toThrow();
    await expect(removeGuildDomain(db, otherAdmin, row.id, deps)).rejects.toThrow();
  });
});
