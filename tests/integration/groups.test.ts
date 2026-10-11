import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { auditLog, characters, users } from "@/db/schema";
import type { Db } from "@/db/types";
import { handleCreateGroup, handleListGroups, handleListMembers, handleRemoveSignup, handleSignUp, handleUpdateGroup } from "@/server/bot-api";
import { createCharacter } from "@/server/services/characters";
import { actorForDiscord, createGroup, removeSignup, rosterOf, setBench, signUp, updateGroup } from "@/server/services/groups";
import { createGuild, createMember, createTestDb } from "../support/db";

let db: Db;
let close: () => Promise<void>;
let discordCounter = 900_000_000;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => close());
afterEach(() => vi.unstubAllEnvs());

const hero = {
  surname: "Whitecross",
  faction: "alliance",
  spec: "Protection",
  role: "tank",
  level: "60",
  isMain: "on",
  professions: [],
};

/** A member with a numeric Discord ID (like Discord's) and one character. */
async function memberWith(guild: Awaited<ReturnType<typeof createGuild>>, rank: string, name: string, wowClass: string) {
  const actor = await createMember(db, guild, rank);
  const discordId = String(++discordCounter);
  await db.update(users).set({ discordId }).where(eq(users.id, actor.userId));
  const character = (await createCharacter(db, actor, { ...hero, name, wowClass, spec: wowClass === "warrior" ? "Protection" : "Holy", role: wowClass === "warrior" ? "tank" : "healer" }))!;
  return { actor: await actorForDiscord(db, guild.guild.id, discordId), character, discordId };
}

const raid = { kind: "raid", instanceKey: "nucleo_magma", instanceName: "Núcleo de Magma", startsAt: "2026-11-06T19:00:00Z", tanks: 1, healers: 1, dps: 3 };

describe("groups", () => {
  it("lets members create groups and sign up with their own characters, in queue order", async () => {
    const guild = await createGuild(db);
    const leader = await memberWith(guild, "Knight", "Tor", "warrior");
    const second = await memberWith(guild, "Knight", "Godfrey", "warrior");
    const healer = await memberWith(guild, "Squire", "Agnes", "priest");

    const group = await createGroup(db, leader.actor, raid);
    expect(group).toMatchObject({ instanceName: "Núcleo de Magma", status: "open", leader: { discordId: leader.discordId } });
    await signUp(db, leader.actor, group.id, { characterId: leader.character.id, role: "tank" });
    await signUp(db, second.actor, group.id, { characterId: second.character.id, role: "tank" });
    const view = await signUp(db, healer.actor, group.id, { characterId: healer.character.id, role: "healer" });

    const roster = rosterOf(view);
    expect(roster.confirmed.tank.map((s) => s.characterName)).toEqual(["Tor Whitecross"]);
    expect(roster.confirmed.healer.map((s) => s.characterName)).toEqual(["Agnes Whitecross"]);
    expect(roster.reserves.map((s) => s.characterName)).toEqual(["Godfrey Whitecross"]);

    // Leaving frees the slot for the first on the bench.
    const after = await removeSignup(db, leader.actor, group.id, {});
    expect(rosterOf(after).confirmed.tank.map((s) => s.characterName)).toEqual(["Godfrey Whitecross"]);
  });

  it("refuses other people's characters, impossible roles, closed groups and non-members", async () => {
    const guild = await createGuild(db);
    const tor = await memberWith(guild, "Knight", "Tor", "warrior");
    const agnes = await memberWith(guild, "Squire", "Agnes", "priest");
    const group = await createGroup(db, tor.actor, raid);
    await expect(signUp(db, agnes.actor, group.id, { characterId: tor.character.id, role: "tank" })).rejects.toThrow("no es tuyo");
    await expect(signUp(db, agnes.actor, group.id, { characterId: agnes.character.id, role: "tank" })).rejects.toThrow("no puede ir de tanque");
    await updateGroup(db, guild.guild.id, tor.actor, group.id, { status: "closed" });
    await expect(signUp(db, agnes.actor, group.id, { characterId: agnes.character.id, role: "healer" })).rejects.toThrow("no están abiertas");

    const applicant = await createMember(db, guild, "Postulant", "applicant");
    await db.update(users).set({ discordId: "123456789" }).where(eq(users.id, applicant.userId));
    await expect(createGroup(db, await actorForDiscord(db, guild.guild.id, "123456789"), raid)).rejects.toThrow("Miembro");
    await expect(actorForDiscord(db, guild.guild.id, "555555555")).rejects.toThrow("entra en la web");
  });

  it("lets only the leader or an officer manage a group, and audits officers acting on others' groups", async () => {
    const guild = await createGuild(db);
    const tor = await memberWith(guild, "Knight", "Tor", "warrior");
    const agnes = await memberWith(guild, "Squire", "Agnes", "priest");
    const marshal = await memberWith(guild, "Marshal", "Ironvow", "warrior");
    const group = await createGroup(db, tor.actor, raid);
    await signUp(db, agnes.actor, group.id, { characterId: agnes.character.id, role: "healer" });

    await expect(updateGroup(db, guild.guild.id, agnes.actor, group.id, { status: "cancelled" })).rejects.toThrow("Solo el líder");
    await expect(removeSignup(db, agnes.actor, group.id, { targetDiscordId: tor.discordId })).rejects.toThrow("Solo el líder");

    const benched = await setBench(db, tor.actor, group.id, { targetDiscordId: agnes.discordId });
    expect(rosterOf(benched).reserves.map((s) => s.characterName)).toEqual(["Agnes Whitecross"]);
    await removeSignup(db, marshal.actor, group.id, { targetDiscordId: agnes.discordId });
    const cancelled = await updateGroup(db, guild.guild.id, marshal.actor, group.id, { status: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    const actions = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.guildId, guild.guild.id));
    expect(actions.map((a) => a.action)).toEqual(expect.arrayContaining(["group.remove_signup", "group.cancelled"]));
  });

  it("lets the bot on its own only record the message, the reminder and the end", async () => {
    const guild = await createGuild(db);
    const tor = await memberWith(guild, "Knight", "Tor", "warrior");
    const group = await createGroup(db, tor.actor, raid);
    const updated = await updateGroup(db, guild.guild.id, null, group.id, { discordChannelId: "111111111", discordMessageId: "222222222", reminded: true });
    expect(updated).toMatchObject({ discordChannelId: "111111111", discordMessageId: "222222222" });
    expect(updated.remindedAt).toBeInstanceOf(Date);
    await expect(updateGroup(db, guild.guild.id, null, group.id, { status: "cancelled" })).rejects.toThrow("Solo el líder");
    expect((await updateGroup(db, guild.guild.id, null, group.id, { status: "finished" })).status).toBe("finished");
  });
});

describe("/api/bot", () => {
  const call = (method: string, path: string, body: unknown, token = "bot-secret") =>
    new Request(`http://localhost:3000${path}${method === "GET" ? `?${new URLSearchParams(body as Record<string, string>)}` : ""}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: method === "GET" ? undefined : JSON.stringify(body),
    });

  it("does not exist without BOT_API_TOKEN, and refuses a wrong key", async () => {
    vi.stubEnv("BOT_API_TOKEN", "");
    expect((await handleListGroups(db, call("GET", "/api/bot/groups", { guild: "x" }))).status).toBe(404);
    expect((await handleListMembers(db, call("GET", "/api/bot/members", { guild: "x" }))).status).toBe(404);
    vi.stubEnv("BOT_API_TOKEN", "bot-secret");
    expect((await handleListGroups(db, call("GET", "/api/bot/groups", { guild: "x" }, "otra"))).status).toBe(404);
    expect((await handleListMembers(db, call("GET", "/api/bot/members", { guild: "x" }, "otra"))).status).toBe(404);
  });

  it("gives the bot the active members' Discord IDs, tiers and characters, and nothing else", async () => {
    vi.stubEnv("BOT_API_TOKEN", "bot-secret");
    const guild = await createGuild(db);
    const tor = await memberWith(guild, "Marshal", "Tor", "warrior");
    const agnes = await memberWith(guild, "Squire", "Agnes", "priest");
    await createMember(db, guild, "Postulant", "applicant");
    await createMember(db, guild, "Knight", "former");
    const old = (await createCharacter(db, (await actorForDiscord(db, guild.guild.id, agnes.discordId)), { ...hero, name: "Vieja", wowClass: "priest", spec: "Holy", role: "healer", isMain: "" }))!;
    await db.update(characters).set({ archivedAt: new Date() }).where(eq(characters.id, old.id));
    const elsewhere = await createGuild(db);
    await memberWith(elsewhere, "Knight", "Ajeno", "warrior");

    const res = await handleListMembers(db, call("GET", "/api/bot/members", { guild: guild.guild.slug }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { guild: { slug: string }; members: { discordId: string; tier: string; characters: { fullName: string }[] }[] };
    expect(body.guild.slug).toBe(guild.guild.slug);
    expect(body.members.map((m) => m.discordId).sort()).toEqual([tor.discordId, agnes.discordId].sort());
    const torView = body.members.find((m) => m.discordId === tor.discordId)!;
    expect(torView).toMatchObject({ tier: "officer", characters: [{ fullName: "Tor Whitecross", class: "warrior", role: "tank", level: 60, isMain: true }] });
    expect(body.members.find((m) => m.discordId === agnes.discordId)!.characters.map((c) => c.fullName)).toEqual(["Agnes Whitecross"]);
    // No e-mail, display name or site user id ever leaves the site.
    expect(JSON.stringify(body)).not.toMatch(/email|"userId"|User \d+/);
  });

  it("runs a whole group for the bot", async () => {
    vi.stubEnv("BOT_API_TOKEN", "bot-secret");
    const guild = await createGuild(db);
    const slug = guild.guild.slug;
    const tor = await memberWith(guild, "Knight", "Tor", "warrior");
    const agnes = await memberWith(guild, "Squire", "Agnes", "priest");

    const created = await handleCreateGroup(db, call("POST", "/api/bot/groups", { guild: slug, actorDiscordId: tor.discordId, ...raid, startsAt: new Date(Date.now() + 3_600_000).toISOString() }));
    expect(created.status).toBe(201);
    const { group } = (await created.json()) as { group: { id: string } };

    const joined = await handleSignUp(db, call("POST", `/api/bot/groups/${group.id}/signups`, { guild: slug, actorDiscordId: agnes.discordId, characterId: agnes.character.id, role: "healer" }), group.id);
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ group: { signups: [{ characterName: "Agnes Whitecross", role: "healer", discordId: agnes.discordId }] } });

    const wrongRole = await handleSignUp(db, call("POST", `/api/bot/groups/${group.id}/signups`, { guild: slug, actorDiscordId: agnes.discordId, characterId: agnes.character.id, role: "tank" }), group.id);
    expect(wrongRole.status).toBe(400);
    expect(((await wrongRole.json()) as { error: string }).error).toContain("no puede ir de tanque");

    const notLinked = await handleSignUp(db, call("POST", `/api/bot/groups/${group.id}/signups`, { guild: slug, actorDiscordId: "999999999999", characterId: agnes.character.id, role: "healer" }), group.id);
    expect(notLinked.status).toBe(401);

    const attached = await handleUpdateGroup(db, call("PATCH", `/api/bot/groups/${group.id}`, { guild: slug, discordChannelId: "111111111", discordMessageId: "222222222" }), group.id);
    expect(attached.status).toBe(200);

    const list = await handleListGroups(db, call("GET", "/api/bot/groups", { guild: slug }));
    expect(((await list.json()) as { groups: { id: string }[] }).groups.map((g) => g.id)).toEqual([group.id]);

    const left = await handleRemoveSignup(db, call("DELETE", `/api/bot/groups/${group.id}/signups`, { guild: slug, actorDiscordId: agnes.discordId }), group.id);
    expect(((await left.json()) as { group: { signups: unknown[] } }).group.signups).toEqual([]);

    expect((await handleUpdateGroup(db, call("PATCH", `/api/bot/groups/not-a-uuid`, { guild: slug }), "not-a-uuid")).status).toBe(404);
  });
});
