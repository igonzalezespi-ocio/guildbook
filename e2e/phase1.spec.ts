import { expect, type Page, test } from "@playwright/test";
import { chooseOption, headerMenu, openMenu, randomCharacterName, signIn } from "./helpers";

test.describe("public pages", () => {
  test("home shows the guild, motto, schedule and recruitment", async ({ page, isMobile }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Order of Saint Michael" })).toBeVisible();
    await expect(page.getByText("Quis ut Deus").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Horario de bandas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reclutamiento" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Únete a la Orden" })).toBeVisible();
    if (isMobile) await openMenu(headerMenu(page, "Menú"));
    await expect(page.getByRole("banner").getByRole("link", { name: "Únete", exact: true }).filter({ visible: true })).toBeVisible();
    if (isMobile) await page.keyboard.press("Escape");

    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("heading", { name: "Noches de banda" })).toBeVisible();
    await expect(footer.getByText("Martes")).toBeVisible();
    await expect(footer.getByRole("link", { name: "Oración a san Miguel" })).toBeVisible();
  });

  test("roster groups mains by class without faction filters in an Alliance-only guild", async ({ page }) => {
    await page.goto("/roster");
    await expect(page.getByRole("heading", { name: /Paladin/ })).toBeVisible();
    await expect(page.getByText("Tor Whitecross", { exact: true })).toBeVisible();
    await expect(page.getByText("Brigid Hearthfire", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Horde" })).toHaveCount(0);
    await expect(page.getByText("Horde", { exact: true })).toHaveCount(0);
  });

  test("mobile menu closes on outside click, Escape and navigation", async ({ page, isMobile }) => {
    test.skip(!isMobile, "The menu only renders below the xl breakpoint");
    await page.goto("/");
    const menu = headerMenu(page, "Menú");

    await openMenu(menu);
    await page.getByRole("main").click({ position: { x: 5, y: 5 } });
    await expect(menu).not.toHaveAttribute("open");

    await openMenu(menu);
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open");

    await openMenu(menu);
    await menu.getByRole("link", { name: "Plantilla" }).click();
    await expect(page).toHaveURL(/\/roster$/);
    await expect(menu).not.toHaveAttribute("open");
  });

  test("charter includes the Prayer to Saint Michael", async ({ page }) => {
    await page.goto("/charter");
    await expect(page.getByRole("heading", { name: "Prayer to Saint Michael" })).toBeVisible();
    await expect(page.getByText(/defend us in battle/).first()).toBeVisible();
  });

  test("charter shows every rank with its insignia", async ({ page }) => {
    await page.goto("/charter");
    const ranks = page.locator("#ranks");
    await expect(ranks.getByRole("heading", { name: "Rangos de la Orden" })).toBeVisible();
    await expect(ranks.getByRole("heading", { level: 3 })).toHaveCount(10);
    await expect(ranks.getByRole("listitem").filter({ hasText: "Grand Master" }).locator("svg")).toBeVisible();
  });

  test("progression lists raids and kill dates", async ({ page }) => {
    await page.goto("/progression");
    await expect(page.getByRole("heading", { name: "Molten Core" })).toBeVisible();
    const ragnaros = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Ragnaros", exact: true }) });
    await expect(ragnaros).toContainText("26 ene 2027");
    const onyxia = page.getByRole("row").filter({ has: page.getByRole("cell", { name: "Onyxia", exact: true }) });
    await expect(onyxia).toContainText("8 dic 2026");
  });
});

/** Opens the header menu that holds the account card: the Menu on mobile, the Account dropdown on desktop. */
async function openAccountCard(page: Page, isMobile: boolean) {
  const menu = headerMenu(page, isMobile ? "Menú" : "Cuenta");
  await openMenu(menu);
  return menu.getByTestId("account-card");
}

test("the account card shows the main character, level, rank and a separate sign out row", async ({ page, isMobile }) => {
  await signIn(page, "seed-tor", "Tor", "/roster");
  if (!isMobile) {
    const trigger = page.getByRole("banner").locator('summary[aria-label="Cuenta"]');
    await expect(trigger).toContainText("Tor Whitecross");
    await expect(trigger).toContainText("Grand Master");
  }

  const card = await openAccountCard(page, isMobile);
  await expect(card.getByText("Tor Whitecross", { exact: true })).toBeVisible();
  await expect(card.getByText("Paladín Sagrado de nivel 60", { exact: true })).toBeVisible();
  await expect(card.getByText("Grand Master", { exact: true })).toBeVisible();
  await expect(card.locator("svg").first()).toBeVisible();

  const signOut = page.getByRole("banner").getByRole("button", { name: "Cerrar sesión" }).filter({ visible: true });
  await expect(signOut).toBeVisible();
  const cardBox = (await card.boundingBox())!;
  const signOutBox = (await signOut.boundingBox())!;
  expect(signOutBox.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height);

  await expect(page.getByRole("banner").getByRole("link", { name: "Únete", exact: true })).toHaveCount(0);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: "Únete", exact: true })).toHaveCount(0);

  await card.getByRole("link", { name: /Tor Whitecross/ }).click();
  await expect(page).toHaveURL(/\/roster\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("main").getByText("Tor Whitecross").first()).toBeVisible();
});

test("a tester already signed in with a mistyped ID can switch to seed-tor from the login page", async ({ page, isMobile }) => {
  await signIn(page, `e2e-typo-${randomCharacterName().toLowerCase()}`, "Typo");

  await page.goto("/login");
  const form = page.getByTestId("test-login");
  await expect(form.getByTestId("test-login-current")).toContainText("Sesión iniciada como Typo");
  await expect(form.locator("datalist")).toHaveCount(0);
  await form.getByRole("button", { name: "Tor Whitecross, Grand Master (seed-tor)" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  const card = await openAccountCard(page, isMobile);
  await expect(card.getByText("Tor Whitecross", { exact: true })).toBeVisible();
  await expect(card.getByText("Paladín Sagrado de nivel 60", { exact: true })).toBeVisible();
  await expect(card.getByText("Grand Master", { exact: true })).toBeVisible();
  await expect(card.locator("svg").first()).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Únete", exact: true })).toHaveCount(0);
});

test("the test login quick-pick lists seeded accounts and signs in a fresh recruit in one click", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/login");
  const accounts = page.getByTestId("test-login-accounts");
  await expect(accounts.getByRole("button", { name: "Ironvow Thornwall, Marshal (seed-ironvow)" })).toBeVisible();
  await expect(accounts.getByRole("button", { name: /^Francis Greyfriar, .+ \(seed-francis\)$/ })).toBeVisible();

  const recruit = accounts.getByRole("button", { name: /^Nuevo recluta, Cuenta sin usar \(recruit-\d+\)$/ });
  const recruitId = (await recruit.getAttribute("aria-label"))!.match(/recruit-(\d+)/)![1];
  await recruit.click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  await page.goto("/login");
  await expect(page.getByTestId("test-login-current")).toContainText(`Sesión iniciada como Recruit ${recruitId}.`);
  const nextLabel = await accounts.getByRole("button", { name: /^Nuevo recluta, / }).getAttribute("aria-label");
  expect(Number(nextLabel!.match(/recruit-(\d+)/)![1])).toBeGreaterThan(Number(recruitId));
});

test("apply, officer accepts, new member appears on the roster", async ({ page, isMobile }) => {
  const characterName = randomCharacterName();
  const applicantId = `e2e-${characterName.toLowerCase()}`;

  await page.goto("/apply");
  await expect(page.getByRole("link", { name: "Inicia sesión con Discord para solicitar" })).toBeVisible();

  await signIn(page, applicantId, characterName, "/apply");
  const charterLine = page.getByText("before applying.");
  await expect(charterLine).toBeVisible();
  await page.getByLabel("Nombre", { exact: true }).fill(characterName);
  await page.getByLabel("Apellido").fill("Faithful");
  await expect(page.getByLabel("Facción", { exact: true })).toHaveCount(0);
  await chooseOption(page.getByLabel("Clase", { exact: true }), "paladin");
  await chooseOption(page.getByLabel("Especialización", { exact: true }), "Protection");
  await chooseOption(page.getByLabel("Rol en banda", { exact: true }), "tank");
  await page.getByLabel("Experiencia en bandas").fill("Main tank through Naxxramas in Classic Era.");
  await page.getByLabel("Disponibilidad").fill("Sundays 7-10 PM Eastern.");
  await page.getByLabel("¿Por qué Order of Saint Michael?").fill("A guild that raids well and keeps the faith.");
  await page.getByLabel("Usuario de Discord").fill(characterName.toLowerCase());
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enviar solicitud" }).click();
  await expect(page.getByRole("heading", { name: "Tu solicitud" })).toBeInViewport();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(charterLine).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retirar solicitud" })).toBeVisible();

  const applicantCard = await openAccountCard(page, isMobile);
  await expect(applicantCard.getByText(characterName, { exact: true })).toBeVisible();
  await expect(applicantCard.getByRole("link", { name: "Solicitud pendiente" })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Únete", exact: true })).toHaveCount(0);

  // The applicant cannot reach the admin area.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/denied/);

  await signIn(page, "seed-ironvow", "Ironvow", "/admin/applications");
  await page.getByRole("link", { name: new RegExp(characterName) }).click();
  await page.getByRole("button", { name: "Aceptar como miembro" }).click();
  await expect(page.getByText(/aceptada el/)).toBeVisible();
  const toast = page.getByRole("status").filter({ hasText: `${characterName} Faithful aceptado como` });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-testid", "toast");

  await page.goto("/admin/audit");
  await expect(page.getByText("application.accept").first()).toBeVisible();

  await signIn(page, applicantId, characterName, "/members/characters");
  await expect(page.getByRole("main").getByText(`${characterName} Faithful`, { exact: true })).toBeVisible();
  await expect(page.getByText("Principal", { exact: true })).toBeVisible();

  await page.goto("/roster");
  await expect(page.getByRole("main").getByText(`${characterName} Faithful`, { exact: true })).toBeVisible();
});

test("raiders are refused the admin area", async ({ page }) => {
  await signIn(page, "seed-cassian", "Cassian");
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/denied/);
  await page.goto("/admin/ranks");
  await expect(page).toHaveURL(/\/denied/);
});

test("the Grand Master changes a rank's insignia", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/admin/ranks");
  await expect(page.getByRole("banner").locator('svg[viewBox="0 0 80 80"]').first()).toBeAttached();

  const squire = () => page.getByRole("listitem").filter({ has: page.getByText(/^\d+\. Squire$/) });
  const option = (label: string) => squire().locator("label").filter({ hasText: new RegExp(`^${label}$`) });
  await option("Vela").click();
  await expect(squire().getByLabel("Vela", { exact: true })).toBeChecked();
  await squire().getByRole("button", { name: "Guardar" }).click();
  await expect(squire().getByText("Guardado.")).toBeVisible();
  await page.reload();
  await expect(squire().getByLabel("Vela", { exact: true })).toBeChecked();

  await option("Yelmo").click();
  await squire().getByRole("button", { name: "Guardar" }).click();
  await expect(squire().getByText("Guardado.")).toBeVisible();
});

test("a member registers an alt and makes it their main", async ({ page }) => {
  const alt = randomCharacterName();
  await signIn(page, "seed-perpetua", "Perpetua", "/members/characters");
  await page.getByRole("link", { name: "Registrar personaje" }).click();
  await page.getByLabel("Nombre", { exact: true }).fill(alt);
  await page.getByLabel("Apellido").fill("Oakenfield");
  await chooseOption(page.getByLabel("Clase", { exact: true }), "hunter");
  await chooseOption(page.getByLabel("Especialización", { exact: true }), "Beast Mastery");
  await chooseOption(page.getByLabel("Rol en banda", { exact: true }), "ranged");
  await page.getByLabel("Nivel", { exact: true }).fill("60");
  await page.getByRole("checkbox", { name: "Herbalism" }).check();
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page).toHaveURL(/\/members\/characters$/);
  // The action redirects, so the toast rides a flash cookie to the next page.
  await expect(page.getByTestId("toast").filter({ hasText: `${alt} Oakenfield added to your characters.` })).toBeVisible();

  const card = page.getByRole("main").locator("li", { hasText: alt });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Hacer principal" }).click();
  await expect(card.getByText("Principal", { exact: true })).toBeVisible();
});
