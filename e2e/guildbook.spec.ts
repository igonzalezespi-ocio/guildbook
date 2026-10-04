import { expect, type Page, test } from "@playwright/test";
import { chooseOption } from "./helpers";

const PORT = Number(process.env.E2E_PORT ?? 3100);
/** Bare localhost is the local apex and guilds live on *.localhost, which Chromium resolves itself. */
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

test.describe("Guildbook platform", () => {
  test("apex landing and directory are served on the apex, guilds on their subdomains", async ({ page }) => {
    await page.goto(`${APEX}/`);
    await expect(page.getByRole("heading", { name: "Un hogar para tu hermandad" })).toBeVisible();
    await expect(page).toHaveTitle(/Guildbook/);
    // The guild site preview links to the Order on its subdomain.
    await expect(page.getByRole("link", { name: "Visita Order of Saint Michael" })).toHaveAttribute("href", guildOrigin("osm"));
    // Its theme picker switches to an example guild, which links to guild creation instead.
    await page.getByRole("button", { name: "Wardens of the Greenwood theme" }).click();
    await expect(page.getByRole("button", { name: "Wardens of the Greenwood theme" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("preview-address")).toHaveText(/^greenwood\./);
    await expect(page.getByRole("link", { name: "Tu hermandad aquí" })).toHaveAttribute("href", "/create");
    await page.getByRole("button", { name: "Order of Saint Michael theme" }).click();
    await expect(page.getByRole("link", { name: "Visita Order of Saint Michael" })).toBeVisible();

    // www redirects to the bare apex, keeping the path.
    await page.goto(`http://www.localhost:${PORT}/guilds`);
    await expect(page).toHaveURL(`${APEX}/guilds`);

    await page.goto(`${APEX}/guilds`);
    await expect(page.getByRole("heading", { name: "Directorio de hermandades" })).toBeVisible();
    await expect(page.getByTestId("directory").getByRole("link", { name: "Order of Saint Michael" })).toHaveAttribute("href", guildOrigin("osm"));
    await expect(page.getByTestId("directory").getByTestId("ruleset-badge").first()).toBeVisible();
    await expect(page.getByTestId("directory").getByTestId("region-badge").first()).toBeVisible();
    const filters = page.getByTestId("directory-filters");
    await expect(filters.getByRole("combobox")).toHaveCount(4);
    await chooseOption(filters.getByLabel("Región"), "eu");
    await expect(page).toHaveURL(`${APEX}/guilds?region=eu`);
    await expect(page.getByRole("link", { name: "Order of Saint Michael" })).toHaveCount(0);
    await expect(filters.getByLabel("Región")).toHaveText("Europa");
    await page.goto(`${APEX}/guilds`);
    await chooseOption(filters.getByLabel("Facción"), "horde");
    await expect(page).toHaveURL(`${APEX}/guilds?faction=horde`);
    await expect(page.getByRole("link", { name: "Order of Saint Michael" })).toHaveCount(0);
    // Choosing "All" again drops the filter from the shareable URL.
    await chooseOption(filters.getByLabel("Facción"), "Cualquiera");
    await expect(page).toHaveURL(`${APEX}/guilds`);
    await page.goto(`${APEX}/guilds?region=us&faction=alliance&ruleset=normal`);
    await expect(filters.getByLabel("Tipo de reino")).toHaveText("Normal");
    await expect(page.getByTestId("directory").getByRole("link", { name: "Order of Saint Michael" })).toBeVisible();

    await page.goto(`${guildOrigin("osm")}/charter`);
    await expect(page.getByRole("heading", { name: /Charter/ }).first()).toBeVisible();
    // Links on a guild subdomain carry no slug prefix.
    await expect(page.locator('a[href^="/osm/"]')).toHaveCount(0);

    // Signing in on a guild subdomain goes through the apex.
    await page.goto(`${guildOrigin("osm")}/login`);
    await expect(page).toHaveURL(new RegExp(`^${APEX}/login\\?callbackUrl=`));
    await expect(page.getByRole("heading", { name: "Inicia sesión en Order of Saint Michael" })).toBeVisible();
  });

  test("create a guild on the apex and land signed in on its admin subdomain", async ({ page }) => {
    const suffix = uniqueSuffix();
    const name = `E2E Keep ${suffix}`;
    const slug = `e2e-keep-${suffix}`;

    await page.goto(`${APEX}/create`);
    await expect(page).toHaveURL(new RegExp(`^${APEX}/login`));

    await signInOnApex(page, `e2e-founder-${suffix}`, `Founder ${suffix}`, "/create");
    await expect(page).toHaveURL(`${APEX}/create`);
    await expect(page.getByRole("heading", { name: "Crea tu hermandad" })).toBeVisible();

    const slugInput = page.getByLabel("Subdominio");
    await slugInput.fill("www");
    await expect(page.getByTestId("slug-status")).toHaveText("Ese nombre está reservado");
    await slugInput.fill("osm");
    await expect(page.getByTestId("slug-status")).toHaveText("Ese subdominio está ocupado");
    await slugInput.fill("");

    await page.getByLabel("Nombre de la hermandad").fill(name);
    // The name suggests a slug until the slug is edited, but the slug was edited above.
    await slugInput.fill(slug);
    await expect(page.getByTestId("slug-status")).toHaveText("Disponible");
    await expect(page.getByTestId("region-choice").getByRole("radio")).toHaveCount(2);
    await expect(page.getByLabel(/^América/)).toBeChecked();
    await page.getByLabel(/^Europa/).check();
    await expect(page.getByTestId("faction-choice").getByRole("radio")).toHaveCount(2);
    await page.getByLabel("Horda").check();
    await page.getByLabel(/^JcJ/).check();
    await page.getByLabel("Lema").fill("Hold the line");

    // A server-side rejection names the field, focuses it and offers subdomains that set this guild apart.
    await slugInput.fill("osm");
    await expect(page.getByTestId("slug-suggestions").getByRole("button", { name: "osm-pvp" })).toBeVisible();
    await page.getByRole("button", { name: "Crear hermandad" }).click();
    const summary = page.getByTestId("form-error-summary");
    await expect(summary).toContainText("Subdominio: Ese subdominio está ocupado");
    await expect(slugInput).toBeFocused();
    await expect(slugInput).toHaveAttribute("aria-invalid", "true");
    // A rejected submit keeps the choices already made.
    await expect(page.getByLabel(/^Europa/)).toBeChecked();
    await expect(page.getByLabel(/^JcJ/)).toBeChecked();
    await page.getByTestId("slug-suggestions").getByRole("button", { name: "osm-horde" }).click();
    await expect(slugInput).toHaveValue("osm-horde");
    await slugInput.fill(slug);
    await expect(page.getByTestId("slug-status")).toHaveText("Disponible");
    // Left unlisted so repeated runs don't fill the local directory.
    await expect(page.getByLabel(/directorio público de Guildbook/)).not.toBeChecked();
    await page.getByRole("button", { name: "Crear hermandad" }).click();

    // The handoff sets a session on the new subdomain and lands on its setup checklist, as an unlisted draft.
    await page.waitForURL(`${guildOrigin(slug)}/admin/setup`);
    await expect(page.getByRole("heading", { name: `Set up ${name}` })).toBeVisible();
    await expect(page.getByTestId("draft-banner")).toBeVisible();

    await page.goto(`${guildOrigin(slug)}/`);
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    await expect(page.getByRole("main").getByText("Hold the line")).toBeVisible();
    await expect(page.getByText("Sancte Michael Archangele")).toHaveCount(0);
    await expect(page.getByTestId("footer-ruleset")).toHaveText("JcJ");
    await expect(page.getByTestId("footer-region")).toHaveText("Europa");

    await page.goto(`${guildOrigin(slug)}/charter`);
    await expect(page.getByRole("heading", { name: "Reglamento de la hermandad" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: `Ranks of ${name}` })).toBeVisible();
    await expect(page.getByRole("main").getByText(/the Order|Saint Michael|Grand Master|knight/i)).toHaveCount(0);

    // The guild's other pages carry its own name, never the Order's wording.
    for (const [path, text] of [
      ["/progression", `Deeds of ${name}`],
      ["/addons", "Guild Addons"],
      ["/roster", /^\d+ members? of /],
    ] as const) {
      await page.goto(`${guildOrigin(slug)}${path}`);
      await expect(page.getByRole("main").getByText(text)).toBeVisible();
      await expect(page.getByRole("main").getByText(/the Order|brothers and sisters/)).toHaveCount(0);
    }

    // Custom domain foundations: a pending domain with DNS instructions.
    await page.goto(`${guildOrigin(slug)}/admin/guild`);
    await page.getByLabel("Dominio").fill(`${slug}.example.com`);
    await page.getByRole("button", { name: "Añadir dominio" }).click();
    const card = page.getByTestId("custom-domain").filter({ hasText: `${slug}.example.com` });
    await expect(card).toBeVisible();
    await expect(card.getByText(`_guildbook.${slug}.example.com`)).toBeVisible();
    await expect(card.getByText("Esperando al DNS")).toBeVisible();

    // The apex session is still there and lists the new guild.
    await page.goto(`${APEX}/`);
    await expect(page.getByTestId("your-guilds").getByRole("link", { name })).toHaveAttribute("href", guildOrigin(slug));
    await expect(page.getByTestId("platform-user")).toHaveText(`Founder ${suffix}`);
  });

  test("the guild subdomain carries the apex session through sign-in", async ({ page }) => {
    const suffix = uniqueSuffix();
    await signInOnApex(page, `e2e-visitor-${suffix}`, `Visitor ${suffix}`, `${guildOrigin("osm")}/apply`);
    await expect(page).toHaveURL(`${guildOrigin("osm")}/apply`);
    await expect(page.getByRole("heading", { name: "Únete a la Orden" })).toBeVisible();
    await expect(page.getByText(/sesión con Discord/)).toHaveCount(0);
  });

  test("rejects foreign callback URLs", async ({ page }) => {
    const suffix = uniqueSuffix();
    await signInOnApex(page, `e2e-redirect-${suffix}`, `Redirect ${suffix}`, "https://evil.example.com/steal");
    expect(new URL(page.url()).host).toBe(`localhost:${PORT}`);
    // The redirect after a server action is rendered on the apex, not a guild.
    await expect(page.getByRole("heading", { name: "Un hogar para tu hermandad" })).toBeVisible();
    await expect(page.getByTestId("platform-user")).toHaveText(`Redirect ${suffix}`);
  });
});
