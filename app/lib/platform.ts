import { Capacitor } from "@capacitor/core";

export type RuntimePlatformName = "web" | "ios" | "android" | "unknown";

export type RuntimeCapabilities = {
  canShareFiles: boolean;
  clipboard: boolean;
  connectionInformation: boolean;
  geolocation: boolean;
  indexedDb: boolean;
  mediaDevices: boolean;
  motion: boolean;
  notifications: boolean;
  publicKeyCredential: boolean;
  push: boolean;
  screenOrientation: boolean;
  serviceWorker: boolean;
  share: boolean;
  storage: boolean;
  storagePersistence: boolean;
  visualViewport: boolean;
};

export type RuntimePlatform = {
  platform: RuntimePlatformName;
  isNative: boolean;
  isWeb: boolean;
  isStandalonePwa: boolean;
  isInstalledApp: boolean;
  isIos: boolean;
  isAndroid: boolean;
  isTouch: boolean;
  isOnline: boolean;
  capabilities: RuntimeCapabilities;
};

type NavigatorWithStandalone = Navigator & { standalone?: boolean };

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function hasNavigator(): boolean {
  return typeof navigator !== "undefined";
}

function getWebPlatformName(): RuntimePlatformName {
  if (!hasNavigator()) return "web";

  // Solo se usa como etiqueta de compatibilidad; la autorización nunca
  // depende del user agent.
  const userAgent = navigator.userAgent;
  const isIpadOs = /macintosh/iu.test(userAgent) && navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/iu.test(userAgent) || isIpadOs) return "ios";
  if (/android/iu.test(userAgent)) return "android";
  return "web";
}

function isStandaloneDisplayMode(): boolean {
  if (!hasWindow() || !hasNavigator()) return false;

  return (
    window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches
    || (navigator as NavigatorWithStandalone).standalone === true
  );
}

function getCapacitorPlatform(): RuntimePlatformName {
  if (!hasWindow() || !Capacitor.isNativePlatform()) return getWebPlatformName();

  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : "unknown";
}

function getCapabilities(): RuntimeCapabilities {
  if (!hasWindow() || !hasNavigator()) {
    return {
      canShareFiles: false,
      clipboard: false,
      connectionInformation: false,
      geolocation: false,
      indexedDb: false,
      mediaDevices: false,
      motion: false,
      notifications: false,
      publicKeyCredential: false,
      push: false,
      screenOrientation: false,
      serviceWorker: false,
      share: false,
      storage: false,
      storagePersistence: false,
      visualViewport: false,
    };
  }

  return {
    canShareFiles:
      typeof navigator.canShare === "function"
      && typeof File !== "undefined",
    clipboard: typeof navigator.clipboard?.writeText === "function",
    connectionInformation: "connection" in navigator,
    geolocation: "geolocation" in navigator,
    indexedDb: "indexedDB" in window,
    mediaDevices: Boolean(navigator.mediaDevices?.getUserMedia),
    motion: "DeviceMotionEvent" in window || "DeviceOrientationEvent" in window,
    notifications: "Notification" in window,
    publicKeyCredential: "PublicKeyCredential" in window,
    push: "PushManager" in window,
    screenOrientation: "orientation" in screen,
    serviceWorker: "serviceWorker" in navigator,
    share: typeof navigator.share === "function",
    storage: Boolean(navigator.storage?.estimate),
    storagePersistence: Boolean(navigator.storage?.persist),
    visualViewport: "visualViewport" in window,
  };
}

export async function getStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return null;
  }

  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) {
    return false;
  }

  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function getRuntimePlatform(): RuntimePlatform {
  const isNative = hasWindow() && Capacitor.isNativePlatform();
  const platform = getCapacitorPlatform();

  return {
    platform,
    isNative,
    isWeb: !isNative,
    isStandalonePwa: !isNative && isStandaloneDisplayMode(),
    isInstalledApp: isNative || isStandaloneDisplayMode(),
    isIos: platform === "ios",
    isAndroid: platform === "android",
    isTouch: hasNavigator() && navigator.maxTouchPoints > 0,
    isOnline: !hasNavigator() || navigator.onLine,
    capabilities: getCapabilities(),
  };
}

export const runtimePlatform = {
  get: getRuntimePlatform,
  isInstalledApp: (): boolean => getRuntimePlatform().isInstalledApp,
  hasPlugin: (pluginName: string): boolean =>
    hasWindow() && Capacitor.isPluginAvailable(pluginName),
};
