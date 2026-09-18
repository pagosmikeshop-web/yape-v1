import { expect, test } from "@playwright/test";
import { emulateInstalledPwa } from "./standalone-pwa";

test.describe("validación Telegram durante el registro", () => {
  test.beforeEach(async ({ page }) => {
    await emulateInstalledPwa(page);
  });

  test("muestra el estado confirmado y bloquea nuevos intentos después de una respuesta permitida", async ({ page }) => {
    let validationPayload: Record<string, unknown> | undefined;
    await page.route("**/api/auth/register/status", async (route) => {
      validationPayload = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          allowed: true,
          groupInviteUrl: "https://t.me/example-group",
        }),
      });
    });

    await page.goto("/registro");
    await page.getByLabel("Telegram ID").fill("714882477");
    const validationButton = page.locator(".telegram-check-button");
    await expect(validationButton).toBeEnabled({ timeout: 15_000 });

    await validationButton.click();
    await expect(validationButton).toHaveClass(/is-telegram-validating/);
    await expect(validationButton).toHaveClass(/is-telegram-validated/, { timeout: 5_000 });
    await expect(validationButton).toBeDisabled();
    expect(validationPayload).toMatchObject({ telegramUserId: "714882477" });
  });

  test("muestra el estado de error y permite reintentar cuando el servidor no autoriza el registro", async ({ page }) => {
    await page.route("**/api/auth/register/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          allowed: false,
          error: "No perteneces al grupo de Telegram.",
        }),
      }),
    );

    await page.goto("/registro");
    await page.getByLabel("Telegram ID").fill("714882477");
    const validationButton = page.locator(".telegram-check-button");
    await expect(validationButton).toBeEnabled({ timeout: 15_000 });

    await validationButton.click();
    await expect(validationButton).toHaveClass(/is-telegram-error(?:\s|$)/, { timeout: 5_000 });
    await expect(page.locator(".form-notice[role=alert]")).toHaveText("No perteneces al grupo de Telegram.");
    await expect(validationButton).toBeEnabled();
  });
});
