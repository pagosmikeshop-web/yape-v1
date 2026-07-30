export function resetIOSViewport(scrollContainer?: HTMLElement | null) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const animationFrames: number[] = [];
  const timeouts: number[] = [];
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLElement) {
    activeElement.blur();
  }

  const resetScroll = () => {
    window.scrollTo(0, 0);
    document.scrollingElement?.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    scrollContainer?.scrollTo(0, 0);
  };

  const queueFrame = (callback: () => void) => {
    const frame = window.requestAnimationFrame(callback);
    animationFrames.push(frame);
  };

  queueFrame(() => {
    resetScroll();
    queueFrame(resetScroll);
  });

  timeouts.push(window.setTimeout(resetScroll, 180));
  timeouts.push(window.setTimeout(resetScroll, 360));

  return () => {
    for (const frame of animationFrames) window.cancelAnimationFrame(frame);
    for (const timeout of timeouts) window.clearTimeout(timeout);
  };
}

function syncVisualViewportVariables() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const viewport = window.visualViewport;
  const visibleHeight = Math.round(
    viewport?.height ?? document.documentElement.clientHeight ?? window.innerHeight,
  );
  const visibleWidth = Math.round(
    viewport?.width ?? document.documentElement.clientWidth ?? window.innerWidth,
  );
  const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
  const offsetLeft = Math.max(0, Math.round(viewport?.offsetLeft ?? 0));

  if (Number.isFinite(visibleHeight) && visibleHeight > 0) {
    root.style.setProperty("--app-height", `${visibleHeight}px`);
    root.style.setProperty("--visible-app-height", `${visibleHeight + offsetTop}px`);
  }

  if (Number.isFinite(visibleWidth) && visibleWidth > 0) {
    root.style.setProperty("--app-viewport-width", `${visibleWidth}px`);
  }

  root.style.setProperty("--visual-offset-top", `${offsetTop}px`);
  root.style.setProperty("--app-viewport-offset-top", `${offsetTop}px`);
  root.style.setProperty("--app-viewport-offset-left", `${offsetLeft}px`);
}

export function settleIOSViewport(scrollContainer?: HTMLElement | null) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  const cleanupReset = resetIOSViewport(scrollContainer);
  const animationFrames: number[] = [];
  const timeouts: number[] = [];

  const refresh = () => {
    syncVisualViewportVariables();
    scrollContainer?.scrollTo(0, 0);
  };

  const queueFrame = (callback: () => void) => {
    const frame = window.requestAnimationFrame(callback);
    animationFrames.push(frame);
  };

  refresh();
  queueFrame(() => {
    refresh();
    queueFrame(refresh);
  });

  timeouts.push(window.setTimeout(refresh, 180));
  timeouts.push(window.setTimeout(refresh, 360));

  return () => {
    cleanupReset();
    for (const frame of animationFrames) window.cancelAnimationFrame(frame);
    for (const timeout of timeouts) window.clearTimeout(timeout);
  };
}
