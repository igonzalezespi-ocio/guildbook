import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("the server timezone is a searchable listbox that saves and keeps its value", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/admin/guild");
  const main = page.getByRole("main");
  const trigger = main.getByRole("button", { name: "Zona horaria del servidor" });
  await expect(trigger).toHaveAttribute("data-value", "America/New_York");
  await expect(trigger).toHaveText("America/New York");

  const pick = async (query: string, value: string) => {
    await expect(async () => {
      if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
      await expect(page.getByRole("combobox", { name: "Buscar zona horaria del servidor" })).toBeFocused({ timeout: 1000 });
    }).toPass();
    await page.keyboard.type(query);
    await expect(page.getByRole("option").first()).toHaveAttribute("data-value", value);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("data-value", value);
  };

  await pick("los ang", "America/Los_Angeles");
  await main.getByRole("button", { name: "Guardar", exact: true }).first().click();
  await expect(page.getByTestId("toast").filter({ hasText: "Ajustes de la hermandad guardados." })).toBeVisible();
  await page.reload();
  await expect(trigger).toHaveAttribute("data-value", "America/Los_Angeles");

  await pick("new york", "America/New_York");
  await main.getByRole("button", { name: "Guardar", exact: true }).first().click();
  await expect(page.getByTestId("toast").filter({ hasText: "Ajustes de la hermandad guardados." }).first()).toBeVisible();
  await page.reload();
  await expect(trigger).toHaveAttribute("data-value", "America/New_York");
});

test("a listbox follows the keyboard: arrows, Home, End, type-ahead and Escape", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/admin/schedule");
  const trigger = page.getByRole("main").getByRole("combobox", { name: "Día" }).first();
  const initial = await trigger.getAttribute("data-value");
  await expect(async () => {
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(trigger).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
  }).toPass();
  const active = () => page.locator('[role="option"][data-active]');
  await expect(active()).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(active()).toHaveText("Sunday");
  await page.keyboard.press("End");
  await expect(active()).toHaveText("Saturday");
  await page.keyboard.press("t");
  await expect(active()).toHaveText(/^T/);
  await expect(trigger).toHaveAttribute("aria-activedescendant", (await active().getAttribute("id"))!);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(trigger).toHaveAttribute("data-value", initial!);

  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("data-value", "6");
  await expect(trigger).toHaveText("Saturday");
});
