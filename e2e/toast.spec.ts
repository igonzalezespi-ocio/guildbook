import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("saving guild settings shows a success toast that can be dismissed", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/admin/guild");
  await page.getByRole("main").getByRole("button", { name: "Save", exact: true }).first().click();
  const toast = page.getByTestId("toast").filter({ hasText: "Guild settings saved." });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("role", "status");
  await toast.getByRole("button", { name: "Cerrar notificación" }).click();
  await expect(toast).toHaveCount(0);
});

test("an error with no field to point at shows an error toast", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/admin/ranks");
  const form = page.getByRole("main").locator("form").filter({ has: page.getByRole("button", { name: "Add rank" }) });
  await form.locator('input[name="name"]').fill("Squire");
  await form.getByRole("button", { name: "Add rank" }).click();
  const toast = page.getByRole("alert").and(page.getByTestId("toast"));
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-kind", "error");
});
