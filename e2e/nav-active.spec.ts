import { expect, type Page, test } from "@playwright/test";
import { headerMenu, openMenu, signIn } from "./helpers";

/** The header nav that is visible at this viewport: the Menu dropdown on mobile, the Main nav on desktop. */
async function headerNav(page: Page, isMobile: boolean) {
  if (!isMobile) return page.getByRole("banner").getByRole("navigation", { name: "Principal" });
  const menu = headerMenu(page, "Menú");
  await openMenu(menu);
  return menu;
}

test("the navbar marks the current section, including child pages", async ({ page, isMobile }) => {
  for (const [path, label] of [
    ["/charter", "Reglamento"],
    ["/lore", "Historia"],
    ["/roster", "Plantilla"],
    ["/progression", "Progreso"],
    ["/addons", "Addons"],
  ] as const) {
    await page.goto(path);
    const nav = await headerNav(page, isMobile);
    await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
    if (isMobile) await page.keyboard.press("Escape");
  }

  await page.goto("/roster");
  await page.getByRole("main").getByRole("link", { name: "Tor Whitecross", exact: true }).click();
  await expect(page).toHaveURL(/\/roster\/[^/]+$/);
  const nav = await headerNav(page, isMobile);
  await expect(nav.getByRole("link", { name: "Plantilla", exact: true })).toHaveAttribute("aria-current", "page");

  await page.goto("/");
  const home = await headerNav(page, isMobile);
  await expect(home.locator('a[aria-current="page"]')).toHaveCount(0);
});

test("the admin nav marks only the current section", async ({ page, isMobile }) => {
  await signIn(page, "seed-tor", "Tor", "/admin");
  const admin = page.getByRole("navigation", { name: "Admin" });

  await expect(admin.getByRole("link", { name: "Resumen" })).toHaveAttribute("aria-current", "page");
  await expect(admin.locator('a[aria-current="page"]')).toHaveCount(1);

  for (const label of ["Solicitudes", "Miembros", "Rangos", "Horario", "Reclutamiento", "Progreso", "Hermandad"]) {
    await admin.getByRole("link", { name: label, exact: true }).click();
    await expect(admin.getByRole("link", { name: label, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(admin.locator('a[aria-current="page"]')).toHaveCount(1);
    // The open tab is scrolled into view on narrow screens.
    await expect(admin.getByRole("link", { name: label, exact: true })).toBeInViewport();
  }

  // Rarely used sections sit in the More menu, which shows as current while one of them is open.
  const more = admin.getByRole("button", { name: "Más" });
  for (const label of ["Addons", "Registro de auditoría"]) {
    await more.click();
    await admin.getByRole("menuitem", { name: label }).click();
    await expect(page).toHaveURL(label === "Addons" ? /\/admin\/addons$/ : /\/admin\/audit$/);
    await expect(more).toHaveAttribute("data-current", "true");
    await expect(admin.locator('a[aria-current="page"]')).toHaveCount(1);
  }
  await more.focus();
  await page.keyboard.press("ArrowDown");
  await expect(admin.getByRole("menuitem", { name: "Addons" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(admin.getByRole("menuitem", { name: "Registro de auditoría" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(admin.getByRole("menu")).toBeHidden();
  await expect(more).toBeFocused();

  const nav = await headerNav(page, isMobile);
  await expect(nav.getByRole("link", { name: "Administración", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Progreso", exact: true })).not.toHaveAttribute("aria-current", "page");
});
