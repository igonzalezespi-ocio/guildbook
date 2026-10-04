import { expect, type Page, test } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://localhost:${PORT}`;
const guildOrigin = (slug: string) => `http://${slug}.localhost:${PORT}`;

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

async function signInOnApex(page: Page, discordId: string, name: string, callbackUrl: string) {
  await page.context().clearCookies();
  await page.goto(`${APEX}/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const form = page.getByTestId("test-login-other");
  await form.getByPlaceholder("ID de Discord").fill(discordId);
  await form.getByPlaceholder("Nombre").fill(name);
  await form.getByRole("button", { name: "Entrar (prueba)" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("Legal pages", () => {
  test("terms and privacy render on the apex with their operator details and cross-links", async ({ page }) => {
    await page.goto(`${APEX}/terms`);
    await expect(page.getByRole("heading", { name: "Términos del servicio", level: 1 })).toBeVisible();
    await expect(page.getByTestId("legal-body")).toContainText("matt.rosendin@gmail.com");
    await expect(page.getByTestId("legal-body")).toContainText("Estado de California");
    await expect(page.getByTestId("legal-body")).not.toContainText("[");

    await page.goto(`${APEX}/privacy`);
    await expect(page.getByRole("heading", { name: "Política de privacidad", level: 1 })).toBeVisible();
    const body = page.getByTestId("legal-body");
    await expect(body).toContainText("Matthew Rosendin");
    await expect(body).not.toContainText("PLACEHOLDER");
    await expect(body).toContainText("No guardamos los tokens de acceso ni de actualización de Discord.");
    await expect(body).toContainText(/se borran automáticamente \d+ días/);
    await expect(body).not.toContainText("{{");

    const footer = page.getByRole("contentinfo").getByRole("navigation", { name: "Legal" });
    await expect(footer.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
    await expect(footer.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    await expect(footer.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute("href", "https://github.com/Guildbook/guildbook");
  });

  test("guild sites link to the apex policies and send /terms there", async ({ page, request }) => {
    await page.goto(`${guildOrigin("osm")}/`);
    const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Legal" });
    await expect(legal.getByRole("link", { name: "Terms" })).toHaveAttribute("href", `${APEX}/terms`);
    await expect(legal.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", `${APEX}/privacy`);
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Guildbook", exact: true })).toHaveAttribute("href", APEX);
    await expect(footer.getByRole("link", { name: "Guildbook source on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/Guildbook/guildbook",
    );

    // Node doesn't resolve *.localhost the way Chromium does, so name the guild host in the header.
    const res = await request.get(`${APEX}/terms`, { maxRedirects: 0, headers: { host: `osm.localhost:${PORT}` } });
    expect([307, 308]).toContain(res.status());
    expect(res.headers().location).toMatch(/\/terms$/);
  });

  test("the sign-in page shows the consent line", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${APEX}/login`);
    const consent = page.getByTestId("legal-consent");
    await expect(consent).toContainText("Al iniciar sesión aceptas los Términos del servicio y la Política de privacidad de Guildbook.");
    await expect(consent.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", /\/terms$/);
    await expect(consent.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", /\/privacy$/);
  });
});

test.describe("Account and privacy", () => {
  test("export my data, then delete the account after typing the name", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `Leaver ${suffix}`;
    await page.goto(`${APEX}/account`);
    await expect(page).toHaveURL(new RegExp(`^${APEX}/login`));

    await signInOnApex(page, `e2e-leaver-${suffix}`, name, "/account");
    await expect(page).toHaveURL(`${APEX}/account`);
    await expect(page.getByRole("heading", { name: "Account and privacy" })).toBeVisible();

    const exported = await page.request.get(`${APEX}/api/account/export`);
    expect(exported.status()).toBe(200);
    expect(exported.headers()["content-disposition"]).toMatch(/attachment; filename="guildbook-data-/);
    const data = await exported.json();
    expect(data.user.name).toBe(name);
    expect(JSON.stringify(data)).not.toMatch(/access_token|refresh_token/);

    const panel = page.getByTestId("delete-account");
    const button = panel.getByRole("button", { name: "Delete my account" });
    await expect(button).toBeDisabled();
    await panel.getByLabel(/Escribe .* para confirmar/).fill("someone else");
    await expect(button).toBeDisabled();
    await panel.getByLabel(/Escribe .* para confirmar/).fill(name);
    await expect(button).toBeEnabled();
    await button.click();

    await page.waitForURL(`${APEX}/account?deleted=1`);
    await expect(page.getByTestId("account-deleted")).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    expect((await page.request.get(`${APEX}/api/account/export`)).status()).toBe(401);
  });
});
