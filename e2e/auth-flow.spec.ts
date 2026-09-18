import { expect, test } from "@playwright/test";
import { emulateInstalledPwa } from "./standalone-pwa";

test.describe("registro público", () => {
  test.beforeEach(async ({ page }) => {
    await emulateInstalledPwa(page);
  });

  test("muestra el formulario de registro y la acción de validación Telegram", async ({ page }) => {
    await page.goto("/registro");

    await expect(page.getByRole("heading", { name: "Crear cuenta" })).toBeVisible();
    await expect(page.getByLabel("Telegram ID")).toHaveAttribute("inputmode", "numeric");
    await expect(page.getByRole("button", { name: /VALIDAR TELEGRAM/iu })).toBeVisible();
    await expect(page.getByLabel("Usuario")).toBeVisible();
    await expect(page.getByRole("button", { name: "CREAR CUENTA" })).toBeVisible();
  });
});
