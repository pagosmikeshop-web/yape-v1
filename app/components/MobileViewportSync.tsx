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
    let stableHeight = 0;
    let previousWidth = 0;

    const apply = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const visibleHeight = Math.round(
          viewport?.height ?? document.documentElement.clientHeight ?? window.innerHeight,
        );
        const layoutHeight = Math.round(
          Math.max(document.documentElement.clientHeight, window.innerHeight, visibleHeight),
        );
        const width = Math.round(viewport?.width ?? document.documentElement.clientWidth ?? window.innerWidth);
        const keyboardOpen = visibleHeight < layoutHeight - 80;
        const orientationChanged = previousWidth > 0 && Math.abs(previousWidth - width) > 48;

        if (orientationChanged) stableHeight = layoutHeight;
        if (!keyboardOpen || stableHeight === 0) {
          stableHeight = Math.max(stableHeight, layoutHeight);
        }
        previousWidth = width;

        if (Number.isFinite(stableHeight) && stableHeight > 0) {
          root.style.setProperty("--app-viewport-height", `${stableHeight}px`);
        }
        if (Number.isFinite(visibleHeight) && visibleHeight > 0) {
          root.style.setProperty("--app-visible-height", `${visibleHeight}px`);
          root.style.setProperty(
            "--app-keyboard-height",
            `${keyboardOpen ? Math.max(0, stableHeight - visibleHeight) : 0}px`,
          );
        }
        if (Number.isFinite(width) && width > 0) {
          root.style.setProperty("--app-viewport-width", `${width}px`);
        }

        root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";
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
      root.style.removeProperty("--app-visible-height");
      root.style.removeProperty("--app-keyboard-height");
      root.style.removeProperty("--app-viewport-width");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
