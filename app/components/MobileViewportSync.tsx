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
      const visualHeight = viewport
        ? viewport.height + viewport.offsetTop
        : 0;
      // Usar el mayor valor evita franjas del color de fondo cuando iOS
      // reporta un visualViewport más bajo que el área real de la app.
      const height = Math.round(
        Math.max(visualHeight, window.innerHeight, document.documentElement.clientHeight, 1),
      );
      const width = Math.round(
        Math.max(viewport?.width ?? 0, window.innerWidth, 1),
      );
      root.style.setProperty("--app-viewport-height", `${height}px`);
      root.style.setProperty("--app-viewport-width", `${width}px`);
      root.dataset.keyboardOpen =
        viewport && viewport.height < window.innerHeight - 80 ? "true" : "false";
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
