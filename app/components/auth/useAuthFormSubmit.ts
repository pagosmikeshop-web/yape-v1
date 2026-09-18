"use client";

import type { Dispatch, FormEvent, RefObject, SetStateAction } from "react";
import { createDeviceProof } from "../../lib/device-key";
import { authErrorMessage, createAuthAttemptId } from "../../lib/auth-client";
import { safeApiMessage } from "../../lib/client-error";
import { saveLocalRegistrationAnchor } from "../../lib/registration-device";
import { AUTH_UNLOCK_KEY, rolePath } from "./navigation";
import type {
  AccessLookup,
  AuthUser,
  Notice,
  RecoveryChallenge,
  RecoveryRequest,
  Screen,
} from "./types";

type AuthPost = (
  path: string,
  payload: Record<string, unknown>,
  attemptId?: string,
) => Promise<Record<string, unknown>>;

type Router = {
  replace: (href: string) => void;
};

export function useAuthFormSubmit({
  screen,
  formRef,
  fingerprintId,
  recoveryChallenge,
  authActionInFlightRef,
  clearRegistrationPermission,
  post,
  router,
  setAccessLookup,
  setBusy,
  setNotice,
  setRecoveryChallenge,
  setRecoveryRequest,
  setSessionUser,
}: {
  screen: Screen;
  formRef: RefObject<HTMLFormElement | null>;
  fingerprintId: string;
  recoveryChallenge: RecoveryChallenge | null;
  authActionInFlightRef: { current: boolean };
  clearRegistrationPermission: () => void;
  post: AuthPost;
  router: Router;
  setAccessLookup: Dispatch<SetStateAction<AccessLookup | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<Notice>>;
  setRecoveryChallenge: Dispatch<SetStateAction<RecoveryChallenge | null>>;
  setRecoveryRequest: Dispatch<SetStateAction<RecoveryRequest | null>>;
  setSessionUser: Dispatch<SetStateAction<AuthUser | null>>;
}) {
  return async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (authActionInFlightRef.current) return;
    authActionInFlightRef.current = true;
    setBusy(true);
    setNotice(null);
    const formData = new FormData(event.currentTarget);
    const attemptId = createAuthAttemptId();

    try {
      if (screen === "login") {
        const sellerId = String(formData.get("seller-id") ?? "");
        const username = String(formData.get("username") ?? "");
        const password = String(formData.get("password") ?? "");
        const proof = await createDeviceProof(sellerId, username);
        const data = await post("/api/auth/login", { sellerId, username, password, ...proof }, attemptId);
        const user = data.user as AuthUser;
        sessionStorage.removeItem(AUTH_UNLOCK_KEY);
        if (user.mustChangePassword) {
          router.replace("/cambiar-contrasena");
          return;
        }
        setSessionUser(user);
        return;
      }

      if (screen === "register") {
        const password = String(formData.get("new-password") ?? "");
        const confirmation = String(formData.get("confirm-password") ?? "");
        const pin = String(formData.get("pin") ?? "").replace(/\D/gu, "");
        const pinConfirmation = String(formData.get("confirm-pin") ?? "").replace(/\D/gu, "");
        if (!fingerprintId) throw new Error("Espera la validacion del dispositivo.");
        if (password !== confirmation) throw new Error("Las contrasenas no coinciden.");
        if (pin !== pinConfirmation) throw new Error("Las claves de 6 digitos no coinciden.");
        const data = await post("/api/auth/register", {
          telegramUserId: String(formData.get("telegram-id") ?? ""),
          username: String(formData.get("username") ?? ""),
          referralCode: String(formData.get("referral-code") ?? ""),
          password,
          pin,
          fingerprintId,
        }, attemptId);
        await saveLocalRegistrationAnchor(fingerprintId);
        formRef.current?.reset();
        clearRegistrationPermission();
        const user = data.user as AuthUser & { loginId?: string };
        const expiresLabel = typeof data.accessExpiresAt === "string"
          ? new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.accessExpiresAt))
          : "";
        setNotice({
          text: `${safeApiMessage(data.message, "Registro completado y prueba de 30 días activada.")}${expiresLabel ? ` Vence: ${expiresLabel}.` : ""} Tu ID de ingreso es ${String(user.loginId ?? "")}.`,
          tone: "info",
        });
        sessionStorage.setItem(AUTH_UNLOCK_KEY, "1");
        setSessionUser({
          ...user,
          unlocked: true,
          accessExpiresAt: typeof data.accessExpiresAt === "string" ? data.accessExpiresAt : user.accessExpiresAt ?? null,
        });
        window.setTimeout(() => router.replace(rolePath({ ...user, unlocked: true })), 900);
        return;
      }

      if (screen === "change-password") {
        await post("/api/auth/password/change", {
          currentPassword: String(formData.get("old-password") ?? ""),
          newPassword: String(formData.get("new-password") ?? ""),
        }, attemptId);
        sessionStorage.removeItem(AUTH_UNLOCK_KEY);
        setNotice({ text: "Contraseña actualizada. Ahora configura o verifica tu clave.", tone: "info" });
        window.setTimeout(() => router.replace("/"), 700);
        return;
      }

      if (screen === "change-number") {
        const sellerId = String(formData.get("change-number-telegram-id") ?? "").trim();
        const username = String(formData.get("change-number-username") ?? "").trim().replace(/^@/u, "");
        const password = String(formData.get("change-number-password") ?? "");
        const token = String(formData.get("permanent-access-token") ?? "").trim();
        if (!/^\d{4,24}$/u.test(sellerId) && sellerId !== "YAPE") throw new Error("Ingresa tu Telegram ID de acceso.");
        if (!/^[A-Za-z0-9_.-]{3,40}$/u.test(username)) throw new Error("Ingresa tu usuario registrado.");
        if (!token) throw new Error("Ingresa el token entregado por tu vendedor.");
        const proof = await createDeviceProof(sellerId, username);
        const data = await post("/api/access/redeem", { sellerId, username, password, token, ...proof }, attemptId);
        setAccessLookup({
          permanent: true,
          accessExpiresAt: null,
          referralCode: typeof data.referralCode === "string" ? data.referralCode : null,
          displayName: String((data.user as { displayName?: unknown } | undefined)?.displayName ?? username),
        });
        sessionStorage.removeItem(AUTH_UNLOCK_KEY);
        setNotice({ text: safeApiMessage(data.message, "Tu acceso ahora es permanente. Ya puedes ingresar."), tone: "info" });
        window.setTimeout(() => router.replace("/"), 1100);
        return;
      }

      if (screen === "recover") {
        if (!recoveryChallenge) {
          const sellerId = String(formData.get("recover-seller-id") ?? "");
          const username = String(formData.get("recover-username") ?? "");
          const data = await post("/api/auth/password/reset/request", {
            sellerId,
            username,
          }, attemptId);
          const requestId = String(data.requestId ?? "");
          if (!requestId || data.pending !== true) {
            setNotice({ text: "No pudimos validar los datos para solicitar el restablecimiento.", tone: "error" });
            return;
          }
          setRecoveryRequest({ id: requestId, sellerId, username });
          setNotice({ text: safeApiMessage(data.message, "Solicitud enviada. Tu vendedor debe aprobar el restablecimiento."), tone: "info" });
        } else {
          const newPassword = String(formData.get("recover-new-password") ?? "");
          const confirmation = String(formData.get("recover-confirm-password") ?? "");
          if (newPassword !== confirmation) throw new Error("Las contraseñas nuevas no coinciden.");
          if (!recoveryChallenge) throw new Error("Aun no se aprueba la solicitud.");
          await post("/api/auth/password/reset/complete", {
            requestId: recoveryChallenge.requestId,
            resetToken: recoveryChallenge.token,
            newPassword,
          }, attemptId);
          setNotice({ text: "Contraseña restablecida. Ya puedes iniciar sesión.", tone: "info" });
          setRecoveryRequest(null);
          setRecoveryChallenge(null);
          window.setTimeout(() => router.replace("/"), 900);
        }
        return;
      }
    } catch (error) {
      const accessError = error as Error & { code?: string; referralCode?: string };
      const referral = accessError.code === "ACCESS_EXPIRED" && accessError.referralCode
        ? ` Tu código es ${accessError.referralCode}.`
        : "";
      setNotice({ text: `${authErrorMessage(error)}${referral}`, tone: "error" });
    } finally {
      authActionInFlightRef.current = false;
      setBusy(false);
    }
  };
}
