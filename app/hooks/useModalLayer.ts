"use client";

import { useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Añade a los overlays el comportamiento esperado de una app móvil:
 * foco contenido, Escape, restauración de foco y cierre con Atrás.
 */
export function useModalLayer<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
) {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  const historyMarker = useId();

  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    let historyEntryActive = true;
    const focusFrame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const firstControl =
        dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (firstControl ?? dialog)?.focus({ preventScroll: true });
    });

    const currentState =
      history.state && typeof history.state === "object" ? history.state : {};
    window.history.pushState(
      { ...currentState, __mobileModal: historyMarker },
      "",
    );
    document.body.style.overflow = "hidden";

    const closeFromHistory = () => {
      historyEntryActive = false;
      closeRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        if (historyEntryActive) {
          window.history.back();
        } else {
          closeRef.current();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      );
      if (controls.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = controls[0];
      const last = controls.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("popstate", closeFromHistory);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("popstate", closeFromHistory);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;

      if (
        historyEntryActive
        && history.state?.__mobileModal === historyMarker
      ) {
        window.history.back();
      }
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [historyMarker, open]);

  return dialogRef;
}
