import { expect, type Page, test } from "@playwright/test";
import { paladinLog } from "../tests/support/combatlog";
import { chooseOption, signIn } from "./helpers";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://localhost:${PORT}`;
const guildOrigin = (slug: string) => `http://${slug}.localhost:${PORT}`;
/** Set to a folder to save the screenshots that document these flows (desktop project only). */
const SHOTS = process.env.E2E_SCREENSHOTS;

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

test.describe("Game versions", () => {
  test("create a TBC Anniversary guild on a realm, publish it and find it through the directory's version filter", async ({ page }, info) => {
    const shoot = SHOTS && info.project.name === "desktop";
    const suffix = uniqueSuffix();
    const name = `E2E Mirkwood ${suffix}`;
    const slug = `e2e-mirkwood-${suffix}`;
    const site = guildOrigin(slug);

    await signInOnApex(page, `e2e-tbc-${suffix}`, `Founder ${suffix}`, "/create");
    await expect(page.getByRole("heading", { name: "Create your guild" })).toBeVisible();
    await expect(page.getByLabel("Game version")).toHaveText(/WoW: Forever/);
    await expect(page.getByTestId("ruleset-choice")).toBeVisible();

    await chooseOption(page.getByLabel("Game version"), "anniversary");
    await expect(page.getByTestId("ruleset-choice")).toHaveCount(0);
    await page.getByLabel("Guild name").fill(name);
    await page.getByLabel("Subdomain").fill(slug);
    await expect(page.getByTestId("slug-status")).toHaveText("Available");
    // The realm sets the ruleset; Europe offers only its own realms.
    await page.getByLabel(/^Europe/).check();
    await expect(page.getByTestId("realm-ruleset")).toHaveText("El reino define el tipo de reino.");
    await chooseOption(page.getByLabel("Realm"), "spineshatter");
    await expect(page.getByTestId("realm-ruleset")).toContainText("JcJ");
    await page.getByLabel(/^Americas/).check();
    await expect(page.getByTestId("realm-ruleset")).toHaveText("El reino define el tipo de reino.");
    await chooseOption(page.getByLabel("Realm"), "dreamscythe");
    await expect(page.getByTestId("realm-ruleset")).toContainText("Normal");
    await page.getByLabel("Horde").check();
    await page.getByLabel(/public Guildbook directory/).check();
    // The sticky site header would cover part of the form in an element screenshot.
    if (shoot) await page.addStyleTag({ content: "header { position: static !important; }" });
    if (shoot) await page.locator("form", { has: page.getByRole("button", { name: "Create guild" }) }).screenshot({ path: `${SHOTS}/create-form-anniversary.png` });
    await page.getByRole("button", { name: "Create guild" }).click();

    await page.waitForURL(`${site}/admin/setup`);
    await expect(page.getByTestId("setup-verify-coming-soon")).toHaveCount(0);

    // Publish: keep the ranks, save the tabard, write a charter.
    await page.getByRole("button", { name: "Keep these ranks" }).click();
    await expect(page.getByTestId("setup-step-ranks")).toHaveAttribute("data-status", "done");
    await page.goto(`${site}/admin/guild#tabard`);
    await page.getByRole("button", { name: "Save tabard and theme" }).click();
    await expect(page.getByText("Tabard and theme saved").first()).toBeVisible();
    await expect(page.getByTestId("verify-guild")).toContainText("One of their TBC Anniversary characters must be Guild Master (rank 0)");
    await expect(page.getByTestId("verify-guild")).toContainText("Horde, on Dreamscythe (US)");
    await page.goto(`${site}/admin/content/charter`);
    await page.getByLabel("Body (Markdown)").fill("We raid Karazhan on weekends.");
    await page.getByRole("button", { name: "Save page" }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.goto(`${site}/admin/setup`);
    await page.getByRole("button", { name: "Publish guild" }).click();
    await expect(page.getByText("Your guild is published.").first()).toBeVisible();

    // The guild site names its game and realm.
    await page.goto(site);
    await expect(page.getByRole("banner").getByTestId("game-version-badge")).toHaveText("TBC");
    await expect(page.getByTestId("footer-realm")).toHaveText("Dreamscythe (US)");
    await expect(page).toHaveTitle(new RegExp(`${name}, TBC Anniversary guild on Dreamscythe \\(US\\)`));

    // The default directory is WoW: Forever; Anniversary guilds show up through the version filter.
    await page.goto(`${APEX}/guilds`);
    const directory = page.getByTestId("directory");
    await expect(directory.getByRole("link", { name })).toHaveCount(0);
    const filters = page.getByTestId("directory-filters");
    await expect(filters.getByLabel("Realm")).toHaveCount(0);
    await chooseOption(filters.getByLabel("Game"), "anniversary");
    await expect(page).toHaveURL(`${APEX}/guilds?version=anniversary`);
    const card = directory.locator("li", { has: page.getByRole("link", { name }) });
    await expect(card.getByTestId("game-version-badge")).toHaveText("TBC");
    await expect(card.getByTestId("realm-badge")).toHaveText("Dreamscythe (US)");
    if (shoot) {
      await card.screenshot({ path: `${SHOTS}/guild-card-tbc-badge.png` });
      await page.screenshot({ path: `${SHOTS}/directory-version-filter.png` });
    }
    await chooseOption(filters.getByLabel("Realm"), "nightslayer");
    await expect(page).toHaveURL(`${APEX}/guilds?version=anniversary&realm=nightslayer`);
    await expect(directory.getByRole("link", { name })).toHaveCount(0);
    await chooseOption(filters.getByLabel("Realm"), "dreamscythe");
    await expect(directory.getByRole("link", { name })).toBeVisible();
  });

  test("a TBC Anniversary log uploaded to a WoW: Forever guild is kept with a banner", async ({ page }, info) => {
    await signIn(page, "seed-tor", "Tor", "/vigil/upload");
    const main = page.getByRole("main");
    const tbcLog = paladinLog().replace(/BUILD_VERSION,[^,]+,PROJECT_ID,\d+/, "BUILD_VERSION,2.5.6,PROJECT_ID,5");
    // The dev server can stall the parse worker's chunk while it is still compiling the page's other requests.
    await page.waitForLoadState("networkidle");
    await main.getByTestId("vigil-log-input").setInputFiles({ name: "WoWCombatLog.txt", mimeType: "text/plain", buffer: Buffer.from(tbcLog) });
    await expect(main.getByTestId("vigil-log-info")).toContainText("build 2.5.6", { timeout: 30_000 });
    await expect(main.getByLabel("Player in the log")).toHaveAttribute("data-value", /^Player-/);
    await expect(main.getByLabel("Player in the log")).toHaveText("Tor (you)");
    await main.getByRole("button", { name: "Find fights" }).click();
    const fights = main.getByTestId("vigil-fights");
    await expect(fights.getByText("Rockhide Boar", { exact: true })).toBeVisible();
    await fights.getByRole("checkbox").nth(1).uncheck();
    await main.getByRole("button", { name: "Upload 1 report" }).click();

    await expect(page).toHaveURL(/\/vigil\/reports\/[0-9a-f-]{36}$/);
    const banner = main.getByTestId("vigil-version-mismatch");
    await expect(banner).toContainText("This log is from TBC Anniversary, but Order of Saint Michael is a WoW: Forever guild.");
    await expect(main.getByTestId("game-version-badge")).toHaveText("TBC");
    if (SHOTS && info.project.name === "desktop") await page.screenshot({ path: `${SHOTS}/report-mismatch-banner.png` });
  });
});
