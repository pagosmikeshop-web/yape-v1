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
