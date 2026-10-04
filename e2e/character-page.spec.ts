import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("roster names open the character page, which links main and alts", async ({ page }) => {
  await page.goto("/roster");
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Tor Whitecross", exact: true }).click();

  await expect(page).toHaveURL(/\/roster\/[0-9a-f-]{36}$/);
  await expect(page).toHaveTitle("Tor Whitecross | Order of Saint Michael");
  await expect(main.getByRole("heading", { level: 1, name: "Tor Whitecross" })).toBeVisible();
  await expect(main.getByText("Level 60 Holy Paladin", { exact: true })).toBeVisible();
  await expect(main.getByText("Healer", { exact: true })).toBeVisible();
  await expect(main.getByText("Grand Master", { exact: true })).toBeVisible();
  await expect(main.getByText(/^Joined the Order/)).toBeVisible();
  await expect(main.getByRole("heading", { name: "Professions" })).toBeVisible();

  await main.getByRole("link", { name: "Raphael Whitecross", exact: true }).click();
  await expect(main.getByRole("heading", { level: 1, name: "Raphael Whitecross" })).toBeVisible();
  await expect(main.getByText("Level 42 Frost Mage", { exact: true })).toBeVisible();
  await expect(main.getByText("Alt character", { exact: true })).toBeVisible();
  await expect(main.getByRole("link", { name: "Tor Whitecross", exact: true })).toBeVisible();
});

test("alt names on the roster link to the alt's page", async ({ page }) => {
  await page.goto("/roster");
  await page.getByRole("main").getByRole("link", { name: "Anselm Blackmere", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Anselm Blackmere" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Cassian Blackmere", exact: true })).toBeVisible();
});

test("rank insignia gradient IDs stay unique across client navigations", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Plantilla", exact: true }).click();
  await expect(page).toHaveURL(/\/roster$/);
  await page.getByRole("main").getByRole("link", { name: "Tor Whitecross", exact: true }).click();
  await expect(page.getByRole("main").getByText("Grand Master", { exact: true })).toBeVisible();

  const shared = await page.evaluate(() =>
    [...document.querySelectorAll("svg[data-rank-insignia]")]
      .flatMap((svg) => [...svg.querySelectorAll("[fill^='url(#'], [clip-path^='url(#']")])
      .map((el) => (el.getAttribute("fill") ?? el.getAttribute("clip-path"))!.slice(5, -1))
      .filter((id, i, all) => all.indexOf(id) === i && document.querySelectorAll(`[id="${id}"]`).length !== 1),
  );
  expect(shared).toEqual([]);
});

test("unknown and malformed character ids are 404s", async ({ page }) => {
  for (const id of ["00000000-0000-4000-8000-000000000000", "tor-whitecross"]) {
    const response = await page.goto(`/roster/${id}`);
    expect(response?.status()).toBe(404);
  }
});
