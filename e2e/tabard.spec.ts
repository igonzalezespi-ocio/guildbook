import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const APEX = `http://localhost:${PORT}`;
const guildOrigin = (slug: string) => `http://${slug}.localhost:${PORT}`;

function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

const rootVar = (page: Page, name: string) =>
  page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name);

async function createGuild(page: Page, slug: string, name: string) {
  await page.context().clearCookies();
  await page.goto(`${APEX}/login?callbackUrl=${encodeURIComponent("/create")}`);
  const form = page.getByTestId("test-login-other");
  await form.getByPlaceholder("Discord ID").fill(`e2e-tabard-${slug}`);
  await form.getByPlaceholder("Name").fill("Founder");
  await form.getByRole("button", { name: "Test sign in" }).click();
  await page.waitForURL(`${APEX}/create`);
  await page.getByLabel("Guild name").fill(name);
  await page.getByLabel("Subdomain").fill(slug);
  await expect(page.getByTestId("slug-status")).toHaveText("Available");
  await page.getByLabel("Alliance").check();
  await page.getByLabel(/^Normal/).check();
  await page.getByLabel("Motto").fill("Hold the line");
  await page.getByRole("button", { name: "Create guild" }).click();
  await page.waitForURL(`${guildOrigin(slug)}/admin/setup`);
}

test.describe("Guild tabard and theme", () => {
  test("a founder designs a tabard, the preview follows, and saving re-themes the site and icons", async ({ page }) => {
    const suffix = uniqueSuffix();
    const slug = `e2e-tabard-${suffix}`;
    await createGuild(page, slug, `E2E Tabard ${suffix}`);

    await page.goto(`${guildOrigin(slug)}/`);
    const defaultCrimson = await rootVar(page, "--color-crimson");
    await expect(page.locator('style[data-guild-theme="tome"]')).toHaveCount(1);

    await page.goto(`${guildOrigin(slug)}/admin/guild`);
    const preview = page.getByTestId("theme-preview");
    const button = page.getByTestId("preview-primary-button");
    const heading = page.getByTestId("preview-heading");
    const buttonBefore = await button.evaluate((el) => getComputedStyle(el).backgroundImage);
    const headingBefore = await heading.evaluate((el) => getComputedStyle(el).color);

    await page.getByRole("radiogroup", { name: "Background colour" }).getByRole("radio", { name: "Jade" }).click();
    await page.getByRole("radiogroup", { name: "Border colour" }).getByRole("radio", { name: "Plata" }).click();
    // Before launch there's nothing to import yet, and the page says so.
    await expect(page.getByTestId("tabard-import-note")).toContainText("Importing opens once WoW: Forever characters exist");

    // New guilds start on a real in-game emblem (the lion). Only Blizzard's emblems are offered: no drawn emblem, no
    // suggestion to replace one, and no border shape picker.
    const emblems = page.getByRole("radiogroup", { name: "Emblem", exact: true });
    await expect(emblems.getByRole("radio", { name: "Lion", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(emblems.getByRole("radio")).toHaveCount(196);
    await expect(emblems.getByText("Drawn")).toHaveCount(0);
    await expect(page.getByTestId("emblem-suggestion")).toHaveCount(0);
    await expect(page.getByRole("radiogroup", { name: "Border", exact: true })).toHaveCount(0);
    await page.getByLabel("Search emblems").fill("pack");
    await expect(emblems.getByRole("radio")).toHaveCount(1);
    const wolf = emblems.getByRole("radio", { name: "Wolf", exact: true });
    await wolf.click();
    await expect(wolf).toHaveAttribute("aria-checked", "true");
    // The thumbnail is Blizzard's emblem, tinted by an SVG filter that exists on the page.
    const thumb = wolf.locator("img");
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(125);
    const filterId = await thumb.evaluate((img) => /url\("?#([^")]+)"?\)/.exec(img.style.filter)?.[1]);
    expect(filterId).toBeTruthy();
    await expect(page.locator(`filter[id="${filterId}"]`)).toHaveCount(1);
    await page.getByRole("radiogroup", { name: "Emblem colour" }).getByRole("radio", { name: "Black" }).click();
    await page.getByRole("radiogroup", { name: "Base style" }).getByRole("radio", { name: /^Pergamino/ }).click();

    await expect(page.getByRole("radiogroup", { name: "Background colour" }).getByRole("radio", { name: "Jade" })).toHaveAttribute("aria-checked", "true");
    await expect.poll(() => button.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe(buttonBefore);
    await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).not.toBe(headingBefore);
    // Parchment is a light base: the sample page surface turns light.
    const surface = await preview.evaluate((el) => getComputedStyle(el).getPropertyValue("--color-ink").trim().toLowerCase());
    expect(surface).toBe("#f4ecda");
    await expect(page.getByTestId("crest-preview").getByRole("img").first()).toBeVisible();
    await expect(page.getByTestId("crest-preview").locator('image[href*="/tabard/emblems/193.png"]').first()).toBeAttached();
    // Every size draws Guildbook's own trim in the border colour, never a Blizzard border image.
    await expect(page.getByTestId("crest-preview").locator('image[href*="/tabard/borders/"]')).toHaveCount(0);
    await expect(page.getByTestId("crest-preview").locator("image")).toHaveCount(18);

    await page.getByRole("button", { name: "Save tabard and theme" }).click();
    await expect(page.getByText("Tabard and theme saved").first()).toBeVisible();
    await expect(page.getByTestId("discord-icon-download")).toHaveAttribute("href", /v=25-14-plain-15-e193-t3/);

    await page.goto(`${guildOrigin(slug)}/`);
    await expect(page.locator('style[data-guild-theme="parchment"]')).toHaveCount(1);
    const crimson = await rootVar(page, "--color-crimson");
    expect(crimson).not.toBe(defaultCrimson);
    expect(crimson).not.toBe("#7a1020");
    expect(await rootVar(page, "--color-ink")).toBe("#f4ecda");

    const icon = page.locator('link[rel="icon"][type="image/svg+xml"], link[rel="icon"][href*="icon.svg"]').first();
    const href = await icon.getAttribute("href");
    expect(href).toContain(`/api/brand/${slug}/`);
    expect(href).toContain("v=25-14-plain-15-e193-t3");
    const res = await page.request.get(new URL(href!, page.url()).toString());
    expect(res.status()).toBe(200);
    const svg = await res.text();
    expect(svg).toContain("<svg");
    // The icon carries the tinted emblem inline, so it renders anywhere without fetching the mask; no border image.
    expect(svg.match(/data:image\/png;base64,/g)).toHaveLength(1);
    expect(svg).not.toContain("/tabard/borders/");
    const png = await page.request.get(new URL(href!.replace("icon.svg", "icon-192.png"), page.url()).toString());
    expect(png.status()).toBe(200);
    expect(png.headers()["content-type"]).toBe("image/png");
  });

  test("the Order keeps its locked crest, theme and static icons", async ({ page }) => {
    await page.goto(`${guildOrigin("osm")}/`);
    await expect(page.locator("style[data-guild-theme]")).toHaveCount(0);
    expect(await rootVar(page, "--color-crimson")).toBe("#7a1020");
    expect(await rootVar(page, "--color-gold")).toBe("#c9a44c");
    await expect(page.getByRole("img", { name: "Order of Saint Michael crest" }).first()).toBeAttached();
    const icons = await page.locator('link[rel="icon"], link[rel="apple-touch-icon"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    expect(icons.length).toBeGreaterThan(0);
    for (const href of icons) expect(href).toMatch(/^\/brand\/osm\//);

    await signIn(page, "seed-tor", "Tor", "/admin/guild");
    const section = page.locator("section", { has: page.getByRole("heading", { name: "Tabard and theme" }) });
    await expect(section.getByText("Locked", { exact: true })).toBeVisible();
    await expect(section.getByRole("button", { name: "Save tabard and theme" })).toHaveCount(0);
  });
});
