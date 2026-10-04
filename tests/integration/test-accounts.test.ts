import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import type { Db } from "@/db/types";
import { seedDemoGuild } from "@/db/seed";
import { listTestAccounts, nextRecruitId } from "@/server/test-accounts";
import { createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
let guildId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  guildId = (await seedDemoGuild(db)).id;
});
afterAll(async () => close());

describe("listTestAccounts", () => {
  it("lists seeded members by rank, then applicants, with full character names", async () => {
    const accounts = await listTestAccounts(db, guildId);
    expect(accounts[0]).toEqual({ discordId: "seed-tor", name: "Tor", displayName: "Tor Whitecross", standing: "Grand Master", group: "member" });
    expect(accounts).toContainEqual(expect.objectContaining({ discordId: "seed-ironvow", displayName: "Ironvow Thornwall", standing: "Marshal" }));
    expect(accounts).toContainEqual(
      expect.objectContaining({ discordId: "seed-joanofarc", displayName: "Joanofarc Domremy", standing: "Aspirante", group: "applicant" }),
    );
    expect(accounts).toContainEqual(
      expect.objectContaining({ discordId: "seed-mordred", displayName: "Mordred Blackthorn", standing: "Solicitud rechazada", group: "applicant" }),
    );
    const groups = accounts.map((a) => a.group);
    expect(groups.lastIndexOf("member")).toBeLessThan(groups.indexOf("applicant"));
  });

  it("ignores non-seeded users", async () => {
    await db.insert(users).values({ name: "Stranger", discordId: "e2e-stranger" });
    const accounts = await listTestAccounts(db, guildId);
    expect(accounts.every((a) => a.discordId.startsWith("seed-"))).toBe(true);
  });
});

describe("nextRecruitId", () => {
  it("returns the next unused recruit ID", async () => {
    expect(await nextRecruitId(db)).toBe("recruit-1");
    await db.insert(users).values([
      { name: "Recruit 1", discordId: "recruit-1" },
      { name: "Recruit 7", discordId: "recruit-7" },
      { name: "Odd", discordId: "recruit-abc" },
    ]);
    expect(await nextRecruitId(db)).toBe("recruit-8");
  });
});
