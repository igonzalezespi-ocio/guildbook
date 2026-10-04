import { expect, type Page, test } from "@playwright/test";
import { chooseOption, headerMenu, openMenu } from "./helpers";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://localhost:${PORT}`;
const guildOrigin = (slug: string) => `http://${slug}.localhost:${PORT}`;

async function signInOnApex(page: Page, discordId: string, name: string, callbackUrl: string) {
  await page.context().clearCookies();
  await page.goto(`${APEX}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const form = page.getByTestId("test-login-other");
  await form.getByPlaceholder("ID de Discord").fill(discordId);
  await form.getByPlaceholder("Nombre").fill(name);
  await form.getByRole("button", { name: "Entrar (prueba)" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("Support", () => {
  test("signed out, the page asks for Discord sign-in and offers an email fallback", async ({ page, request }) => {
    await page.context().clearCookies();
    await page.goto(`${APEX}/support`);
    const prompt = page.getByTestId("support-signed-out");
    await expect(prompt.getByRole("button", { name: "Iniciar sesión con Discord" })).toBeVisible();
    await expect(page.getByTestId("support-fallback")).toContainText("matt.rosendin@gmail.com");
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Soporte" })).toHaveAttribute("href", "/support");

    // Guild sites link to the apex page, and send /support there with its query.
    await page.goto(`${guildOrigin("osm")}/`);
    await expect(page.getByRole("contentinfo").getByRole("link", { name: "Support" })).toHaveAttribute("href", `${APEX}/support`);
    const res = await request.get(`${APEX}/support?category=vigil`, { maxRedirects: 0, headers: { host: `osm.localhost:${PORT}` } });
    expect([307, 308]).toContain(res.status());
    expect(res.headers().location).toMatch(/\/support\?category=vigil$/);
  });

  test("a member sends a ticket about their guild and gets a reference", async ({ page }) => {
    await signInOnApex(page, "seed-tor", "Tor", `${APEX}/support`);
    await expect(page.getByRole("heading", { name: "Soporte", level: 1 })).toBeVisible();

    const menu = headerMenu(page, "Menú de la cuenta de Tor");
    await openMenu(menu);
    await expect(menu.getByRole("link", { name: "Ayuda y soporte" })).toHaveAttribute("href", "/support");
    await page.keyboard.press("Escape");

    await chooseOption(page.getByLabel("Categoría", { exact: true }), "bug");
    // Guild options are keyed by id and described by rank, so pick by visible name.
    await page.getByLabel("Hermandad relacionada").and(page.locator("[data-listbox-trigger]")).click();
    await page.getByRole("listbox").getByRole("option", { name: /^Order of Saint Michael/ }).click();
    await expect(page.getByTestId("support-guild")).toContainText("Order of Saint Michael");
    await page.getByLabel("Asunto").fill("Roster shows the wrong rank");
    await page.getByLabel("Mensaje").fill("Too short");
    await page.getByLabel("Correo de respuesta").fill("");
    await page.getByRole("button", { name: "Enviar solicitud" }).click();

    const message = page.getByLabel("Mensaje");
    await expect(message).toHaveAttribute("aria-invalid", "true");
    await expect(message).toBeFocused();
    await expect(page.getByTestId("form-error-summary")).toContainText("Mensaje:");

    await message.fill("My knight shows as a postulant on the roster since I changed my main character yesterday.");
    await page.getByRole("button", { name: "Enviar solicitud" }).click();

    await expect(page).toHaveURL(/\/support\?ticket=[0-9a-f-]{36}$/);
    const success = page.getByTestId("support-success");
    await expect(page.getByTestId("support-reference")).toHaveText(/^GB-[0-9A-F]{8}$/);
    await expect(success).toContainText("Roster shows the wrong rank");
    await expect(success).toContainText("te responderemos por Discord a @tor");
  });

  test("a user without guilds can prefill a category from a help link and leave an email", async ({ page }) => {
    const id = `support-${Date.now().toString(36)}`;
    await signInOnApex(page, id, "Wanderer", `${APEX}/support?category=vigil`);
    await expect(page.getByTestId("support-category")).toContainText("App de escritorio Vigil");
    await expect(page.getByTestId("support-guild")).toHaveCount(0);

    await page.getByLabel("Asunto").fill("Pairing code rejected");
    await page.getByLabel("Mensaje").fill("The companion app says my pairing code is invalid every time I paste it.");
    await page.getByLabel("Correo de respuesta").fill("wanderer@example.com");
    await page.getByRole("button", { name: "Enviar solicitud" }).click();

    await expect(page.getByTestId("support-success")).toContainText("Te responderemos por correo a wanderer@example.com");
  });
});
