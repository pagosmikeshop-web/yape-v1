export type InstallEnvironment = {
  isAndroid: boolean;
  isIos: boolean;
  isMobile: boolean;
  isNativeShell: boolean;
  isSafari: boolean;
};

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean;
};

export function getInstallEnvironment(): InstallEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      isAndroid: false,
      isIos: false,
      isMobile: false,
      isNativeShell: false,
      isSafari: false,
    };
  }

  const userAgent = navigator.userAgent;
  const isAndroid = /android/iu.test(userAgent);
  const isIpadOs = /macintosh/iu.test(userAgent) && navigator.maxTouchPoints > 1;
  const isIos = /iphone|ipad|ipod/iu.test(userAgent) || isIpadOs;
  const isSafari =
    /safari/iu.test(userAgent)
    && !/crios|fxios|edgios|opios|duckduckgo/iu.test(userAgent);
  const isNativeShell = ["capacitor:", "ionic:"].includes(window.location.protocol);

  return {
    isAndroid,
    isIos,
    isMobile: isAndroid || isIos,
    isNativeShell,
    isSafari,
  };
}

export function isInstalledApp() {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const fullscreen = window.matchMedia("(display-mode: fullscreen)").matches;
  const iosStandalone = (navigator as NavigatorWithStandalone).standalone === true;
  const nativeShell = ["capacitor:", "ionic:"].includes(window.location.protocol);

  return standalone || fullscreen || iosStandalone || nativeShell;
}
