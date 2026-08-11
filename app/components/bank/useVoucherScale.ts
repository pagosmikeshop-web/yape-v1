"use client";

import { useEffect, useLayoutEffect } from "react";
import type { RefObject } from "react";

const FALLBACK_DESIGN_WIDTH = 412;
// La referencia visual ocupa 853 px frente a los 911 px de la versión ampliada.
// Este tope deja ese margen exterior sin alterar las proporciones internas.
export const REFERENCE_VOUCHER_MAX_SCALE = 0.9363;

// La medición debe ocurrir antes de pintar para que el comprobante no aparezca
// un fotograma a tamaño de diseño antes de reducirse.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Publica la escala uniforme del comprobante en su contenedor exterior.
 *
 * La superficie de diseño mide siempre `--voucher-design-width`; aquí sólo se
 * calcula cuánto hay que reducirla para caber en el ancho disponible. Nunca se
 * amplía por encima del diseño, porque el shell ya está limitado a ese ancho.
 *
 * También se publica el alto sin escalar de la superficie: la hoja de estilos
 * lo usa para devolver al flujo el espacio que la escala visual deja libre y
 * evitar así un hueco morado bajo el comprobante.
 */
export function useVoucherScale(
  surfaceRef: RefObject<HTMLDivElement | null>,
  active = true,
  maxScale = 1,
) {
  useIsomorphicLayoutEffect(() => {
    if (!active) return;

    const surface = surfaceRef.current;
    const frame = surface?.parentElement ?? null;
    if (!surface || !frame) return;

    let frameRequest = 0;

    const readDesignWidth = () => {
      const declared = getComputedStyle(surface).getPropertyValue(
        "--voucher-design-width",
      );
      const parsed = Number.parseFloat(declared);
      return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : FALLBACK_DESIGN_WIDTH;
    };

    const write = (property: string, value: string) => {
      // Escribir sólo ante un cambio real evita realimentar al ResizeObserver.
      if (frame.style.getPropertyValue(property) === value) return;
      frame.style.setProperty(property, value);
    };

    const apply = () => {
      window.cancelAnimationFrame(frameRequest);
      frameRequest = window.requestAnimationFrame(() => {
        const frameStyle = getComputedStyle(frame);
        const available =
          frame.clientWidth
          - Number.parseFloat(frameStyle.paddingLeft || "0")
          - Number.parseFloat(frameStyle.paddingRight || "0");
        if (!Number.isFinite(available) || available <= 0) return;

        const scale = Math.min(
          maxScale,
          available / readDesignWidth(),
        );
        write("--voucher-scale", String(scale));
        // offsetHeight ignora la transformación: es el alto real de maquetación.
        write("--voucher-surface-height", `${surface.offsetHeight}px`);
      });
    };

    const observer = new ResizeObserver(apply);
    observer.observe(frame);
    observer.observe(surface);
    apply();

    return () => {
      window.cancelAnimationFrame(frameRequest);
      observer.disconnect();
      frame.style.removeProperty("--voucher-scale");
      frame.style.removeProperty("--voucher-surface-height");
    };
  }, [active, maxScale, surfaceRef]);
}
