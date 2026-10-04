import { expect, test } from "@playwright/test";
import { analyzeText } from "@/lib/vigil/analyze";
import { PALADIN, paladinLog } from "../tests/support/combatlog";
import { signIn } from "./helpers";

test("pair a Vigil companion, upload with its token, then revoke it", async ({ page, request }) => {
  await signIn(page, "seed-tor", "Tor", "/vigil");
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Conectar la app de Vigil" }).click();
  await expect(page).toHaveURL(/\/vigil\/companion$/);
  await expect(main.getByRole("heading", { level: 1, name: "Conectar la app de Vigil" })).toBeVisible();
  await expect(main.getByText("Aún no hay ninguna app emparejada.")).toBeVisible();

  await main.getByRole("button", { name: "Crear código de emparejamiento" }).click();
  const codeBox = main.getByTestId("companion-pairing-code");
  await expect(codeBox.getByLabel("Código de emparejamiento")).toHaveText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  await expect(codeBox.getByRole("timer")).toContainText("Sirve una vez. Caduca en 9:");
  await expect(codeBox.getByRole("link", { name: "Abrir en la app" })).toHaveAttribute("href", /^vigil-companion:\/\/pair\?code=/);
  const code = (await codeBox.getByLabel("Código de emparejamiento").textContent())!;

  const paired = await request.post("/api/vigil/companion/pair", { data: { code, deviceName: "E2E desktop" } });
  expect(paired.status()).toBe(201);
  const { token } = await paired.json();
  expect((await request.post("/api/vigil/companion/pair", { data: { code, deviceName: "Replay" } })).status()).toBe(400);

  await page.reload();
  const devices = main.getByTestId("companion-devices");
  await expect(devices.getByText("E2E desktop")).toBeVisible();
  await expect(devices).toContainText(`Token acabado en ${token.slice(-4)}`);

  const [report] = analyzeText(paladinLog(), PALADIN.guid, "paladin-leveling", "Tor");
  const uploaded = await request.post("/api/vigil/companion/reports", {
    headers: { authorization: `Bearer ${token}` },
    data: { report },
  });
  expect(uploaded.status()).toBe(201);
  const { url } = await uploaded.json();
  await page.goto(new URL(url).pathname);
  await expect(main.getByRole("heading", { level: 1, name: "Rockhide Boar" })).toBeVisible();
  await expect(main.getByLabel("Quién puede ver este informe")).toHaveAttribute("data-value", "private");

  await page.goto("/vigil/companion");
  page.once("dialog", (dialog) => dialog.accept());
  await devices.getByRole("button", { name: "Revocar" }).click();
  await expect(main.getByText("Aún no hay ninguna app emparejada.")).toBeVisible();
  const refused = await request.post("/api/vigil/companion/reports", {
    headers: { authorization: `Bearer ${token}` },
    data: { report },
  });
  expect(refused.status()).toBe(401);
});
