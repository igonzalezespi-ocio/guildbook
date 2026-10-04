import { expect, test } from "@playwright/test";

test.describe("lore of the Order", () => {
  test("renders the lore, the disclaimers and further reading", async ({ page }) => {
    await page.goto("/lore");
    await expect(page).toHaveTitle(/Historia/);
    await expect(page.getByRole("heading", { level: 1, name: "The Lore of the Order" })).toBeVisible();
    const article = page.getByRole("article");
    for (const section of ["The True Light", "Pilgrims from a Far Country", "A Warning in Scarlet", "Quis ut Deus", "The Tabard"]) {
      await expect(article.getByRole("heading", { level: 2, name: section })).toBeVisible();
    }
    await expect(article.getByText(/the true light, which enlightens everyone/)).toBeVisible();

    const claims = page.getByRole("complementary", { name: "Lo que no afirmamos" });
    await expect(claims.getByRole("listitem")).toHaveCount(3);
    await expect(claims).toContainText("The Light of Azeroth is not God");

    const reading = page.getByRole("region", { name: "Para seguir leyendo" });
    await expect(reading.getByRole("link")).toHaveCount(4);
    await expect(reading.getByRole("link", { name: "Towards Full Presence" })).toHaveAttribute("href", /press\.vatican\.va/);
  });

  test("the charter preamble links to the lore, which is not a charter section", async ({ page }) => {
    await page.goto("/charter");
    await expect(page.getByText("We are Catholics who play.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "The True Light" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Secciones del reglamento" }).getByRole("link", { name: /Lore/ })).toHaveCount(0);

    await page.getByRole("main").getByRole("link", { name: "Read the Lore of the Order" }).click();
    await expect(page).toHaveURL(/\/lore$/);
    await expect(page.getByRole("heading", { level: 1, name: "The Lore of the Order" })).toBeVisible();
  });

  test("the footer links to the lore", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "Historia de la Orden" }).click();
    await expect(page).toHaveURL(/\/lore$/);
  });
});
