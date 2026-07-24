"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import { useEffect, useRef } from "react";

export const APK_ASSET_ROOT = "/assets/apk";

export function AssetIcon({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <img
      className={`apk-icon ${className}`.trim()}
      src={`${APK_ASSET_ROOT}/icons/${name}.svg`}
      alt=""
      aria-hidden="true"
      decoding="async"
      loading="lazy"
    />
  );
}

export function AssetIllustration({
  name,
  className = "",
}: {
  name: string;
  className?: string;
}) {
  return (
    <img
      className={`apk-illustration ${className}`.trim()}
      src={`${APK_ASSET_ROOT}/illustrations/${name}.svg`}
      alt=""
      aria-hidden="true"
    />
  );
}

type LottieHandle = {
  destroy: () => void;
  addEventListener: (name: "complete", callback: () => void) => void;
  removeEventListener: (name: "complete", callback: () => void) => void;
  goToAndStop: (value: number, isFrame: boolean) => void;
};

/** Plays one of the original APK Lottie animations (public/assets/apk/lottie). */
export function LottiePlayer({
  name,
  src,
  className = "",
  loop = true,
  autoplay = true,
  renderer = "svg",
  preserveAspectRatio = "xMidYMid meet",
  freezeAtFrame,
  hideOnComplete = false,
  completionFallbackMs = 3000,
}: {
  name?: string;
  src?: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  renderer?: "svg" | "canvas";
  preserveAspectRatio?: string;
  freezeAtFrame?: number;
  hideOnComplete?: boolean;
  completionFallbackMs?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resolvedPath = src ?? `${APK_ASSET_ROOT}/lottie/${name}.json`;

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.hidden = false;
    let handle: LottieHandle | undefined;
    let completionTimer: number | undefined;
    let cancelled = false;
    const finishAnimation = () => {
      if (freezeAtFrame !== undefined) handle?.goToAndStop(freezeAtFrame, true);
      if (hideOnComplete) node.hidden = true;
    };

    const player =
      renderer === "canvas"
        ? import("lottie-web/build/player/lottie_light_canvas")
        : import("lottie-web/build/player/lottie_light");
    player.then(({ default: lottie }) => {
      if (cancelled || !node) return;
      handle = lottie.loadAnimation({
        container: node,
        renderer,
        loop,
        autoplay,
        path: resolvedPath,
        rendererSettings: { preserveAspectRatio },
      });
      if (freezeAtFrame !== undefined || hideOnComplete) {
        handle.addEventListener("complete", finishAnimation);
        completionTimer = window.setTimeout(
          finishAnimation,
          completionFallbackMs,
        );
      }
    });

    return () => {
      cancelled = true;
      if (completionTimer !== undefined) window.clearTimeout(completionTimer);
      if (freezeAtFrame !== undefined || hideOnComplete)
        handle?.removeEventListener("complete", finishAnimation);
      handle?.destroy();
    };
  }, [
    autoplay,
    completionFallbackMs,
    freezeAtFrame,
    hideOnComplete,
    loop,
    preserveAspectRatio,
    renderer,
    resolvedPath,
  ]);

  return (
    <div
      ref={containerRef}
      className={`apk-lottie ${className}`.trim()}
      data-lottie-src={resolvedPath}
      aria-hidden="true"
    />
  );
}

export function Money({ value }: { value: number }) {
  const formatted = new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    minimumFractionDigits: 2,
  })
    .format(Math.abs(value))
    .replace(/\u00a0/g, " ");

  return (
    <span className={value >= 0 ? "money-in" : "money-out"}>
      {value < 0 ? "- " : ""}
      {formatted}
    </span>
  );
}
