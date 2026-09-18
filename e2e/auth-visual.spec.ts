import { expect, test } from "@playwright/test";
import { emulateInstalledPwa } from "./standalone-pwa";

test.beforeEach(async ({ page }) => {
  await emulateInstalledPwa(page);
});

test("registro móvil conserva su referencia visual", async ({ page }) => {
  await page.goto("/registro");
  await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();

  await expect(page).toHaveScreenshot("registro-mobile.png", {
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
});
