import { expect, type Locator, type Page } from "@playwright/test";

/** Signs in through the test-only credentials provider (AUTH_TEST_MODE=1). Seeded users use `seed-<name>`. */
export async function signIn(page: Page, discordId: string, name: string, callbackUrl = "/") {
  await page.context().clearCookies();
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const form = page.getByTestId("test-login-other");
  await form.getByPlaceholder("ID de Discord").fill(discordId);
  await form.getByPlaceholder("Nombre").fill(name);
  await form.getByRole("button", { name: "Entrar (prueba)" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

export function randomCharacterName(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let s = "";
  for (let i = 0; i < 8; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return `E${s}`;
}

/** A header `DropdownMenu` by its label. */
export function headerMenu(page: Page, label: string): Locator {
  return page.getByRole("banner").locator(`details:has(> summary[aria-label="${label}"])`);
}

/** Opens a `DropdownMenu` once hydrated, so its outside-click and Escape handlers are live for the next step. */
export async function openMenu(menu: Locator) {
  await expect(menu).toHaveAttribute("data-ready");
  await menu.locator(":scope > summary").click();
  await expect(menu).toHaveAttribute("open");
}

export async function expectOnPage(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

/**
 * Picks an option in a `Listbox` by its value or its exact label. Retries the opening click, since a click that lands
 * before hydration does nothing.
 */
export async function chooseOption(control: Locator, option: string) {
  const page = control.page();
  // The open listbox shares the trigger's label; pick the trigger.
  const trigger = control.and(page.locator("[data-listbox-trigger]"));
  const listbox = page.getByRole("listbox");
  await expect(async () => {
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await expect(listbox).toBeVisible({ timeout: 1000 });
  }).toPass();
  await listbox.locator(`[role="option"][data-value="${option}"]`).or(listbox.getByRole("option", { name: option, exact: true })).first().click();
  await expect(listbox).toHaveCount(0);
}
