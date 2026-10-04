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

test.describe("Guild onboarding", () => {
  test("a new guild lands on setup as an unlisted draft and publishes once the minimum steps are done", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Oath ${suffix}`;
    const slug = `e2e-oath-${suffix}`;
    const site = guildOrigin(slug);

    await signInOnApex(page, `e2e-onboard-${suffix}`, `Founder ${suffix}`, "/create");
    await page.getByLabel("Nombre de la hermandad").fill(name);
    await page.getByLabel("Subdominio").fill(slug);
    await expect(page.getByTestId("slug-status")).toHaveText("Disponible");
    await page.getByLabel("Horda").check();
    await page.getByLabel(/^Normal/).check();
    await page.getByLabel(/public Guildbook directory/).check();
    await page.getByRole("radio", { name: /^Social/ }).check();
    await page.getByRole("button", { name: "Crear hermandad" }).click();

    await page.waitForURL(`${site}/admin/setup`);
    await expect(page.getByRole("heading", { name: `Set up ${name}` })).toBeVisible();
    await expect(page.getByTestId("setup-progress")).toHaveText("0 of 9 steps done");
    await expect(page.getByTestId("neutral-defaults")).toHaveCount(0);
    await expect(page.getByTestId("publish-missing").getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Publish guild" })).toBeDisabled();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

    // Skipping a step can be undone.
    const lore = page.getByTestId("setup-step-lore");
    await lore.getByRole("button", { name: "Skip for now" }).click();
    await expect(lore).toHaveAttribute("data-status", "skipped");
    await lore.getByRole("button", { name: "Undo skip" }).click();
    await expect(lore).toHaveAttribute("data-status", "todo");

    // Ranks: keep the Social ladder chosen on the create form.
    await expect(page.getByTestId("setup-step-ranks").getByText("Initiate", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Keep these ranks" }).click();
    await expect(page.getByTestId("setup-step-ranks")).toHaveAttribute("data-status", "done");

    // Tabard: save the design as it is.
    await page.getByTestId("setup-step-look").getByRole("link", { name: "Design tabard" }).click();
    await page.waitForURL(`${site}/admin/guild#tabard`);
    await page.getByRole("button", { name: "Save tabard and theme" }).click();
    await expect(page.getByText("Tabard and theme saved").first()).toBeVisible();

    // Charter: write our own.
    await page.goto(`${site}/admin/content/charter`);
    await page.getByLabel("Body (Markdown)").fill("We raid on weekends and keep guild chat friendly.");
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();

    // A visitor can open the draft by link but can't apply yet, and the draft isn't in the directory.
    const visitor = await page.context().browser()!.newPage();
    await visitor.goto(`${site}/apply`);
    await expect(visitor.getByTestId("apply-draft")).toBeVisible();
    await visitor.goto(site);
    await expect(visitor.getByTestId("footer-opening-soon")).toBeVisible();
    await expect(visitor.getByRole("link", { name: "Apply", exact: true })).toHaveCount(0);
    await visitor.goto(`${APEX}/guilds`);
    await expect(visitor.getByTestId("directory").getByRole("link", { name })).toHaveCount(0);

    await page.goto(`${site}/admin/setup`);
    await expect(page.getByTestId("publish-missing")).toHaveCount(0);
    await page.getByRole("button", { name: "Publish guild" }).click();
    await expect(page.getByText("Your guild is published.").first()).toBeVisible();
    await expect(page.getByTestId("setup-step-publish")).toHaveAttribute("data-status", "done");
    await expect(page.getByTestId("draft-banner")).toHaveCount(0);

    await visitor.goto(`${APEX}/guilds`);
    await expect(visitor.getByTestId("directory").getByRole("link", { name })).toBeVisible();
    await visitor.goto(`${site}/apply`);
    await expect(visitor.getByTestId("apply-draft")).toHaveCount(0);
    await visitor.goto(site);
    await expect(visitor.locator('meta[name="robots"]')).toHaveCount(0);
    await expect(visitor.getByTestId("footer-opening-soon")).toHaveCount(0);
    await expect(visitor.getByRole("link", { name: "Apply", exact: true }).first()).toBeVisible();
    await visitor.close();

    // The checklist can be hidden from the admin home and reached again under Setup.
    await page.goto(`${site}/admin`);
    await expect(page.getByRole("heading", { name: "Guild Admin" })).toBeVisible();
    const card = page.getByTestId("setup-card");
    await card.getByRole("button", { name: "Hide" }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Setup" }).click();
    await expect(page.getByRole("heading", { name: `Set up ${name}` })).toBeVisible();
  });
});
