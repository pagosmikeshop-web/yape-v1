import type { Page } from "@playwright/test";

export async function emulateInstalledPwa(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      value: true,
    });
  });
}
