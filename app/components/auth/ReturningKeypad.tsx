"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buildPaymentQrPayload } from "../../lib/payment-qr";
import { AuthAssetIcon, AuthLottieIcon } from "./AuthVisuals";
import type { Notice } from "./types";

const keypadOrder = ["4", "9", "6", "8", "1", "3", "2", "5", "0", "bio", "7", "del"];
const returningActions: Array<{ href: string; label: string; icon: string; external?: boolean }> = [
  { href: "/recuperar", label: "Olvido de clave", icon: "ic_lock_outline_yape" },
  { href: "/cambiar-numero", label: "Cambio de número", icon: "ic_smartphone_outline_yape" },
  { href: "/api/telegram/support?source=login", label: "Ayuda", icon: "ic_headphone_outline_yape", external: true },
];

export function ReturningKeypad({
  mode,
  onSubmit,
  onBioUnlock,
  notice,
  recipientId,
}: {
  mode: "set" | "verify";
  onSubmit: (pin: string) => Promise<void>;
  onBioUnlock?: () => Promise<void>;
  notice: Notice;
  recipientId: string;
}) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [loginQrImage, setLoginQrImage] = useState("");
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const submittedPinRef = useRef("");
  const keyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        // Misma fuente de verdad que «Mi QR personal»: payload de cobro del usuario en sesión.
        const payload = buildPaymentQrPayload(recipientId);
        const { default: QRCode } = await import("qrcode");
        const image = await QRCode.toDataURL(payload, {
          width: 360,
          margin: 1,
          errorCorrectionLevel: "H",
          color: { dark: "#5c1b6d", light: "#ffffff" },
        });
        if (!cancelled) setLoginQrImage(image);
      } catch {
        // No usar qr_code_sample ni yape://login: preferimos contenedor vacío a un QR incorrecto.
        if (!cancelled) setLoginQrImage("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [recipientId]);

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
    if (key === "bio") {
      // Face ID / huella es opcional: si cancela o falla, el teclado PIN sigue disponible.
      if (mode !== "verify" || !onBioUnlock || busy) return;
      setBusy(true);
      void onBioUnlock().finally(() => setBusy(false));
      return;
    }
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
    <main className="site-stage returning-keypad-stage">
      <section className="bank-app returning-login" aria-label="Entrar con clave">
        <div className="returning-purple-panel">
          <span className="returning-qr yape-qr-card yape-qr-card-compact">
            {loginQrImage ? (
              <img src={loginQrImage} alt="QR de cobro de tu cuenta" />
            ) : (
              <span className="returning-qr-slot" aria-hidden="true" />
            )}
            <span className="yape-qr-logo-mark" aria-hidden="true">
              <img src="/assets/apk/icons/ic_logo_static.svg" alt="" />
            </span>
          </span>
          <div className="returning-top-actions">
            {returningActions.map((action) => (
              action.external ? <a href={action.href} key={action.label} aria-label={action.label}>
                <span className="returning-action-icon"><AuthAssetIcon name={action.icon} /></span>
                <span className="returning-action-label">{action.label}</span>
              </a> : <Link href={action.href} key={action.label} aria-label={action.label}>
                <span className="returning-action-icon"><AuthAssetIcon name={action.icon} /></span>
                <span className="returning-action-label">{action.label}</span>
              </Link>
            ))}
          </div>
        </div>
        <section className="returning-keypad-card">
          <div className={`pin-indicator${pin.length > 0 ? " has-input" : ""}`}>
            <h1 aria-hidden={pin.length > 0}>{mode === "set" ? "Configura tu clave" : "Ingresa tu clave"}</h1>
            <div
              className="pin-dots"
              aria-hidden={pin.length === 0}
              aria-label={`${pin.length} dígitos ingresados`}
            >
              {[0, 1, 2, 3, 4, 5].map((item) => (
                <span key={item} className={item < pin.length ? "is-filled" : ""} />
              ))}
            </div>
          </div>
          {mode === "verify" ? (
            <p className="returning-pin-hint">
              También puedes usar Face ID o huella. Si no quieres, escribe tu clave de 6 dígitos.
            </p>
          ) : null}
          {notice ? <p className={`form-notice is-${notice.tone}`} role="status">{notice.text}</p> : null}
          <div className="numeric-keypad">
            {keypadOrder.map((key) => (
              <button
                key={key}
                type="button"
                className={`${key === "bio" ? "returning-bio-key" : key === "del" ? "returning-delete-key" : ""}${pressedKey === key ? " is-key-pressed" : ""}`.trim()}
                disabled={busy || (key === "bio" && mode !== "verify")}
                onPointerDown={() => showKeyFeedback(key)}
                onClick={() => pushKey(key)}
                aria-label={key === "bio" ? "Biometría (opcional; también puedes usar tu clave)" : key === "del" ? "Borrar" : `Número ${key}`}
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
