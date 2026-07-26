"use client";

import { useEffect } from "react";

/**
 * Sincroniza la altura real visible (incluyendo teclado iOS/Android)
 * en --app-viewport-height para que la PWA se comporte como app nativa.
 */
export function MobileViewportSync() {
  useEffect(() => {
    const root = document.documentElement;
    let animationFrame = 0;

    const apply = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const height = Math.round(
          viewport?.height
            ?? document.documentElement.clientHeight
            ?? window.innerHeight,
        );
        const width = Math.round(viewport?.width ?? window.innerWidth);

        if (Number.isFinite(height) && height > 0) {
          root.style.setProperty("--app-viewport-height", `${height}px`);
        }
        if (Number.isFinite(width) && width > 0) {
          root.style.setProperty("--app-viewport-width", `${width}px`);
        }

        root.dataset.keyboardOpen =
          viewport && viewport.height < window.innerHeight - 80
            ? "true"
            : "false";
      });
    };
    const applyWhenVisible = () => {
      if (document.visibilityState === "visible") apply();
    };

    apply();
    window.addEventListener("resize", apply);
    window.addEventListener("orientationchange", apply);
    window.addEventListener("pageshow", apply);
    window.visualViewport?.addEventListener("resize", apply);
    window.visualViewport?.addEventListener("scroll", apply);
    document.addEventListener("visibilitychange", applyWhenVisible);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("pageshow", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
      document.removeEventListener("visibilitychange", applyWhenVisible);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-width");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
