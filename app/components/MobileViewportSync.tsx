"use client";

import { useEffect } from "react";

/**
 * Sincroniza la altura real visible (incluyendo teclado iOS/Android)
 * en --app-viewport-height para que la PWA se comporte como app nativa.
 */
export function MobileViewportSync() {
  useEffect(() => {
    const root = document.documentElement;

    const apply = () => {
      const viewport = window.visualViewport;
      const height = Math.round(
        viewport?.height
          ? viewport.height + viewport.offsetTop
          : window.innerHeight,
      );
      const width = Math.round(viewport?.width ?? window.innerWidth);
      root.style.setProperty("--app-viewport-height", `${Math.max(height, 1)}px`);
      root.style.setProperty("--app-viewport-width", `${Math.max(width, 1)}px`);
      root.dataset.keyboardOpen = viewport && viewport.height < window.innerHeight - 80
        ? "true"
        : "false";
    };

    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);

    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
    };
  }, []);

  return null;
}
