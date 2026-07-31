export type WebLifecycleEvent =
  | { type: "visibilitychange"; visible: boolean }
  | { type: "pagehide"; persisted: boolean }
  | { type: "pageshow"; persisted: boolean }
  | { type: "online" }
  | { type: "offline" }
  | { type: "orientationchange" }
  | { type: "displaymodechange"; standalone: boolean };

type Listener = (event: WebLifecycleEvent) => void;
type DisplayModeQuery = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

const listeners = new Set<Listener>();
let cleanupGlobalListeners: (() => void) | null = null;

function emit(event: WebLifecycleEvent): void {
  for (const listener of listeners) listener(event);
}

function installGlobalListeners(): void {
  if (cleanupGlobalListeners || typeof window === "undefined") return;

  const displayMode = typeof window.matchMedia === "function"
    ? window.matchMedia("(display-mode: standalone)") as DisplayModeQuery
    : null;
  const handleVisibility = () => emit({
    type: "visibilitychange",
    visible: document.visibilityState === "visible",
  });
  const handlePageHide = (event: PageTransitionEvent) => emit({
    type: "pagehide",
    persisted: event.persisted,
  });
  const handlePageShow = (event: PageTransitionEvent) => emit({
    type: "pageshow",
    persisted: event.persisted,
  });
  const handleOnline = () => emit({ type: "online" });
  const handleOffline = () => emit({ type: "offline" });
  const handleOrientation = () => emit({ type: "orientationchange" });
  const handleDisplayMode = () => emit({
    type: "displaymodechange",
    standalone: displayMode?.matches ?? false,
  });

  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  window.addEventListener("orientationchange", handleOrientation);
  if (typeof displayMode?.addEventListener === "function") {
    displayMode.addEventListener("change", handleDisplayMode);
  } else if (displayMode) {
    displayMode.addListener?.(handleDisplayMode);
  }

  cleanupGlobalListeners = () => {
    document.removeEventListener("visibilitychange", handleVisibility);
    window.removeEventListener("pagehide", handlePageHide);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
    window.removeEventListener("orientationchange", handleOrientation);
    if (typeof displayMode?.removeEventListener === "function") {
      displayMode.removeEventListener("change", handleDisplayMode);
    } else if (displayMode) {
      displayMode.removeListener?.(handleDisplayMode);
    }
    cleanupGlobalListeners = null;
  };
}

export function subscribeToWebLifecycle(listener: Listener): () => void {
  if (typeof window === "undefined") return () => undefined;

  listeners.add(listener);
  installGlobalListeners();

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) cleanupGlobalListeners?.();
  };
}
