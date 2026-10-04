import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("visitors are sent to sign in; members see the ledger, raid nights and reversals", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/members/loot");
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);

  await signIn(page, "seed-perpetua", "Perpetua", "/members/loot");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Botín", level: 1 })).toBeVisible();
  await expect(main.getByRole("link", { name: "Eskhandar's Right Claw" }).first()).toHaveAttribute("href", /wowhead\.com\/classic\/item=18203/);

  await main.getByRole("link", { name: /10 dic 2026/ }).first().click();
  await expect(page).toHaveURL(/\/members\/loot\/raids\/2026-12-10$/);
  await expect(page.getByRole("navigation", { name: "Ruta de navegación" }).getByRole("link", { name: "Botín" })).toBeVisible();
  await expect(main.getByText("Clicked the wrong paladin; the gauntlets went to Tor")).toBeVisible();
  await expect(main.getByRole("heading", { name: "Molten Core, Garr" })).toBeVisible();
});

test("an officer imports a Gargul export after reviewing names, and reverses an award", async ({ page }) => {
  await signIn(page, "seed-ironvow", "Ironvow", "/admin/loot/import");
  const main = page.getByRole("main");
  const raw = readFileSync(path.join(process.cwd(), "tests/fixtures/loot/gargul-custom.txt"), "utf8");
  await main.getByLabel("Exportación").fill(raw);
  await main.getByRole("button", { name: "Previsualizar importación" }).click();

  await expect(page).toHaveURL(/\/admin\/loot\/import\?batch=/);
  await expect(main.getByRole("heading", { name: "Revisar importación" })).toBeVisible();
  await expect(main.getByLabel("¿Quién es Cassian?")).toHaveAttribute("data-value", /^char:/);
  await main.getByRole("button", { name: /^Confirmar/ }).click();

  await expect(page).toHaveURL(/\/admin\/loot$/);
  await expect(page.getByTestId("toast").filter({ hasText: /al registro/ })).toBeVisible();

  const reverse = main.locator("form").filter({ has: page.getByRole("button", { name: "Anular" }) }).first();
  await reverse.getByPlaceholder("Motivo").fill("E2E reversal");
  page.once("dialog", (d) => d.accept());
  await reverse.getByRole("button", { name: "Anular" }).click();
  await expect(page.getByTestId("toast").filter({ hasText: /entrega anulada\./ })).toBeVisible();
  await expect(main.getByText("E2E reversal").first()).toBeVisible();
});

test("raiders can't reach the officer loot pages", async ({ page }) => {
  await signIn(page, "seed-cassian", "Cassian", "/admin/loot");
  await expect(page).toHaveURL(/\/denied/);
});
