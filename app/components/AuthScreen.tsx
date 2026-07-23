"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { createDeviceProof } from "../lib/device-key";
import { getFingerprintId, hasLocalRegistrationAnchor, saveLocalRegistrationAnchor } from "../lib/registration-device";

type Screen = "login" | "register" | "change-password" | "recover" | "change-number";
type Notice = { text: string; tone: "info" | "error" } | null;
type AuthUser = {
  id: string;
  sellerCode: string;
  username: string;
  displayName: string;
  role: "admin" | "seller" | "client";
  mustChangePassword: boolean;
  mustSetPin: boolean;
  pinSet: boolean;
  unlocked: boolean;
  referralCode?: string | null;
  accessExpiresAt?: string | null;
};

type AccessLookup = {
  permanent: boolean;
  accessExpiresAt: string | null;
  referralCode: string | null;
  displayName: string;
};

const UNLOCK_KEY = "yape-unlocked";
const keypadOrder = ["4", "9", "6", "8", "1", "3", "2", "5", "0", "bio", "7", "del"];
const returningActions: Array<{ href: string; label: string; icon: string; external?: boolean }> = [
  { href: "/recuperar", label: "Olvido de clave", icon: "ic_lock_outline_yape" },
  { href: "/cambiar-numero", label: "Cambio de número", icon: "ic_smartphone_outline_yape" },
  { href: "/api/telegram/support?source=login", label: "Ayuda", icon: "ic_headphone_outline_yape", external: true },
];

const screenContent: Record<Screen, { title: string; subtitle: string }> = {
  login: { title: "Iniciar Sesión", subtitle: "Ingresa con el usuario autorizado por tu vendedor" },
  register: { title: "Crear cuenta", subtitle: "Valida tu Telegram y configura tu clave de ingreso" },
  "change-password": { title: "Restablecer Contraseña", subtitle: "Cambia tu contraseña de forma segura" },
  recover: { title: "Recuperar Contraseña", subtitle: "Restablece el acceso desde tu dispositivo verificado" },
  "change-number": { title: "Acceso y cambio de número", subtitle: "Consulta tu suscripción, usa tu token o contacta a soporte" },
};

function rolePath(user: AuthUser) {
  if (user.role === "seller") return "/vendedor";
  return "/inicio";
}

async function apiPost(path: string, payload: Record<string, unknown>) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) {
    const error = new Error(String(data?.error ?? "No se pudo completar la operación.")) as Error & { code?: string; referralCode?: string };
    error.code = typeof data?.code === "string" ? data.code : undefined;
    error.referralCode = typeof data?.referralCode === "string" ? data.referralCode : undefined;
    throw error;
  }
  return data;
}

function AuthAssetIcon({ name }: { name: string }) {
  return <img src={`/assets/apk/icons/${name}.svg`} alt="" aria-hidden="true" />;
}

function AuthLottieIcon({ name, className = "" }: { name: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let animation: { destroy: () => void } | null = null;

    import("lottie-web/build/player/lottie_light").then(({ default: lottie }) => {
      if (cancelled || !containerRef.current) return;
      animation = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: `/assets/apk/lottie/${name}.json`,
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
          progressiveLoad: true,
        },
      });
    }).catch(() => {
      // Si Lottie no carga, el botón sigue existiendo y no bloquea el ingreso.
    });

    return () => {
      cancelled = true;
      animation?.destroy();
      container.innerHTML = "";
    };
  }, [name]);

  return <span ref={containerRef} className={`auth-lottie-icon ${className}`.trim()} aria-hidden="true" />;
}

function Field({
  id,
  label,
  type = "text",
  autoComplete = "off",
  inputMode,
  maxLength,
  minLength,
  pattern,
  required = true,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "email" | "numeric" | "text";
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <input id={id} name={id} type={type} inputMode={inputMode} autoComplete={autoComplete} autoCapitalize="none" spellCheck="false" placeholder={label} aria-label={label} maxLength={maxLength} minLength={minLength} pattern={pattern} required={required} />
    </div>
  );
}

function PasswordField({ id, label, autoComplete }: { id: string; label: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field password-field">
      <input id={id} name={id} type={visible ? "text" : "password"} autoComplete={autoComplete} placeholder={label} aria-label={label} minLength={6} required />
      <button className="password-toggle" type="button" onClick={() => setVisible((current) => !current)}>
        {visible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}

function Header({ screen, onRefresh }: { screen: Screen; onRefresh: () => void }) {
  return (
    <header className="login-header">
      {screen === "login" ? <span className="header-spacer" aria-hidden="true" /> : (
        <Link className="back-button" href="/" aria-label="Volver a iniciar sesión"><AuthAssetIcon name="ic_arrow_left_yape_on_primary" /></Link>
      )}
      {screen === "login" ? (
        <button className="refresh-button" type="button" onClick={onRefresh} aria-label="Actualizar formulario"><AuthAssetIcon name="ic_refresh_yape_on_primary" /></button>
      ) : <span className="header-spacer" aria-hidden="true" />}
    </header>
  );
}

function ReturningKeypad({
  mode,
  onSubmit,
  notice,
}: {
  mode: "set" | "verify";
  onSubmit: (pin: string) => Promise<void>;
  notice: Notice;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginQrImage, setLoginQrImage] = useState("");
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const submittedPinRef = useRef("");
  const keyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("qrcode").then(async ({ default: QRCode }) => {
      const image = await QRCode.toDataURL("yape://login", {
        width: 360,
        margin: 1,
        errorCorrectionLevel: "H",
        color: { dark: "#5c1b6d", light: "#ffffff" },
      });
      if (!cancelled) setLoginQrImage(image);
    }).catch(() => {
      if (!cancelled) setLoginQrImage("/assets/apk/images/qr_code_sample.png");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (keyFeedbackTimerRef.current !== null) window.clearTimeout(keyFeedbackTimerRef.current);
  }, []);

  function showKeyFeedback(key: string) {
    if (busy) return;
    setPressedKey(key);
    if (keyFeedbackTimerRef.current !== null) window.clearTimeout(keyFeedbackTimerRef.current);
    keyFeedbackTimerRef.current = window.setTimeout(() => {
      setPressedKey(null);
      keyFeedbackTimerRef.current = null;
    }, 170);

    if (typeof navigator.vibrate === "function") navigator.vibrate(8);
  }

  async function pushKey(key: string) {
    if (key === "bio") return;
    if (key === "del") {
      submittedPinRef.current = "";
      setPin((current) => current.slice(0, -1));
      return;
    }
    const next = `${pin}${key}`.slice(0, 6);
    if (next.length < 6) submittedPinRef.current = "";
    setPin(next);
    if (next.length === 6 && submittedPinRef.current !== next) {
      submittedPinRef.current = next;
      setBusy(true);
      void onSubmit(next).finally(() => setBusy(false));
    }
  }

  return (
    <main className="site-stage">
      <section className="bank-app returning-login" aria-label="Entrar con clave">
        <div className="returning-purple-panel">
          <span className="returning-qr yape-qr-card yape-qr-card-compact">
            <img src={loginQrImage || "/assets/apk/images/qr_code_sample.png"} alt="QR de acceso" />
            <span className="yape-qr-logo-mark" aria-hidden="true">
              <img src="/assets/apk/icons/ic_logo_static.svg" alt="" />
            </span>
          </span>
          <div className="returning-top-actions">
            {returningActions.map((action) => (
              action.external ? <a href={action.href} key={action.label} aria-label={action.label}>
                <span className="returning-action-icon"><AuthAssetIcon name={action.icon} /></span>
                <span>{action.label}</span>
              </a> : <Link href={action.href} key={action.label} aria-label={action.label}>
                <span className="returning-action-icon"><AuthAssetIcon name={action.icon} /></span>
                <span>{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
        <section className="returning-keypad-card">
          <h1>{mode === "set" ? "Configura tu clave" : "Ingresa tu clave"}</h1>
          <div className="pin-dots" aria-label={`${pin.length} dígitos ingresados`}>
            {[0, 1, 2, 3, 4, 5].map((item) => <span key={item} className={item < pin.length ? "is-filled" : ""} />)}
          </div>
          {notice ? <p className={`form-notice is-${notice.tone}`} role="status">{notice.text}</p> : null}
          <div className="numeric-keypad">
            {keypadOrder.map((key) => (
              <button
                key={key}
                type="button"
                className={`${key === "bio" ? "returning-bio-key" : key === "del" ? "returning-delete-key" : ""}${pressedKey === key ? " is-key-pressed" : ""}`.trim()}
                disabled={busy}
                onPointerDown={() => showKeyFeedback(key)}
                onClick={() => pushKey(key)}
                aria-label={key === "bio" ? "Biometría" : key === "del" ? "Borrar" : `Número ${key}`}
              >
                {key === "bio" ? <AuthLottieIcon name="icon_huella_rostro" className="returning-bio-lottie" /> : key === "del" ? <AuthAssetIcon name="ic_arrow_left_yape" /> : key}
              </button>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

export function AuthScreen({ screen }: { screen: Screen }) {
  const content = screenContent[screen];
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(screen === "login");
  const [busy, setBusy] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState<"request" | "complete">("request");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [fingerprintId, setFingerprintId] = useState("");
  const [registerAllowed, setRegisterAllowed] = useState(false);
  const [registerChecking, setRegisterChecking] = useState(screen === "register");
  const [groupInviteUrl, setGroupInviteUrl] = useState("");
  const [accessLookup, setAccessLookup] = useState<AccessLookup | null>(null);

  useEffect(() => {
    if (screen !== "login") return;
    let cancelled = false;
    fetch("/api/auth/me").then((response) => response.json()).then((data) => {
      if (cancelled) return;
      if (data?.code === "ACCESS_EXPIRED") {
        const code = typeof data.referralCode === "string" && data.referralCode ? ` Tu código es ${data.referralCode}.` : "";
        setNotice({ text: `Tu suscripción terminó. Contacta a tu vendedor o usa un token permanente en Cambio de número.${code}`, tone: "error" });
        return;
      }
      const user = data?.user as AuthUser | null;
      if (!user) return;
      if (user.mustChangePassword) router.replace("/cambiar-contrasena");
      else if (user.unlocked) {
        sessionStorage.setItem(UNLOCK_KEY, "1");
        router.replace(rolePath(user));
      } else setSessionUser(user);
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [router, screen]);

  useEffect(() => {
    if (screen !== "login" || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("reason") === "expired") {
      const timer = window.setTimeout(() => {
        setNotice({ text: "Tu suscripción terminó. Contacta a tu vendedor o usa un token permanente en Cambio de número.", tone: "error" });
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
      const blocked = await hasLocalRegistrationAnchor(id);
      if (cancelled) return;
      if (blocked) {
        setNotice({ text: "Este dispositivo ya tiene una cuenta registrada.", tone: "error" });
      }
    }).catch((error: Error) => {
      if (!cancelled) setNotice({ text: error.message, tone: "error" });
    }).finally(() => {
      if (!cancelled) setRegisterChecking(false);
    });
    return () => { cancelled = true; };
  }, [screen]);

  function resetForm() {
    formRef.current?.reset();
    setNotice(null);
    if (screen === "recover") {
      setRecoveryMode("request");
      setRecoveryCode("");
    }
  }

  async function unlockWithPin(pin: string) {
    setNotice(null);
    const endpoint = sessionUser?.mustSetPin || !sessionUser?.pinSet ? "/api/auth/pin" : "/api/auth/pin/verify";
    const data = await apiPost(endpoint, { pin }).catch((error: Error) => {
      setNotice({ text: error.message, tone: "error" });
      return null;
    });
    if (!data || !sessionUser) return;
    sessionStorage.setItem(UNLOCK_KEY, "1");
    router.replace(rolePath({ ...sessionUser, mustSetPin: false, pinSet: true }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const formData = new FormData(event.currentTarget);

    try {
      if (screen === "login") {
        const sellerId = String(formData.get("seller-id") ?? "");
        const username = String(formData.get("username") ?? "");
        const password = String(formData.get("password") ?? "");
        const proof = await createDeviceProof(sellerId, username);
        const data = await apiPost("/api/auth/login", { sellerId, username, password, ...proof });
        const user = data.user as AuthUser;
        sessionStorage.removeItem(UNLOCK_KEY);
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
        const blocked = await hasLocalRegistrationAnchor(fingerprintId);
        if (blocked) throw new Error("Este dispositivo ya tiene una cuenta registrada.");
        const data = await apiPost("/api/auth/register", {
          telegramUserId: String(formData.get("telegram-id") ?? ""),
          username: String(formData.get("username") ?? ""),
          displayName: String(formData.get("display-name") ?? ""),
          phone: String(formData.get("phone") ?? ""),
          email: String(formData.get("email") ?? ""),
          referralCode: String(formData.get("referral-code") ?? ""),
          password,
          pin,
          fingerprintId,
        });
        await saveLocalRegistrationAnchor(fingerprintId);
        formRef.current?.reset();
        setRegisterAllowed(false);
        setNotice({
          text: `${String(data.message ?? "Cuenta creada.")} Tu ID de ingreso es YAPE y tu codigo es ${String(data?.user?.referralCode ?? "")}.`,
          tone: "info",
        });
        return;
      }

      if (screen === "change-password") {
        await apiPost("/api/auth/password/change", {
          currentPassword: String(formData.get("old-password") ?? ""),
          newPassword: String(formData.get("new-password") ?? ""),
        });
        sessionStorage.removeItem(UNLOCK_KEY);
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
        const data = await apiPost("/api/access/redeem", { sellerId, username, password, token, ...proof });
        setAccessLookup({
          permanent: true,
          accessExpiresAt: null,
          referralCode: typeof data.referralCode === "string" ? data.referralCode : null,
          displayName: String(data?.user?.displayName ?? username),
        });
        sessionStorage.removeItem(UNLOCK_KEY);
        setNotice({ text: String(data.message ?? "Tu acceso ahora es permanente. Ya puedes ingresar."), tone: "info" });
        window.setTimeout(() => router.replace("/"), 1100);
        return;
      }

      if (screen === "recover") {
        if (recoveryMode === "request") {
          const sellerId = String(formData.get("recover-seller-id") ?? "");
          const username = String(formData.get("recover-username") ?? "");
          const proof = await createDeviceProof(sellerId, username);
          const data = await apiPost("/api/auth/password/reset/request", {
            sellerId,
            username,
            ...proof,
          });
          const requestId = String(data.requestId ?? "");
          const resetToken = String(data.resetToken ?? "");
          const nextCode = requestId && resetToken ? `${requestId}.${resetToken}` : "";
          setRecoveryCode(nextCode);
          setRecoveryMode("complete");
          setNotice({ text: String(data.message ?? "Si los datos corresponden a una cuenta, la solicitud fue registrada."), tone: "info" });
        } else {
          const newPassword = String(formData.get("recover-new-password") ?? "");
          const confirmation = String(formData.get("recover-confirm-password") ?? "");
          if (newPassword !== confirmation) throw new Error("Las contraseñas nuevas no coinciden.");
          const combinedCode = String(formData.get("recovery-code") ?? "").trim();
          const separator = combinedCode.indexOf(".");
          const requestId = separator > 0 ? combinedCode.slice(0, separator) : "";
          const resetToken = separator > 0 ? combinedCode.slice(separator + 1) : "";
          await apiPost("/api/auth/password/reset/complete", {
            requestId,
            resetToken,
            newPassword,
          });
          setNotice({ text: "Contraseña restablecida. Ya puedes iniciar sesión.", tone: "info" });
          window.setTimeout(() => router.replace("/"), 900);
        }
        return;
      }

    } catch (error) {
      const accessError = error as Error & { code?: string; referralCode?: string };
      const referral = accessError.code === "ACCESS_EXPIRED" && accessError.referralCode
        ? ` Tu código es ${accessError.referralCode}.`
        : "";
      setNotice({ text: error instanceof Error ? `${error.message}${referral}` : "No se pudo completar la operación.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function verifyTelegramForRegister() {
    if (screen !== "register" || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      if (!fingerprintId) throw new Error("Espera la validacion del dispositivo.");
      const telegramId = String(new FormData(formRef.current ?? undefined).get("telegram-id") ?? "");
      const blocked = await hasLocalRegistrationAnchor(fingerprintId);
      if (blocked) throw new Error("Este dispositivo ya tiene una cuenta registrada.");
      const response = await fetch("/api/auth/register/status", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ telegramUserId: telegramId, fingerprintId }),
      });
      const data = await response.json();
      setGroupInviteUrl(String(data.groupInviteUrl ?? ""));
      if (!response.ok || !data.ok || !data.allowed) throw new Error(String(data.error ?? "Aun no puedes registrarte."));
      setRegisterAllowed(true);
      setNotice({ text: "Telegram validado. Ya puedes crear tu cuenta.", tone: "info" });
    } catch (error) {
      setRegisterAllowed(false);
      setNotice({ text: error instanceof Error ? error.message : "No se pudo validar Telegram.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function inspectAccess() {
    if (screen !== "change-number" || busy || !formRef.current) return;
    setBusy(true);
    setNotice(null);
    setAccessLookup(null);
    try {
      const formData = new FormData(formRef.current);
      const sellerId = String(formData.get("change-number-telegram-id") ?? "").trim();
      const username = String(formData.get("change-number-username") ?? "").trim().replace(/^@/u, "");
      const password = String(formData.get("change-number-password") ?? "");
      const proof = await createDeviceProof(sellerId, username);
      const data = await apiPost("/api/access/status", { sellerId, username, password, ...proof });
      setAccessLookup(data as AccessLookup);
      const days = data.permanent || !data.accessExpiresAt
        ? null
        : Math.max(0, Math.ceil((Date.parse(String(data.accessExpiresAt)) - Date.now()) / 86_400_000));
      setNotice({ text: data.permanent ? "Tu acceso es permanente." : `Te quedan ${days} días de acceso.`, tone: "info" });
    } catch (error) {
      setNotice({ text: error instanceof Error ? error.message : "No pudimos consultar tu acceso.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (checking) return <main className="site-stage" />;
  if (screen === "login" && sessionUser) {
    return (
      <ReturningKeypad
        mode={sessionUser.mustSetPin || !sessionUser.pinSet ? "set" : "verify"}
        notice={notice}
        onSubmit={unlockWithPin}
      />
    );
  }

  return (
    <main className="site-stage">
      <section className={`bank-app screen-${screen}`} aria-label={content.title}>
        <Header screen={screen} onRefresh={resetForm} />
        <div className="login-card">
          <div className="login-heading"><h1>{content.title}</h1><p>{content.subtitle}</p></div>
          {notice ? <p className={`form-notice is-${notice.tone}`} role="status" aria-live="polite">{notice.text}</p> : null}
          <form className="login-form" ref={formRef} onSubmit={handleSubmit}>
              {screen === "register" ? (
                <>
                  <div className="registration-gate">
                    <AuthAssetIcon name="ic_shield_check_r_yape" />
                    <p>Entra al grupo de Telegram, escribe tu Telegram ID aqui y valida el acceso.</p>
                    {groupInviteUrl ? <a href={groupInviteUrl} target="_blank" rel="noreferrer">Abrir grupo de Telegram</a> : null}
                  </div>
                  <Field id="telegram-id" label="Telegram ID" inputMode="numeric" pattern="[0-9]{4,24}" maxLength={24} />
                  <button className="telegram-check-button" type="button" disabled={busy || registerChecking || !fingerprintId} onClick={() => void verifyTelegramForRegister()}>
                    {registerChecking ? "VALIDANDO DISPOSITIVO" : "VALIDAR TELEGRAM"}
                  </button>
                  <Field id="username" label="Usuario" autoComplete="username" minLength={3} maxLength={40} />
                  <Field id="display-name" label="Nombre completo" autoComplete="name" minLength={2} maxLength={80} />
                  <Field id="phone" label="Celular" inputMode="numeric" pattern="9[0-9]{8}" maxLength={9} required={false} />
                  <Field id="email" label="Correo opcional" type="email" autoComplete="email" required={false} />
                  <Field id="referral-code" label="Codigo de invitacion opcional" maxLength={16} required={false} />
                  <PasswordField id="new-password" label="Contrasena" autoComplete="new-password" />
                  <PasswordField id="confirm-password" label="Confirmar contrasena" autoComplete="new-password" />
                  <Field id="pin" label="Clave de 6 digitos" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} />
                  <Field id="confirm-pin" label="Repetir clave de 6 digitos" type="password" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} minLength={6} />
                  <button className="login-button" type="submit" disabled={busy || !registerAllowed}>CREAR CUENTA</button>
                </>
              ) : null}
              {false ? (
              <p>Los registros se hacen desde el panel del administrador o del vendedor con créditos disponibles.</p>
              ) : null}
              {screen === "login" ? (
                <>
                  <Field id="seller-id" label="Telegram ID" inputMode="numeric" pattern="[0-9]{4,20}" />
                  <Field id="username" label="Usuario" autoComplete="username" />
                  <PasswordField id="password" label="Contraseña" autoComplete="current-password" />
                  <button className="login-button" type="submit" disabled={busy}>INICIAR SESIÓN</button>
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
                    <p>Si terminó tu prueba, aquí puedes consultar tus días, ver tu código personal o reclamar el token permanente de tu vendedor.</p>
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
                recoveryMode === "request" ? (
                  <>
                    <Field id="recover-seller-id" label="Telegram ID" inputMode="numeric" pattern="[0-9]{4,20}" />
                    <Field id="recover-username" label="Usuario" autoComplete="username" />
                    <button className="login-button" type="submit" disabled={busy}>SOLICITAR RECUPERACIÓN</button>
                  </>
                ) : (
                  <>
                    <div className="field">
                      <input id="recovery-code" name="recovery-code" type="text" autoComplete="one-time-code" autoCapitalize="none" spellCheck="false" placeholder="Código de recuperación" aria-label="Código de recuperación" defaultValue={recoveryCode} required />
                    </div>
                    <PasswordField id="recover-new-password" label="Nueva contraseña" autoComplete="new-password" />
                    <PasswordField id="recover-confirm-password" label="Confirma la nueva contraseña" autoComplete="new-password" />
                    <button className="login-button" type="submit" disabled={busy}>RESTABLECER CONTRASEÑA</button>
                  </>
                )
              ) : null}
            </form>
          {screen === "login" ? (
            <div className="login-links" aria-label="Opciones de acceso">
              <Link className="quiet-link" href="/recuperar">¿Olvidaste tu contraseña?</Link>
              <Link className="create-account" href="/registro">Crear una cuenta nueva</Link>
              <Link className="create-account create-account-blue" href="/api/telegram/group">Unirse al grupo 🔥</Link>
            </div>
          ) : null}
          {screen === "change-password" ? (
            <Link className="support-banner" href="/recuperar">
              <span className="support-icon"><AuthAssetIcon name="ic_mail_outline_yape_primary" /></span>
              <span className="support-copy"><strong>¿No recuerdas tu contraseña?</strong><small>Contacta a tu vendedor para aprobar el restablecimiento</small></span>
              <span className="support-arrow"><AuthAssetIcon name="ic_chevron_right_yape_muted" /></span>
            </Link>
          ) : null}
          {screen === "recover" ? (
            <button
              className="ghost-link recovery-mode-toggle"
              type="button"
              onClick={() => {
                setRecoveryMode((current) => current === "request" ? "complete" : "request");
                setNotice(null);
                formRef.current?.reset();
              }}
            >
              {recoveryMode === "request" ? "Ya tengo un código aprobado" : "Solicitar un código nuevo"}
            </button>
          ) : null}
          {screen === "login" ? <p className="version">versión 9.0</p> : null}
        </div>
      </section>
    </main>
  );
}
