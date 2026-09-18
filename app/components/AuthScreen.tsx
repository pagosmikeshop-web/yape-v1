"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createDeviceProof } from "../lib/device-key";
import { authErrorMessage, createAuthAttemptId } from "../lib/auth-client";
import { safeClientMessage } from "../lib/client-error";
import { getFingerprintId } from "../lib/registration-device";
import { AuthHeader, Field, PasswordField } from "./auth/AuthFormControls";
import {
  ActionLabel,
  AuthAssetIcon,
  TelegramValidationAssembly,
  TelegramValidationLabel,
  TelegramValidationPerimeter,
} from "./auth/AuthVisuals";
import { ReturningKeypad } from "./auth/ReturningKeypad";
import { postAuth } from "./auth/auth-request";
import { AUTH_UNLOCK_KEY, rolePath } from "./auth/navigation";
import type { AccessLookup, AuthUser, Notice, RecoveryChallenge, RecoveryRequest, Screen } from "./auth/types";
import { useAuthFormSubmit } from "./auth/useAuthFormSubmit";
import { useAuthUnlock } from "./auth/useAuthUnlock";
import { useTelegramRegistrationValidation } from "./auth/useTelegramRegistrationValidation";

let welcomeDismissedForAppSession = false;

const screenContent: Record<Screen, { title: string; subtitle: string }> = {
  login: { title: "Iniciar Sesión", subtitle: "Ingresa con el usuario autorizado por tu vendedor" },
  register: { title: "Crear cuenta", subtitle: "Valida tu Telegram y configura tu clave de ingreso" },
  "change-password": { title: "Restablecer Contraseña", subtitle: "Cambia tu contraseña de forma segura" },
  recover: { title: "Recuperar Contraseña", subtitle: "Solicita el restablecimiento desde cualquier dispositivo" },
  "change-number": { title: "Acceso y cambio de número", subtitle: "Consulta tu suscripción, usa tu token o contacta a soporte" },
};

export function AuthScreen({ screen }: { screen: Screen }) {
  const content = screenContent[screen];
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(screen === "login");
  const [busy, setBusy] = useState(false);
  const [recoveryRequest, setRecoveryRequest] = useState<RecoveryRequest | null>(null);
  const [recoveryChallenge, setRecoveryChallenge] = useState<RecoveryChallenge | null>(null);
  const [fingerprintId, setFingerprintId] = useState("");
  const [registerChecking, setRegisterChecking] = useState(screen === "register");
  const [accessLookup, setAccessLookup] = useState<AccessLookup | null>(null);
  const [showWelcome, setShowWelcome] = useState(screen === "login" && !welcomeDismissedForAppSession);
  const authActionInFlightRef = useRef(false);
  const loginSessionCheckStartedRef = useRef(false);
  const redirectInFlightRef = useRef(false);
  const {
    clearRegistrationPermission,
    groupInviteUrl,
    registerAllowed,
    resetTelegramRegistrationValidation,
    telegramValidationPhase,
    verifyTelegramForRegister,
  } = useTelegramRegistrationValidation({
    screen,
    fingerprintId,
    formRef,
    busy,
    authActionInFlightRef,
    setBusy,
    setNotice,
    post: postAuth,
  });
  const handleSubmit = useAuthFormSubmit({
    screen,
    formRef,
    fingerprintId,
    recoveryChallenge,
    authActionInFlightRef,
    clearRegistrationPermission,
    post: postAuth,
    router,
    setAccessLookup,
    setBusy,
    setNotice,
    setRecoveryChallenge,
    setRecoveryRequest,
    setSessionUser,
  });
  const { unlockWithBio, unlockWithPin } = useAuthUnlock({
    sessionUser,
    router,
    redirectInFlightRef,
    setNotice,
  });

  useEffect(() => {
    if (screen !== "login" || loginSessionCheckStartedRef.current) return;
    loginSessionCheckStartedRef.current = true;
    let cancelled = false;
    fetch("/api/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-auth-attempt": createAuthAttemptId() },
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok && response.status !== 401 && response.status !== 403) {
        throw new Error("No pudimos comprobar tu sesión. Revisa tu conexión e inténtalo nuevamente.");
      }
      return data;
    }).then((data) => {
      if (cancelled) return;
      if (data?.code === "ACCESS_EXPIRED") {
        const code = typeof data.referralCode === "string" && data.referralCode ? ` Tu código es ${data.referralCode}.` : "";
        setNotice({ text: `Tu suscripción terminó. Canjea un token permanente en Cambio de número o comparte tu código para que alguien del grupo escriba /redeem y te dé 3 días.${code}`, tone: "error" });
        return;
      }
      const user = data?.user as AuthUser | null;
      if (!user) return;
      if (user.mustChangePassword) {
        if (redirectInFlightRef.current) return;
        redirectInFlightRef.current = true;
        router.replace("/cambiar-contrasena");
      }
      else if (user.unlocked) {
        sessionStorage.setItem(AUTH_UNLOCK_KEY, "1");
        if (redirectInFlightRef.current) return;
        redirectInFlightRef.current = true;
        router.replace(rolePath(user));
      } else setSessionUser(user);
    }).catch((error: unknown) => {
      if (!cancelled) setNotice({ text: authErrorMessage(error, "No pudimos comprobar tu sesión. Revisa tu conexión e inténtalo nuevamente."), tone: "error" });
    }).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [screen]);

  useEffect(() => {
    if (screen !== "login" || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("reason") === "expired") {
      const timer = window.setTimeout(() => {
        setNotice({ text: "Tu suscripción terminó. Canjea un token permanente en Cambio de número o comparte tu código para que alguien del grupo escriba /redeem y te dé 3 días.", tone: "error" });
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [screen]);

  useEffect(() => {
    if (screen !== "register") return;
    let cancelled = false;
    getFingerprintId().then(async (id) => {
      if (cancelled) return;
      setFingerprintId(id);
    }).catch((error: Error) => {
      if (!cancelled) setNotice({ text: safeClientMessage(error, "No pudimos preparar el acceso biométrico."), tone: "error" });
    }).finally(() => {
      if (!cancelled) setRegisterChecking(false);
    });
    return () => { cancelled = true; };
  }, [screen]);

  useEffect(() => {
    if (screen !== "recover" || !recoveryRequest || recoveryChallenge) return;
    let cancelled = false;
    let timer: number | undefined;
    let polling = false;
    const checkApproval = async () => {
      if (polling) return;
      polling = true;
      try {
        const data = await postAuth("/api/auth/password/reset/status", {
          requestId: recoveryRequest.id,
          sellerId: recoveryRequest.sellerId,
          username: recoveryRequest.username,
        });
        if (cancelled) return;
        if (data.status === "approved" && data.requestId && data.resetToken) {
          setRecoveryChallenge({ requestId: String(data.requestId), token: String(data.resetToken) });
          setNotice({ text: "Restablecimiento aprobado. Ya puedes crear una nueva contraseña.", tone: "info" });
          return;
        }
        if (data.status === "unavailable") {
          setRecoveryRequest(null);
          setNotice({ text: "No se pudo mantener la solicitud. Vuelve a solicitar el restablecimiento.", tone: "error" });
        }
      } catch {
        // A transient polling failure should not erase a valid pending request.
      } finally {
        polling = false;
      }
    };
    void checkApproval();
    timer = window.setInterval(() => void checkApproval(), 5000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [recoveryChallenge, recoveryRequest, screen]);

  function resetForm() {
    formRef.current?.reset();
    setNotice(null);
    resetTelegramRegistrationValidation();
    if (screen === "recover") {
      setRecoveryRequest(null);
      setRecoveryChallenge(null);
    }
  }

  async function inspectAccess() {
    if (screen !== "change-number" || busy || authActionInFlightRef.current || !formRef.current) return;
    authActionInFlightRef.current = true;
    setBusy(true);
    setNotice(null);
    setAccessLookup(null);
    try {
      const formData = new FormData(formRef.current);
      const sellerId = String(formData.get("change-number-telegram-id") ?? "").trim();
      const username = String(formData.get("change-number-username") ?? "").trim().replace(/^@/u, "");
      const password = String(formData.get("change-number-password") ?? "");
      const proof = await createDeviceProof(sellerId, username);
      const data = await postAuth("/api/access/status", { sellerId, username, password, ...proof }, createAuthAttemptId());
      setAccessLookup(data as AccessLookup);
      const days = data.permanent || !data.accessExpiresAt
        ? null
        : Math.max(0, Math.ceil((Date.parse(String(data.accessExpiresAt)) - Date.now()) / 86_400_000));
      setNotice({ text: data.permanent ? "Tu acceso es permanente." : `Te quedan ${days} días de acceso.`, tone: "info" });
    } catch (error) {
      setNotice({ text: authErrorMessage(error, "No pudimos consultar tu acceso."), tone: "error" });
    } finally {
      authActionInFlightRef.current = false;
      setBusy(false);
    }
  }

  if (checking) return <main className="site-stage" />;
  if (screen === "login" && sessionUser) {
    return (
      <ReturningKeypad
        key={sessionUser.id}
        mode={sessionUser.mustSetPin || !sessionUser.pinSet ? "set" : "verify"}
        notice={notice}
        recipientId={sessionUser.id}
        onSubmit={unlockWithPin}
        onBioUnlock={unlockWithBio}
      />
    );
  }

  return (
    <main className="site-stage">
      <section className={`bank-app screen-${screen}`} aria-label={content.title}>
        <AuthHeader screen={screen} onRefresh={resetForm} />
        <div className="login-card">
          <div className="login-heading"><h1>{content.title}</h1><p>{content.subtitle}</p></div>
          {notice ? (
            <p
              className={`form-notice is-${notice.tone}`}
              role={notice.tone === "error" ? "alert" : "status"}
              aria-live={notice.tone === "error" ? "assertive" : "polite"}
            >
              {notice.text}
            </p>
          ) : null}
          <form className="login-form" ref={formRef} onSubmit={handleSubmit}>
              {screen === "register" ? (
                <>
                  <div className="registration-gate">
                    <AuthAssetIcon name="ic_shield_check_r_yape" />
                    <p>Entra al grupo e ingresa tu Telegram ID. El bot comprobará automáticamente tu membresía.</p>
                    {groupInviteUrl ? <a href={groupInviteUrl} target="_blank" rel="noreferrer">Abrir grupo de Telegram</a> : null}
                  </div>
                  <Field id="telegram-id" label="Telegram ID" inputMode="numeric" pattern="[0-9]{4,24}" maxLength={24} />
                  <span className="auth-action-frame auth-action-frame-form">
                    <button
                      className={`telegram-check-button${telegramValidationPhase === "loading" ? " is-telegram-validating" : telegramValidationPhase === "resolving" ? " is-telegram-resolving" : telegramValidationPhase === "error-resolving" ? " is-telegram-error-resolving" : telegramValidationPhase === "success" ? " is-telegram-validated" : telegramValidationPhase === "error" ? " is-telegram-error" : ""}`}
                      type="button"
                      disabled={busy || registerChecking || !fingerprintId || telegramValidationPhase === "success"}
                      onClick={() => void verifyTelegramForRegister()}
                      aria-busy={telegramValidationPhase === "loading" || telegramValidationPhase === "resolving" || telegramValidationPhase === "error-resolving"}
                      aria-label={registerChecking ? "VALIDANDO DISPOSITIVO" : telegramValidationPhase === "loading" ? "Validando Telegram" : telegramValidationPhase === "resolving" ? "Confirmando validación de Telegram" : telegramValidationPhase === "error-resolving" ? "Confirmando error de validación de Telegram" : telegramValidationPhase === "success" ? "Validación completada correctamente" : telegramValidationPhase === "error" ? "No se pudo validar Telegram. Reintentar validación" : "VALIDAR TELEGRAM"}
                    >
                      <TelegramValidationPerimeter />
                      <TelegramValidationAssembly active={telegramValidationPhase === "resolving" || telegramValidationPhase === "error-resolving"} />
                      <TelegramValidationLabel phase={telegramValidationPhase} registerChecking={registerChecking} />
                    </button>
                  </span>
                  <Field
                    id="username"
                    label="Usuario (sin espacios)"
                    autoComplete="username"
                    minLength={3}
                    maxLength={40}
                    pattern="[A-Za-z0-9._-]{3,40}"
                    sanitize={(value) => value.replace(/\s/gu, "")}
                  />
                  <Field id="referral-code" label="Codigo de invitacion opcional" maxLength={16} required={false} />
                  <PasswordField id="new-password" label="Contrasena" autoComplete="new-password" />
                  <PasswordField id="confirm-password" label="Confirmar contrasena" autoComplete="new-password" />
                  <Field id="pin" label="Clave de 6 digitos" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} />
                  <Field id="confirm-pin" label="Repetir clave de 6 digitos" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} />
                  <span className="auth-action-frame auth-action-frame-form auth-action-frame-primary">
                    <button className="login-button" type="submit" disabled={busy || !registerAllowed} aria-label="CREAR CUENTA"><ActionLabel label="CREAR CUENTA" /></button>
                  </span>
                </>
              ) : null}
              {false ? (
              <p>Los registros se hacen desde el panel del administrador o del vendedor con créditos disponibles.</p>
              ) : null}
              {screen === "login" ? (
                <>
                  <Field id="seller-id" label="Telegram ID" inputMode="numeric" pattern="[0-9]{4,24}" maxLength={24} />
                  <Field id="username" label="Usuario" autoComplete="username" />
                  <PasswordField id="password" label="Contraseña" autoComplete="current-password" />
                  <span className="auth-action-frame auth-action-frame-form auth-action-frame-primary">
                    <button className="login-button" type="submit" disabled={busy} aria-label="INICIAR SESIÓN"><ActionLabel label="INICIAR SESIÓN" /></button>
                  </span>
                </>
              ) : null}
              {screen === "change-password" ? (
                <>
                  <PasswordField id="old-password" label="Contraseña actual" autoComplete="current-password" />
                  <PasswordField id="new-password" label="Contraseña nueva" autoComplete="new-password" />
                  <button className="login-button" type="submit" disabled={busy}>CAMBIAR CONTRASEÑA</button>
                </>
              ) : null}
              {screen === "change-number" ? (
                <>
                  <div className="registration-gate change-number-gate">
                    <AuthAssetIcon name="ic_smartphone_outline_yape" />
                    <p>Si terminó tu prueba, consulta tus días, comparte tu código para /redeem en el grupo o canjea el token permanente de tu vendedor.</p>
                  </div>
                  <Field id="change-number-telegram-id" label="ID de acceso (Telegram ID o YAPE)" maxLength={24} />
                  <Field id="change-number-username" label="Usuario" autoComplete="username" minLength={3} maxLength={40} />
                  <PasswordField id="change-number-password" label="Contraseña" autoComplete="current-password" />
                  <button className="telegram-check-button" type="button" disabled={busy} onClick={() => void inspectAccess()}>CONSULTAR MI ACCESO</button>
                  {accessLookup ? (
                    <div className="access-lookup-card">
                      <strong>{accessLookup.displayName}</strong>
                      <span>{accessLookup.permanent ? "Acceso permanente" : `Acceso hasta ${new Intl.DateTimeFormat("es-PE").format(new Date(accessLookup.accessExpiresAt ?? ""))}`}</span>
                      {accessLookup.referralCode ? <small>Tu código: <b>{accessLookup.referralCode}</b><br />Otra persona debe escribir <b>/redeem {accessLookup.referralCode}</b> en el grupo para darte 3 días.</small> : null}
                    </div>
                  ) : null}
                  <Field id="permanent-access-token" label="Token permanente" autoComplete="one-time-code" maxLength={24} />
                  <button className="login-button" type="submit" disabled={busy}>{busy ? "VALIDANDO…" : "ACTIVAR ACCESO PERMANENTE"}</button>
                  <a className="quiet-link change-number-support" href="/api/telegram/support?source=change-number">¿Necesitas cambiar tu número? Contactar soporte</a>
                </>
              ) : null}
              {screen === "recover" ? (
                recoveryChallenge ? (
                  <>
                    <PasswordField id="recover-new-password" label="Nueva contraseña" autoComplete="new-password" />
                    <PasswordField id="recover-confirm-password" label="Confirma la nueva contraseña" autoComplete="new-password" />
                    <button className="login-button" type="submit" disabled={busy}>RESTABLECER CONTRASEÑA</button>
                  </>
                ) : recoveryRequest ? (
                  <div className="form-notice is-info" role="status" aria-live="polite">
                    Estamos esperando la aprobación de tu vendedor para continuar.
                  </div>
                ) : (
                  <>
                    <Field id="recover-seller-id" label="Telegram ID" inputMode="numeric" pattern="[0-9]{4,20}" />
                    <Field id="recover-username" label="Usuario" autoComplete="username" />
                    <button className="login-button" type="submit" disabled={busy}>SOLICITAR RECUPERACIÓN</button>
                  </>
                )
              ) : null}
            </form>
          {screen === "login" ? (
            <div className="login-links" aria-label="Opciones de acceso">
              <Link className="quiet-link" href="/recuperar">¿Olvidaste tu contraseña?</Link>
              <span className="auth-action-frame auth-action-frame-link">
                <Link className="create-account" href="/registro" aria-label="Crear una cuenta nueva"><ActionLabel label="Crear una cuenta nueva" /></Link>
              </span>
              <span className="auth-action-frame auth-action-frame-link">
                <Link className="create-account create-account-blue" href="/api/telegram/group" aria-label="Unirse al grupo"><ActionLabel label="Unirse al grupo 🔥" /></Link>
              </span>
            </div>
          ) : null}
          {screen === "change-password" ? (
            <Link className="support-banner" href="/recuperar">
              <span className="support-icon"><AuthAssetIcon name="ic_mail_outline_yape_primary" /></span>
              <span className="support-copy"><strong>¿No recuerdas tu contraseña?</strong><small>Contacta a tu vendedor para aprobar el restablecimiento</small></span>
              <span className="support-arrow"><AuthAssetIcon name="ic_chevron_right_yape_muted" /></span>
            </Link>
          ) : null}
          {screen === "recover" && recoveryRequest ? (
            <button className="ghost-link recovery-mode-toggle" type="button" onClick={resetForm}>
              Solicitar nuevamente
            </button>
          ) : null}
          {screen === "login" ? <p className="version">versión 9.0</p> : null}
        </div>
        {screen === "login" && showWelcome ? (
          <div className="welcome-gate" role="dialog" aria-modal="true" aria-labelledby="welcome-title" aria-describedby="welcome-description">
            <div className="welcome-sheet">
              <h2 id="welcome-title">¡Bienvenido!</h2>
              <p id="welcome-description">¿Cómo quieres continuar?</p>
              <div className="welcome-actions">
                <span className="auth-action-frame auth-action-frame-welcome">
                  <button className="welcome-action welcome-action-primary" type="button" onClick={() => {
                    welcomeDismissedForAppSession = true;
                    setShowWelcome(false);
                  }}>
                  <ActionLabel label="Ya tengo cuenta" />
                  </button>
                </span>
                <span className="auth-action-frame auth-action-frame-welcome">
                  <Link className="welcome-action welcome-action-secondary" href="/registro">
                  <ActionLabel label="Crear cuenta nueva" />
                  </Link>
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
