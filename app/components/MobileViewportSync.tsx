"use client";

import { useEffect } from "react";

const KEYBOARD_THRESHOLD_PX = 120;
const FOCUSED_CONTROL_GUTTER_PX = 12;

function isEditableControl(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;

  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    return !element.disabled;
  }

  if (!(element instanceof HTMLInputElement) || element.disabled || element.readOnly) {
    return false;
  }

  return !["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(
    element.type,
  );
}

function findScrollContainer(element: HTMLElement) {
  let current = element.parentElement;

  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll")
      && current.scrollHeight > current.clientHeight
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return element.closest<HTMLElement>(
    "[data-mobile-scroll], [role='dialog'], .login-card, .bank-scroll-area",
  );
}

/**
 * Android puede conservar un paneo horizontal del layout viewport cuando el
 * teclado reduce el visual viewport. La transferencia tiene sus propios
 * scrollers internos; mantenerlos en X=0 evita que el nombre o las acciones
 * queden parcialmente fuera de pantalla sin tocar el desplazamiento vertical.
 */
function resetTransferHorizontalScroll() {
  const transferShell = document.querySelector<HTMLElement>(
    ".mobile-bank-shell.view-transfer",
  );
  if (!transferShell) return;

  transferShell.scrollLeft = 0;
  transferShell.querySelectorAll<HTMLElement>(
    ".bank-scroll-area, .transfer-amount-content, .transfer-flow-content",
  ).forEach((container) => {
    if (container.scrollLeft !== 0) container.scrollLeft = 0;
  });
}

/**
 * Mantiene el shell alineado con el visual viewport real. La altura base solo
 * se conserva para detectar el teclado; nunca se usa para dimensionar la UI.
 */
export function MobileViewportSync() {
  useEffect(() => {
    const root = document.documentElement;
    let animationFrame = 0;
    let focusFrame = 0;
    let baselineHeight = 0;
    let previousWidth = 0;
    let keyboardWasOpen = false;
    let lastEnsuredControl: HTMLElement | null = null;
    let restoreContainer: HTMLElement | null = null;
    let restoreScrollTop = 0;

    const keepFocusedControlVisible = (
      control: HTMLElement,
      visibleHeight: number,
      offsetTop: number,
    ) => {
      const container = findScrollContainer(control);
      if (!container) return;

      const controlRect = control.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const visibleTop = Math.max(offsetTop, containerRect.top) + FOCUSED_CONTROL_GUTTER_PX;
      const visibleBottom =
        Math.min(offsetTop + visibleHeight, containerRect.bottom) - FOCUSED_CONTROL_GUTTER_PX;

      if (controlRect.top < visibleTop) {
        container.scrollTop += controlRect.top - visibleTop;
      } else if (controlRect.bottom > visibleBottom) {
        container.scrollTop += controlRect.bottom - visibleBottom;
      }
    };

    const apply = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const viewport = window.visualViewport;
        const visibleHeight = Math.round(
          viewport?.height ?? document.documentElement.clientHeight ?? window.innerHeight,
        );
        const width = Math.round(viewport?.width ?? document.documentElement.clientWidth ?? window.innerWidth);
        const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
        const offsetLeft = Math.max(0, Math.round(viewport?.offsetLeft ?? 0));
        const activeControl = isEditableControl(document.activeElement) ? document.activeElement : null;
        const orientationChanged = previousWidth > 0 && Math.abs(previousWidth - width) > 48;

        if (orientationChanged) {
          baselineHeight = visibleHeight;
          keyboardWasOpen = false;
          lastEnsuredControl = null;
          restoreContainer = null;
        } else if (!activeControl && !keyboardWasOpen) {
          baselineHeight = Math.max(baselineHeight, visibleHeight);
        }
        if (baselineHeight === 0) baselineHeight = visibleHeight;

        const coveredHeight = Math.max(0, baselineHeight - visibleHeight);
        const keyboardOpen =
          coveredHeight > KEYBOARD_THRESHOLD_PX && (activeControl !== null || keyboardWasOpen);
        previousWidth = width;

        if (Number.isFinite(visibleHeight) && visibleHeight > 0) {
          root.style.setProperty("--app-height", `${visibleHeight}px`);
          root.style.setProperty(
            "--visible-app-height",
            `${Math.round(visibleHeight + offsetTop)}px`,
          );
        }
        if (Number.isFinite(width) && width > 0) {
          root.style.setProperty("--app-viewport-width", `${width}px`);
        }
        root.style.setProperty(
          "--keyboard-height",
          `${keyboardOpen ? coveredHeight : 0}px`,
        );
        root.style.setProperty("--visual-offset-top", `${offsetTop}px`);
        root.style.setProperty("--app-viewport-offset-top", `${offsetTop}px`);
        root.style.setProperty("--app-viewport-offset-left", `${offsetLeft}px`);

        resetTransferHorizontalScroll();

        root.dataset.keyboardOpen = keyboardOpen ? "true" : "false";

        if (keyboardOpen && activeControl && (!keyboardWasOpen || activeControl !== lastEnsuredControl)) {
          window.cancelAnimationFrame(focusFrame);
          focusFrame = window.requestAnimationFrame(() => {
            keepFocusedControlVisible(activeControl, visibleHeight, offsetTop);
          });
          lastEnsuredControl = activeControl;
        }

        if (!keyboardOpen && keyboardWasOpen && restoreContainer?.isConnected) {
          const container = restoreContainer;
          const savedScrollTop = restoreScrollTop;
          window.cancelAnimationFrame(focusFrame);
          focusFrame = window.requestAnimationFrame(() => {
            const maximumScroll = Math.max(0, container.scrollHeight - container.clientHeight);
            container.scrollTop = Math.min(savedScrollTop, maximumScroll);
          });
          restoreContainer = null;
          lastEnsuredControl = null;
        }

        keyboardWasOpen = keyboardOpen;
      });
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!keyboardWasOpen && isEditableControl(target)) {
        restoreContainer = findScrollContainer(target);
        restoreScrollTop = restoreContainer?.scrollTop ?? 0;
      }
      apply();
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
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", apply);
    document.addEventListener("visibilitychange", applyWhenVisible);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("resize", apply);
      window.removeEventListener("orientationchange", apply);
      window.removeEventListener("pageshow", apply);
      window.visualViewport?.removeEventListener("resize", apply);
      window.visualViewport?.removeEventListener("scroll", apply);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", apply);
      document.removeEventListener("visibilitychange", applyWhenVisible);
      root.style.removeProperty("--app-height");
      root.style.removeProperty("--visible-app-height");
      root.style.removeProperty("--app-viewport-width");
      root.style.removeProperty("--keyboard-height");
      root.style.removeProperty("--visual-offset-top");
      root.style.removeProperty("--app-viewport-offset-top");
      root.style.removeProperty("--app-viewport-offset-left");
      delete root.dataset.keyboardOpen;
    };
  }, []);

  return null;
}
