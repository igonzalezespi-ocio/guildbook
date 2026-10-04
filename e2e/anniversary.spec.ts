import { expect, type Page, test } from "@playwright/test";
import { chooseOption } from "./helpers";

// Runs against BATTLENET_MOCK=1. The mock gives an account TBC Anniversary role characters by Discord ID (see
// src/server/blizzard/mock.ts): `ann-gm` Thranduil, Guild Master of <Mirkwood>, and `ann-member` Mattaeis, rank 3 of it,
// both on Dreamscythe; `ann-realm` Galadhon, Guild Master of a <Mirkwood> on Nightslayer. `ann-guild-<tag>` names the
// guild <Mirkwood tag>, so every run gets its own guild identity.

const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://localhost:${PORT}`;
const guildOrigin = (slug: string) => `http://${slug}.localhost:${PORT}`;
/** Set to a folder to save the screenshots that document these flows (desktop project only). */
const SHOTS = process.env.E2E_SCREENSHOTS;

function uniqueTag() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

/** Signs in on the apex as `discordId` and creates a Horde TBC Anniversary guild named `Mirkwood <tag>` on `realm`. */
async function createAnniversaryGuild(page: Page, roles: string, realm = "dreamscythe") {
  const tag = uniqueTag();
  const name = `Mirkwood ${tag}`;
  const slug = `e2e-mirkwood-${tag}`;
  await page.context().clearCookies();
  await page.goto(`${APEX}/login?callbackUrl=${encodeURIComponent("/create")}`);
  const form = page.getByTestId("test-login-other");
  await form.getByPlaceholder("ID de Discord").fill(`e2e-${roles}-ann-guild-${tag}`);
  await form.getByPlaceholder("Nombre").fill(`Founder ${tag}`);
  await form.getByRole("button", { name: "Entrar (prueba)" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await chooseOption(page.getByLabel("Versión del juego"), "anniversary");
  await page.getByLabel("Nombre de la hermandad").fill(name);
  await page.getByLabel("Subdominio").fill(slug);
  await expect(page.getByTestId("slug-status")).toHaveText("Disponible");
  await page.getByLabel(/^América/).check();
  await chooseOption(page.getByLabel("Reino", { exact: true }), realm);
  await page.getByLabel("Horda").check();
  await page.getByRole("button", { name: "Crear hermandad" }).click();
  const site = guildOrigin(slug);
  await page.waitForURL(`${site}/admin/setup`);
  return { name, site, tag };
}

async function linkBattlenet(page: Page, site: string) {
  await page.goto(`${site}/members/characters`);
  await page.getByRole("link", { name: "Vincular Battle.net" }).click();
  await expect(page.getByTestId("battlenet-account")).toContainText(/Pilgrim#\d{4}/);
}

async function importCharacter(page: Page, name: string, spec: string, role: string) {
  const main = page.getByRole("main");
  const details = main.locator("details", { has: page.getByTestId("import-version-heading") });
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  const row = details.locator("li", { hasText: name });
  await chooseOption(row.getByLabel(`${name} spec`), spec);
  await chooseOption(row.getByLabel(`${name} role`), role);
  await row.getByRole("button", { name: "Import" }).click();
  await expect(row.getByText(`Imported as ${name}`)).toBeVisible();
}

async function checkVerification(page: Page, site: string) {
  await page.goto(`${site}/admin/guild`);
  const panel = page.getByTestId("verify-guild");
  await panel.getByRole("button", { name: /^(Check verification|Check again)$/ }).click();
  return panel;
}

test.describe("TBC Anniversary", () => {
  test("the in-game Guild Master verifies, and a character in the guild shows as a verified member", async ({ page }, info) => {
    const shoot = SHOTS && info.project.name === "desktop";
    const { name, site } = await createAnniversaryGuild(page, "ann-gm-ann-member");
    await linkBattlenet(page, site);

    const heading = page.getByTestId("import-version-heading");
    await expect(heading).toHaveText("TBC Anniversary characters on Dreamscythe (US)");
    const main = page.getByRole("main");
    await expect(main.getByText("Thranduil", { exact: true })).toBeVisible();
    await expect(main.getByText("Mattaeis", { exact: true })).toBeVisible();
    // Forever characters stay on the account for Forever guilds; the Alliance Anniversary character isn't offered.
    await expect(page.getByTestId("other-version-characters")).toContainText("WoW: Forever");
    await expect(main.getByText("Elowen", { exact: true })).toHaveCount(0);
    await expect(main.getByText("Aldric", { exact: true })).toHaveCount(0);

    const panel = await checkVerification(page, site);
    await expect(panel.getByRole("status").filter({ hasText: "Your guild is verified." })).toBeVisible();
    await expect(panel.getByText(/Thranduil is the in-game Guild Master/)).toBeVisible();
    await expect(page.getByRole("banner").getByTestId("verified-seal")).toBeVisible();
    await expect(panel).toContainText(`named exactly ${name}, Horde, on Dreamscythe (US)`);
    if (shoot) await panel.locator("xpath=ancestor::section[1]").screenshot({ path: `${SHOTS}/anniversary-verify-panel.png` });

    await page.goto(`${site}/members/characters`);
    await importCharacter(page, "Mattaeis", "Beast Mastery", "ranged");
    const card = page.getByRole("main").locator("li", { has: page.getByTestId("guild-member-tag") }).filter({ hasText: "Mattaeis" });
    await expect(card.getByTestId("guild-member-tag")).toHaveText("Miembro verificado");
    if (shoot) await page.screenshot({ path: `${SHOTS}/anniversary-my-characters.png`, fullPage: true });
  });

  test("a founder who is a member but not the Guild Master gets the Guild Master note and an invite link", async ({ page }, info) => {
    const shoot = SHOTS && info.project.name === "desktop";
    const { site } = await createAnniversaryGuild(page, "ann-member");
    await linkBattlenet(page, site);
    await importCharacter(page, "Mattaeis", "Survival", "ranged");
    // The guild isn't verified yet, so no one shows as a verified member.
    await expect(page.getByTestId("guild-member-tag")).toHaveCount(0);

    const panel = await checkVerification(page, site);
    await expect(panel.getByTestId("verify-result")).toContainText(/isn't its Guild Master \(rank 3\)/);
    await expect(panel.getByTestId("verify-founder-not-gm")).toContainText("Mattaeis is in");

    await page.goto(`${site}/admin/setup`);
    const note = page.getByTestId("founder-not-gm");
    await expect(note).toContainText("Mattaeis is in");
    await expect(note).toContainText("(rank 3), but isn't its Guild Master");
    await expect(page.getByTestId("founder-invite")).toContainText("/apply?invite=");
    if (shoot) await note.locator("xpath=ancestor::section[1]").screenshot({ path: `${SHOTS}/anniversary-founder-not-gm.png` });
  });

  test("a Guild Master of the same-named guild on another realm is refused with a realm mismatch", async ({ page }) => {
    const { site } = await createAnniversaryGuild(page, "ann-realm");
    await linkBattlenet(page, site);
    // Galadhon is on Nightslayer, not the guild's realm, so there is nothing to import here.
    await expect(page.getByRole("main").getByText("Galadhon", { exact: true })).toHaveCount(0);

    const panel = await checkVerification(page, site);
    const result = panel.getByTestId("verify-result");
    await expect(result).toContainText("Nightslayer");
    await expect(result).toContainText("Dreamscythe");
    await expect(page.getByRole("banner").getByTestId("verified-seal")).toHaveCount(0);
  });

  test("a member of the verified in-game guild joins in one click after accepting the charter", async ({ page }, info) => {
    const shoot = SHOTS && info.project.name === "desktop";
    const { site, tag } = await createAnniversaryGuild(page, "ann-gm");
    await linkBattlenet(page, site);
    const verify = await checkVerification(page, site);
    await expect(verify.getByRole("status").filter({ hasText: "Your guild is verified." })).toBeVisible();

    // Automatic approval is on by default and joins at the accepted-applicant rank.
    const setting = page.getByTestId("auto-approve-toggle");
    await expect(setting).toBeChecked();
    const panel = setting.locator("xpath=ancestor::section[1]");
    await expect(panel.getByLabel("Rank they join at")).toContainText("Same as accepted applicants");
    if (shoot) await panel.screenshot({ path: `${SHOTS}/confirmed-join-setting.png` });

    // The guild is still a draft, so the member comes in through the private invite link.
    await page.goto(`${site}/admin/setup`);
    await page.getByRole("button", { name: "Create invite link" }).click();
    const invite = (await page.getByTestId("draft-invite").locator(".font-mono").textContent())!.trim();

    await page.context().clearCookies();
    await page.goto(`${APEX}/login?callbackUrl=${encodeURIComponent(invite)}`);
    const form = page.getByTestId("test-login-other");
    await form.getByPlaceholder("ID de Discord").fill(`e2e-ann-member-ann-guild-${tag}`);
    await form.getByPlaceholder("Nombre").fill(`Member ${tag}`);
    await form.getByRole("button", { name: "Entrar (prueba)" }).click();
    await page.waitForURL((url) => url.pathname === "/apply");
    await page.getByRole("link", { name: "Vincular Battle.net" }).click();
    await expect(page.getByTestId("battlenet-account")).toContainText(/Pilgrim#\d{4}/);

    const join = page.getByTestId("confirmed-join");
    await expect(join).toContainText("Mattaeis");
    await expect(join).toContainText(`<Mirkwood ${tag}>`);
    await expect(page.getByText("Or send an application for review instead")).toBeVisible();
    await chooseOption(join.getByLabel("Especialización"), "Marksmanship");
    await chooseOption(join.getByLabel("Rol en banda"), "ranged");
    if (shoot) await join.locator("xpath=ancestor::section[1]").screenshot({ path: `${SHOTS}/confirmed-join-offer.png` });

    // The charter must be accepted first.
    await join.getByRole("button", { name: "Entrar como miembro" }).click();
    await expect(page).toHaveURL(/\/apply/);
    await join.getByTestId("confirmed-join-charter").check();
    await join.getByRole("button", { name: "Entrar como miembro" }).click();
    await page.waitForURL(`${site}/members`);
    await expect(page.getByText(/Welcome to Mirkwood .*Mattaeis joined as/).first()).toBeVisible();

    await page.goto(`${site}/members/characters`);
    const card = page.getByRole("main").locator("li", { has: page.getByTestId("guild-member-tag") }).filter({ hasText: "Mattaeis" });
    await expect(card.getByTestId("guild-member-tag")).toHaveText("Miembro verificado");
  });
});
