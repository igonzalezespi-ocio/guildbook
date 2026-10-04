import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { characters, memberships } from "@/db/schema";
import type { Db } from "@/db/types";
import { DomainError } from "@/server/errors";
import { reviewApplication, submitApplication, withdrawApplication } from "@/server/services/applications";
import {
  archiveCharacter,
  createCharacter,
  listOwnCharacters,
  setMainCharacter,
} from "@/server/services/characters";
import { createGuildWithDefaults } from "@/server/services/guilds";
import { createGuild, createMember, createTestDb, createVisitor, reloadActor, validApplication } from "../support/db";

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());

async function membershipOf(guildId: string, userId: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.guildId, guildId), eq(memberships.userId, userId)));
  return row;
}

describe("application lifecycle", () => {
  it("makes the applicant a Postulant, then a Squire with their character on acceptance", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);

    const app = await submitApplication(db, visitor, validApplication);
    const pending = await membershipOf(guild.guild.id, visitor.userId);
    expect(pending).toMatchObject({ status: "applicant", rankId: guild.rankId("Postulant") });
    expect((await reloadActor(db, visitor)).tier).toBe("applicant");

    await reviewApplication(db, marshal, { applicationId: app.id, decision: "accepted" });
    const accepted = await membershipOf(guild.guild.id, visitor.userId);
    expect(accepted).toMatchObject({ status: "active", rankId: guild.rankId("Squire") });
    expect((await reloadActor(db, visitor)).tier).toBe("member");

    const chars = await db.select().from(characters).where(eq(characters.membershipId, accepted!.id));
    expect(chars).toHaveLength(1);
    expect(chars[0]).toMatchObject({ name: "Joanofarc", surname: "Domremy", isMain: true, wowClass: "warrior" });
  });

  it("assigns the trial rank (Novice) when an officer requests a trial", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication);
    await reviewApplication(db, marshal, { applicationId: app.id, decision: "trial" });
    expect(await membershipOf(guild.guild.id, visitor.userId)).toMatchObject({
      status: "active",
      rankId: guild.rankId("Novice"),
    });
  });

  it("returns a declined applicant to public and allows reapplying", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication);
    await reviewApplication(db, marshal, { applicationId: app.id, decision: "declined" });
    expect((await reloadActor(db, visitor)).tier).toBe("public");
    await expect(submitApplication(db, visitor, validApplication)).resolves.toBeTruthy();
  });

  it("rejects a second pending application and double review", async () => {
    const guild = await createGuild(db);
    const marshal = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication);
    await expect(submitApplication(db, visitor, validApplication)).rejects.toBeInstanceOf(DomainError);
    await reviewApplication(db, marshal, { applicationId: app.id, decision: "declined" });
    await expect(reviewApplication(db, marshal, { applicationId: app.id, decision: "accepted" })).rejects.toBeInstanceOf(
      DomainError,
    );
  });

  it("lets an applicant withdraw", async () => {
    const guild = await createGuild(db);
    const visitor = await createVisitor(db, guild.guild.id);
    const app = await submitApplication(db, visitor, validApplication);
    await withdrawApplication(db, visitor, app.id);
    expect(await membershipOf(guild.guild.id, visitor.userId)).toMatchObject({ status: "former" });
  });

  it("validates class and spec together", async () => {
    const guild = await createGuild(db);
    const visitor = await createVisitor(db, guild.guild.id);
    await expect(submitApplication(db, visitor, { ...validApplication, spec: "Holy" })).rejects.toThrow(/especialización/);
  });

  it("asks only the Order's applicants to respect the faith", async () => {
    const unpledged = { ...validApplication, respectsFaith: undefined };
    const order = await createGuild(db);
    await expect(submitApplication(db, await createVisitor(db, order.guild.id), unpledged)).rejects.toThrow(
      "Tienes que aceptar respetar la fe y el reglamento",
    );
    const standard = await createGuildWithDefaults(db, { slug: "pledge-standard", name: "Silver Dawn", faction: "alliance", ruleset: "normal" });
    const rejected = submitApplication(db, await createVisitor(db, standard.guild.id), unpledged);
    await expect(rejected).rejects.toThrow("Tienes que aceptar cumplir el reglamento");
    await expect(rejected).rejects.not.toThrow(/faith/);
  });
});

describe("characters", () => {
  const base = { surname: "Spearwright", faction: "horde", wowClass: "paladin", spec: "Retribution", role: "melee", level: "60", professions: [] };

  it("keeps exactly one main per member", async () => {
    const guild = await createGuild(db, { faction: "horde" });
    const knight = await createMember(db, guild, "Knight");
    const first = await createCharacter(db, knight, { ...base, name: "Brigid" });
    expect(first.isMain).toBe(true);
    const second = await createCharacter(db, knight, { ...base, name: "Dismas", isMain: "on" });
    await setMainCharacter(db, knight, first.id);
    const list = await listOwnCharacters(db, knight);
    expect(list.filter((c) => c.isMain).map((c) => c.id)).toEqual([first.id]);

    await archiveCharacter(db, knight, first.id);
    const after = await listOwnCharacters(db, knight);
    expect(after.map((c) => c.id)).toEqual([second.id]);
    expect(after[0]!.isMain).toBe(true);
  });

  it("allows any class on either faction (WoW Forever has undead paladins)", async () => {
    const guild = await createGuild(db, { faction: "horde" });
    const knight = await createMember(db, guild, "Knight");
    await expect(createCharacter(db, knight, { ...base, name: "Undeadpal" })).resolves.toMatchObject({
      faction: "horde",
      wowClass: "paladin",
    });
  });

  it("requires a surname", async () => {
    const guild = await createGuild(db, { faction: "horde" });
    const knight = await createMember(db, guild, "Knight");
    await expect(createCharacter(db, knight, { ...base, surname: "", name: "Lonely" })).rejects.toThrow(/apellido/);
  });

  it("treats the full first + last name as unique", async () => {
    const guild = await createGuild(db, { faction: "horde" });
    const a = await createMember(db, guild, "Knight");
    const b = await createMember(db, guild, "Knight");
    await createCharacter(db, a, { ...base, name: "Longinus" });
    await expect(createCharacter(db, b, { ...base, name: "longinus", surname: "spearwright" })).rejects.toThrow(
      /Ya hay registrado un personaje llamado Longinus Spearwright/i,
    );
    await expect(createCharacter(db, b, { ...base, name: "Longinus", surname: "Lancebearer" })).resolves.toBeTruthy();
    await expect(createCharacter(db, b, { ...base, name: "Cassius" })).resolves.toBeTruthy();
  });

  it("cannot edit another member's character", async () => {
    const guild = await createGuild(db, { faction: "horde" });
    const a = await createMember(db, guild, "Knight");
    const b = await createMember(db, guild, "Knight");
    const char = await createCharacter(db, a, { ...base, name: "Sebastian" });
    await expect(setMainCharacter(db, b, char.id)).rejects.toThrow(/No se ha encontrado/);
  });

  it("uses the guild's faction when none is given", async () => {
    const guild = await createGuild(db, { faction: "horde" });
    const knight = await createMember(db, guild, "Knight");
    await expect(createCharacter(db, knight, { ...base, faction: "", name: "Nofaction" })).resolves.toMatchObject({
      faction: "horde",
    });
  });
});

describe("single-faction guilds", () => {
  const base = { surname: "Seraphim", wowClass: "paladin", spec: "Holy", role: "healer", level: "60", professions: [] };

  it("assigns the guild's faction to characters and rejects the other one", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const knight = await createMember(db, guild, "Knight");
    await expect(createCharacter(db, knight, { ...base, name: "Uriel" })).resolves.toMatchObject({ faction: "alliance" });
    await expect(createCharacter(db, knight, { ...base, faction: "horde", name: "Azrael" })).rejects.toThrow(
      /solo de la Alianza/,
    );
  });

  it("assigns the guild's faction to applications and the character created on acceptance", async () => {
    const guild = await createGuild(db, { faction: "alliance" });
    const officer = await createMember(db, guild, "Marshal");
    const visitor = await createVisitor(db, guild.guild.id);
    const { faction: _omit, ...withoutFaction } = validApplication;
    const app = await submitApplication(db, visitor, withoutFaction);
    expect(app.faction).toBe("alliance");
    await reviewApplication(db, officer, { applicationId: app.id, decision: "accepted" });
    const [char] = await db.select().from(characters).where(eq(characters.guildId, guild.guild.id));
    expect(char).toMatchObject({ name: validApplication.characterName, faction: "alliance" });
  });
});
