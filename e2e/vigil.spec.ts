import { expect, test } from "@playwright/test";
import { paladinLog } from "../tests/support/combatlog";
import { chooseOption, signIn } from "./helpers";

test("upload a combat log, keep one fight, open the report and control who sees it", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/vigil/upload");
  await expect(page).toHaveURL(/\/vigil\/upload$/);
  const main = page.getByRole("main");

  await main.getByTestId("vigil-log-input").setInputFiles({
    name: "WoWCombatLog.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(paladinLog()),
  });
  await expect(main.getByTestId("vigil-log-info")).toContainText("Versión del registro de combate 22, compilación 12.1.5, registro avanzado activado");
  await expect(main.getByLabel("Jugador del registro")).toHaveAttribute("data-value", /^Player-/);
  await expect(main.getByLabel("Jugador del registro")).toHaveText("Tor (tú)");
  await expect(main.getByLabel("Modelo de rotación")).toHaveText("Paladín (subiendo de nivel)");
  await expect(main.getByLabel("Tu personaje")).toContainText("Tor Whitecross");

  await main.getByRole("button", { name: "Buscar combates" }).click();
  const fights = main.getByTestId("vigil-fights");
  await expect(fights.getByText("Rockhide Boar", { exact: true })).toBeVisible();
  await expect(fights.getByText("Young Wolf", { exact: true })).toBeVisible();
  await fights.getByRole("checkbox").nth(1).uncheck();
  await expect(main.getByLabel("Solo yo")).toBeChecked();
  await main.getByRole("button", { name: "Subir 1 informe" }).click();

  await expect(page).toHaveURL(/\/vigil\/reports\/[0-9a-f-]{36}$/);
  const reportUrl = page.url();
  await expect(main.getByRole("heading", { level: 1, name: "Rockhide Boar" })).toBeVisible();
  const report = main.getByTestId("vigil-report");
  await expect(report.getByTestId("vigil-timeline")).toBeVisible();
  await expect(report.getByRole("heading", { name: "Estimación frente a lo real" })).toBeVisible();
  await expect(report.getByText("Continuidad del ataque automático")).toBeVisible();
  await expect(report.getByRole("heading", { name: "Seguimiento de prioridades" })).toBeVisible();
  await expect(report.getByText("Judgement en cuanto se recargue").first()).toBeVisible();
  await expect(report.getByText("Seal of Righteousness").first()).toBeVisible();
  await expect(main.getByLabel("Quién puede ver este informe")).toHaveAttribute("data-value", "private");

  // Private: an officer gets a not-found page.
  await signIn(page, "seed-ironvow", "Ironvow", "/vigil");
  await page.goto(reportUrl);
  await expect(main.getByRole("heading", { level: 1, name: "Perdido en las tierras salvajes" })).toBeVisible();

  // Shared with officers: now the officer can read it.
  await signIn(page, "seed-tor", "Tor", "/vigil");
  await page.goto(reportUrl);
  await chooseOption(main.getByLabel("Quién puede ver este informe"), "officers");
  await main.getByRole("button", { name: "Guardar" }).click();
  await expect(main.getByText("Rockhide Boar ahora es compartido con los oficiales.")).toBeVisible();
  await page.goto("/vigil");
  await expect(main.getByTestId("vigil-my-reports").getByText("Rockhide Boar").first()).toBeVisible();

  await signIn(page, "seed-ironvow", "Ironvow", "/vigil");
  await expect(main.getByText("Rockhide Boar").first()).toBeVisible();
  await page.goto(reportUrl);
  await expect(main.getByRole("heading", { level: 1, name: "Rockhide Boar" })).toBeVisible();
  await expect(main.getByText("Visibilidad elegida por su dueño: compartido con los oficiales.")).toBeVisible();
});

test("Vigil is linked from the addons page and My Characters", async ({ page }) => {
  await signIn(page, "seed-tor", "Tor", "/addons");
  await page.getByRole("main").getByRole("link", { name: "Abrir Vigil" }).click();
  await expect(page).toHaveURL(/\/vigil$/);
  await expect(page.getByRole("heading", { level: 1, name: "Vigil" })).toBeVisible();
  await page.goto("/members/characters");
  await page.getByRole("main").getByRole("link", { name: "Revisa tus combates en Vigil" }).click();
  await expect(page).toHaveURL(/\/vigil$/);
});
