"use client";

import type { Dispatch, SetStateAction } from "react";
import { authErrorMessage } from "../../lib/auth-client";
import { safeClientMessage } from "../../lib/client-error";
import { clearSessionCache, setOptimisticUnlock } from "../../lib/session-cache";
import { unlockWithPlatformBiometric, WebAuthnClientError } from "../../lib/webauthn-client";
import { postAuth } from "./auth-request";
import { AUTH_UNLOCK_KEY, rolePath } from "./navigation";
import type { AuthUser, Notice } from "./types";

type Router = {
  replace: (href: string) => void;
};

export function useAuthUnlock({
  sessionUser,
  router,
  redirectInFlightRef,
  setNotice,
}: {
  sessionUser: AuthUser | null;
  router: Router;
  redirectInFlightRef: { current: boolean };
  setNotice: Dispatch<SetStateAction<Notice>>;
}) {
  async function unlockWithPin(pin: string) {
    setNotice(null);
    const endpoint = sessionUser?.mustSetPin || !sessionUser?.pinSet ? "/api/auth/pin" : "/api/auth/pin/verify";
    const data = await postAuth(endpoint, { pin }).catch((error: unknown) => {
      setNotice({ text: authErrorMessage(error, "No se pudo verificar la clave."), tone: "error" });
      return null;
    });
    if (!data || !sessionUser) return;
    clearSessionCache();
    setOptimisticUnlock(true);
    sessionStorage.setItem(AUTH_UNLOCK_KEY, "1");
    if (redirectInFlightRef.current) return;
    redirectInFlightRef.current = true;
    router.replace(rolePath({ ...sessionUser, mustSetPin: false, pinSet: true }));
  }

  async function unlockWithBio() {
    setNotice(null);
    try {
      await unlockWithPlatformBiometric();
      if (!sessionUser) return;
      clearSessionCache();
      setOptimisticUnlock(true);
      sessionStorage.setItem(AUTH_UNLOCK_KEY, "1");
      if (redirectInFlightRef.current) return;
      redirectInFlightRef.current = true;
      router.replace(rolePath({ ...sessionUser, mustSetPin: false, pinSet: true }));
    } catch (error) {
      const message = error instanceof WebAuthnClientError
        ? safeClientMessage(error, "No pudimos usar el biométrico. Usa tu clave.")
        : safeClientMessage(error, "No pudimos usar el biométrico. Usa tu clave.");
      // Fallback explícito: el teclado PIN sigue activo; solo avisamos.
      setNotice({ text: message, tone: "info" });
    }
  }

  return { unlockWithBio, unlockWithPin };
}
