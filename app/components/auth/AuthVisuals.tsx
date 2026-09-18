"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import { CSSProperties, useEffect, useRef, useState } from "react";
import type { TelegramValidationPhase } from "./types";

const TELEGRAM_ASSEMBLY_COLUMNS = 30;
const TELEGRAM_ASSEMBLY_ROWS = 5;
const telegramAssemblyCells = Array.from(
  { length: TELEGRAM_ASSEMBLY_COLUMNS * TELEGRAM_ASSEMBLY_ROWS },
  (_, index) => {
    const column = index % TELEGRAM_ASSEMBLY_COLUMNS;
    const row = Math.floor(index / TELEGRAM_ASSEMBLY_COLUMNS);

    return {
      key: `${row}-${column}`,
      style: {
        "--telegram-cell-column": column,
        "--telegram-cell-delay": (row * 7 + column * 3) % 22,
        "--telegram-cell-offset-y": ((column * 5 + row * 3) % 9) - 4,
      } as CSSProperties,
    };
  },
);

export function AuthAssetIcon({ name }: { name: string }) {
  return <img src={`/assets/apk/icons/${name}.svg`} alt="" aria-hidden="true" />;
}

export function AuthLottieIcon({
  name,
  className = "",
  fallbackIcon = "ic_touch_id_outline_yape_primary",
}: {
  name: string;
  className?: string;
  fallbackIcon?: string;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [showFallback, setShowFallback] = useState(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let destroyAnimation: (() => void) | null = null;
    let readyTimer: number | undefined;
    let removeDomLoaded: (() => void) | null = null;
    let removeDataFailed: (() => void) | null = null;

    const markReady = () => {
      if (!cancelled) setShowFallback(false);
    };
    const markFailed = () => {
      if (!cancelled) setShowFallback(true);
    };

    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (cancelled || !containerRef.current) return;
      const animation = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: `/assets/apk/lottie/${name}.json`,
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
          progressiveLoad: true,
        },
      });
      destroyAnimation = () => animation.destroy();
      removeDomLoaded = animation.addEventListener("DOMLoaded", markReady);
      removeDataFailed = animation.addEventListener("data_failed", markFailed);
      // Si el JSON tarda, el fallback SVG permanece visible.
      readyTimer = window.setTimeout(() => {
        if (!cancelled && containerRef.current && containerRef.current.childElementCount > 0) {
          markReady();
        }
      }, 1200);
    }).catch(() => {
      markFailed();
    });

    return () => {
      cancelled = true;
      if (readyTimer !== undefined) window.clearTimeout(readyTimer);
      removeDomLoaded?.();
      removeDataFailed?.();
      destroyAnimation?.();
      container.innerHTML = "";
    };
  }, [name]);

  return (
    <span className={`auth-lottie-icon ${className}`.trim()} aria-hidden="true">
      {showFallback ? (
        <img
          className="auth-lottie-fallback"
          src={`/assets/apk/icons/${fallbackIcon}.svg`}
          alt=""
        />
      ) : null}
      <span ref={containerRef} className="auth-lottie-canvas" />
    </span>
  );
}

export function ActionLabel({ label }: { label: string }) {
  return (
    <span className="auth-action-label" aria-hidden="true">
      {Array.from(label).map((character, index) => (
        <span
          className="auth-action-label__letter"
          key={`${index}-${character}`}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </span>
  );
}

export function TelegramValidationPerimeter() {
  return (
    <span className="telegram-validation-perimeter" aria-hidden="true">
      <svg className="telegram-validation-perimeter-svg" focusable="false" preserveAspectRatio="none">
        <rect className="telegram-perimeter-base" pathLength="1" />
        <rect className="telegram-perimeter-tail" pathLength="1" />
        <rect className="telegram-perimeter-head" pathLength="1" />
      </svg>
    </span>
  );
}

export function TelegramValidationAssembly({ active }: { active: boolean }) {
  if (!active) return null;

  return (
    <span className="telegram-validation-assembly" aria-hidden="true">
      {telegramAssemblyCells.map(({ key, style }) => (
        <span className="telegram-validation-assembly-cell" key={key} style={style} />
      ))}
      <span className="telegram-validation-build-front" />
    </span>
  );
}

export function TelegramValidationLabel({
  phase,
  registerChecking,
}: {
  phase: TelegramValidationPhase;
  registerChecking: boolean;
}) {
  const label = registerChecking ? "VALIDANDO DISPOSITIVO" : "VALIDAR TELEGRAM";

  return (
    <span className={`telegram-validation-label is-${phase}`} aria-hidden="true">
      <span className="telegram-validation-idle-content">
        <ActionLabel label={label} />
      </span>
      <span className="telegram-validation-status-content">
        <span className="telegram-validation-icon">
          <span className="telegram-validation-outcome-halo" />
          <svg viewBox="0 0 24 24" focusable="false">
            <circle className="telegram-validation-outcome-circle" cx="12" cy="12" r="8.75" pathLength="1" />
            <path className="telegram-validation-check" d="m6.9 12.25 3.1 3.1 7.15-7.3" pathLength="1" />
            <path className="telegram-validation-error-stem" d="M12 7.2v5.8" pathLength="1" />
            <circle className="telegram-validation-error-dot" cx="12" cy="16.3" r="1.05" />
          </svg>
        </span>
      </span>
    </span>
  );
}
