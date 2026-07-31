import { getRuntimePlatform } from "./platform";

export type InstallEnvironment = {
  isAndroid: boolean;
  isIos: boolean;
  isMobile: boolean;
  isSafari: boolean;
};

/**
 * Capacitor y la PWA comparten una sola detección de plataforma. La función
 * es segura durante SSR porque `getRuntimePlatform` no toca el navegador al
 * cargar el módulo.
 */
export function isNativeApp(): boolean {
  return getRuntimePlatform().isNative;
}

export function getInstallEnvironment(): InstallEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      isAndroid: false,
      isIos: false,
      isMobile: false,
      isSafari: false,
    };
  }

  const platform = getRuntimePlatform();
  const userAgent = navigator.userAgent;
  const isSafari =
    /safari/iu.test(userAgent)
    && !/crios|fxios|edgios|opios|duckduckgo/iu.test(userAgent);

  return {
    isAndroid: platform.isAndroid,
    isIos: platform.isIos,
    isMobile: platform.isAndroid || platform.isIos,
    isSafari,
  };
}

export function isInstalledApp(): boolean {
  return getRuntimePlatform().isInstalledApp;
}
