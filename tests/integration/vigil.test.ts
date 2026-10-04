import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLog, memberships, vigilReports } from "@/db/schema";
import type { Db } from "@/db/types";
import { analyzeText } from "@/lib/vigil/analyze";
import { createCharacter } from "@/server/services/characters";
import {
  createVigilReport,
  deleteVigilReport,
  getVigilPreferences,
  getVigilReport,
  listOwnVigilReports,
  listSharedVigilReports,
  setVigilDefaultVisibility,
  setVigilReportVisibility,
  VersionMismatchError,
} from "@/server/services/vigil";
import { PALADIN, paladinLog } from "../support/combatlog";
import { createGuild, createMember, createTestDb, createVisitor, reloadActor } from "../support/db";

let db: Db;
let close: () => Promise<void>;
const [report] = analyzeText(paladinLog(), PALADIN.guid, "paladin-leveling", "Tor");

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

async function setup() {
  const guild = await createGuild(db);
  const owner = await createMember(db, guild, "Squire");
  const member = await createMember(db, guild, "Knight");
  const officer = await createMember(db, guild, "Marshal");
  const admin = await createMember(db, guild, "Grand Master");
  return { guild, owner, member, officer, admin };
}

const audits = (targetId: string) => db.select().from(auditLog).where(eq(auditLog.targetId, targetId));

describe("vigil reports", () => {
  it("are private by default: only the owner sees them, officers included", async () => {
    const { owner, member, officer, admin } = await setup();
    const { id } = await createVigilReport(db, owner, { report });

    const mine = await getVigilReport(db, owner, id);
    expect(mine).toMatchObject({ isOwner: true, visibility: "private", fightLabel: "Rockhide Boar", playerName: "Tor" });
    expect(mine.report.model?.id).toBe("paladin-leveling");
    for (const other of [member, officer, admin]) {
      await expect(getVigilReport(db, other, id)).rejects.toThrow("No se ha encontrado el informe");
      expect(await listSharedVigilReports(db, other)).toHaveLength(0);
    }
    expect(await listOwnVigilReports(db, owner)).toHaveLength(1);
    // Creating a report leaves no officer-visible trace.
    expect(await audits(id)).toHaveLength(0);
  });

  it("shared with officers: officers and admins read it, members do not", async () => {
    const { owner, member, officer, admin } = await setup();
    const { id } = await createVigilReport(db, owner, { report, visibility: "officers" });
    expect((await getVigilReport(db, officer, id)).isOwner).toBe(false);
    expect((await getVigilReport(db, admin, id)).id).toBe(id);
    await expect(getVigilReport(db, member, id)).rejects.toThrow("No se ha encontrado el informe");
    expect((await listSharedVigilReports(db, officer)).map((r) => r.id)).toEqual([id]);
    expect(await listSharedVigilReports(db, member)).toHaveLength(0);
  });

  it("shared with the guild: every active member reads it, visitors and applicants cannot", async () => {
    const { guild, owner, member } = await setup();
    const { id } = await createVigilReport(db, owner, { report, visibility: "guild" });
    expect((await getVigilReport(db, member, id)).id).toBe(id);
    expect((await listSharedVigilReports(db, member))[0]).toMatchObject({ id, ownerName: expect.any(String) });
    const applicant = await createMember(db, guild, "Postulant", "applicant");
    const visitor = await createVisitor(db, guild.guild.id);
    await expect(getVigilReport(db, applicant, id)).rejects.toThrow("Necesitas permisos de Miembro");
    await expect(getVigilReport(db, visitor, id)).rejects.toThrow("Necesitas permisos de Miembro");
  });

  it("stop being shared when the owner leaves the guild", async () => {
    const { owner, member, officer } = await setup();
    const { id } = await createVigilReport(db, owner, { report, visibility: "guild" });
    await db.update(memberships).set({ status: "former" }).where(eq(memberships.id, owner.membershipId!));
    await expect(getVigilReport(db, member, id)).rejects.toThrow("No se ha encontrado el informe");
    await expect(getVigilReport(db, officer, id)).rejects.toThrow("No se ha encontrado el informe");
    expect(await listSharedVigilReports(db, officer)).toHaveLength(0);
    const former = await reloadActor(db, owner);
    await expect(listOwnVigilReports(db, former)).rejects.toThrow("Necesitas permisos de Miembro");
  });

  it("are isolated per guild", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await createVigilReport(db, a.owner, { report, visibility: "guild" });
    await expect(getVigilReport(db, b.admin, id)).rejects.toThrow("No se ha encontrado el informe");
    expect(await listSharedVigilReports(db, b.member)).toHaveLength(0);
    await expect(setVigilReportVisibility(db, b.owner, id, "private")).rejects.toThrow("No se ha encontrado el informe");
    await expect(deleteVigilReport(db, b.admin, id)).rejects.toThrow("No se ha encontrado el informe");
    // A character from another guild cannot be attached.
    const otherChar = await createCharacter(db, b.owner, {
      name: "Rhune",
      surname: "Stone",
      faction: "alliance",
      wowClass: "warrior",
      spec: "Protection",
      role: "tank",
      level: "30",
      professions: [],
    });
    await expect(createVigilReport(db, a.owner, { report, characterId: otherChar!.id })).rejects.toThrow("No se ha encontrado el personaje");
  });

  it("let only the owner change visibility or delete, and audit those changes", async () => {
    const { owner, officer } = await setup();
    const { id } = await createVigilReport(db, owner, { report });
    await expect(setVigilReportVisibility(db, officer, id, "guild")).rejects.toThrow("No se ha encontrado el informe");
    await setVigilReportVisibility(db, owner, id, "officers");
    expect((await getVigilReport(db, officer, id)).visibility).toBe("officers");
    const [entry] = await audits(id);
    expect(entry).toMatchObject({ action: "vigil.visibility", before: { visibility: "private" }, after: { visibility: "officers" } });
    await expect(deleteVigilReport(db, officer, id)).rejects.toThrow("No se ha encontrado el informe");
    await deleteVigilReport(db, owner, id);
    await expect(getVigilReport(db, owner, id)).rejects.toThrow("No se ha encontrado el informe");
    expect((await audits(id)).map((a) => a.action).sort()).toEqual(["vigil.delete", "vigil.visibility"]);
  });

  it("use the player's default visibility and can share every report at once", async () => {
    const { owner, member } = await setup();
    const first = await createVigilReport(db, owner, { report });
    await setVigilDefaultVisibility(db, owner, "guild");
    expect(await getVigilPreferences(db, owner)).toEqual({ defaultVisibility: "guild" });
    const second = await createVigilReport(db, owner, { report });
    expect((await getVigilReport(db, member, second.id)).visibility).toBe("guild");
    await expect(getVigilReport(db, member, first.id)).rejects.toThrow("No se ha encontrado el informe");
    await setVigilDefaultVisibility(db, owner, "guild", true);
    expect((await getVigilReport(db, member, first.id)).visibility).toBe("guild");
  });

  it("attach the owner's character and reject malformed or oversized reports", async () => {
    const { owner } = await setup();
    const tor = await createCharacter(db, owner, {
      name: "Tor",
      surname: "Vigil",
      faction: "alliance",
      wowClass: "paladin",
      spec: "Holy",
      role: "melee",
      level: "8",
      professions: [],
    });
    const { id } = await createVigilReport(db, owner, { report, characterId: tor!.id });
    expect(await getVigilReport(db, owner, id)).toMatchObject({ characterName: "Tor", characterClass: "paladin" });
    await expect(createVigilReport(db, owner, { report: { ...report, version: 99 } })).rejects.toThrow("format");
    const huge = { ...report, notes: ["x".repeat(1_000_000)] };
    await expect(createVigilReport(db, owner, { report: huge })).rejects.toThrow("demasiado grande");
    await expect(getVigilReport(db, owner, "not-a-uuid")).rejects.toThrow("No se ha encontrado el informe");
  });
});

describe("vigil report game versions", () => {
  const BEFORE_LAUNCH = new Date("2026-10-01T12:00:00Z");
  const AFTER_LAUNCH = new Date("2026-11-04T00:00:01Z");
  const tbcLog = { ...report!.log, build: "2.5.6", projectId: 5 };
  const stored = async (id: string) => (await db.select().from(vigilReports).where(eq(vigilReports.id, id)))[0]!;

  it("derives the version from the log when an older Vigil did not send it", async () => {
    const guild = await createGuild(db, { gameVersion: "anniversary", realmSlug: "thunderstrike", region: "eu" });
    const owner = await createMember(db, guild, "Miembro");
    const saved = await createVigilReport(db, owner, { report: { ...report!, log: tbcLog } }, AFTER_LAUNCH);
    expect(saved).toMatchObject({ gameVersion: "anniversary", versionMismatch: false, warning: null });
    expect(await stored(saved.id)).toMatchObject({ gameVersion: "anniversary", versionMismatch: false });
  });

  it("leaves logs that do not say which game unflagged", async () => {
    const guild = await createGuild(db);
    const owner = await createMember(db, guild, "Squire");
    const saved = await createVigilReport(db, owner, { report }, AFTER_LAUNCH);
    expect(saved).toMatchObject({ gameVersion: null, versionMismatch: false });
  });

  it("flags a log from another game before WoW: Forever launches and refuses it from launch day", async () => {
    const guild = await createGuild(db, { name: "Forever Guild" });
    const owner = await createMember(db, guild, "Squire");
    const era = { ...report!, gameVersion: "era" as const, log: { ...report!.log, build: "1.15.7", projectId: 2, flavor: "_classic_era_" } };

    const saved = await createVigilReport(db, owner, { report: era }, BEFORE_LAUNCH);
    expect(saved).toMatchObject({ gameVersion: "era", versionMismatch: true });
    expect(saved.warning).toContain("A partir del 4 nov, Vigil rechaza registros de otro juego");
    expect(await getVigilReport(db, owner, saved.id)).toMatchObject({ gameVersion: "era", versionMismatch: true });

    const refused = createVigilReport(db, owner, { report: { ...report!, log: tbcLog } }, AFTER_LAUNCH);
    await expect(refused).rejects.toBeInstanceOf(VersionMismatchError);
    await expect(createVigilReport(db, owner, { report: { ...report!, log: tbcLog } }, AFTER_LAUNCH)).rejects.toThrow(
      "Este registro es de TBC Anniversary; Forever Guild es una hermandad de WoW: Forever. Empareja Vigil con tu hermandad de TBC Anniversary.",
    );
  });
});
