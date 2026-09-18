"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import { useEffect, useState } from "react";
import { buildPaymentQrPayload } from "../../lib/payment-qr";
import { safeClientMessage } from "../../lib/client-error";
import { fetchSession } from "../../lib/session-cache";
import { shareText } from "../../lib/platform-adapters";
import { InnerHeader } from "./InnerHeader";
import { AssetIcon } from "./primitives";

async function shareContent(
  payload: { title: string; text: string; url?: string },
  fallback?: () => void,
) {
  const result = await shareText(payload);
  if (result.ok && result.method === "native-share") {
    return "Listo para compartir.";
  }
  if (result.ok && result.method === "clipboard") {
    fallback?.();
    return "Copiado para compartir.";
  }
  if (result.ok) return "Listo para compartir.";
  fallback?.();
  return result.reason === "cancelled"
    ? "Compartir cancelado."
    : "Tu dispositivo no permite compartir desde el navegador.";
}

export function PersonalQrView() {
  const [notice, setNotice] = useState("");
  const [qrImage, setQrImage] = useState("");
  const [clientName, setClientName] = useState("");
  const [qrPayload, setQrPayload] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then(async (result) => {
      if (cancelled) return;
      if (!result.ok || !result.user) {
        setNotice("No pudimos preparar tu QR.");
        return;
      }
      const user = result.user;
      const id = typeof user.id === "string" ? user.id : "";
      const displayName =
        typeof user.displayName === "string" ? user.displayName : "";
      const role = typeof user.role === "string" ? user.role : "";
      const roles = Array.isArray(user.roles) ? user.roles : [];
      if (!id || !displayName) {
        setNotice("No pudimos preparar tu QR.");
        return;
      }
      if (role !== "client" && !roles.includes("client")) {
        setNotice("El QR de cobro está disponible para cuentas de cliente.");
        return;
      }
      try {
        let payload = buildPaymentQrPayload(id);
        try {
          const paymentDataResponse = await fetch("/api/account/payment-data", {
            cache: "no-store",
          });
          const paymentData = (await paymentDataResponse.json()) as {
            data?: { qrPayload?: string | null };
          };
          if (
            paymentDataResponse.ok
            && typeof paymentData.data?.qrPayload === "string"
            && paymentData.data.qrPayload.trim()
          ) {
            payload = paymentData.data.qrPayload;
          }
        } catch {
          // The generated account QR remains a safe fallback when no QR is saved.
        }
        const { default: QRCode } = await import("qrcode");
        const image = await QRCode.toDataURL(payload, {
          width: 640,
          margin: 1,
          errorCorrectionLevel: "H",
          color: { dark: "#5c1b6d", light: "#ffffff" },
        });
        if (cancelled) return;
        setClientName(displayName);
        setQrPayload(payload);
        setQrImage(image);
      } catch (error) {
        if (!cancelled)
          setNotice(
            error instanceof Error
              ? safeClientMessage(error, "No pudimos preparar tu QR.")
              : "No pudimos preparar tu QR.",
          );
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function downloadQrImage() {
    if (typeof document === "undefined" || !qrImage) return;
    const link = document.createElement("a");
    link.href = qrImage;
    link.download = "yape-qr.png";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function shareQr() {
    try {
      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const result = await shareContent(
        {
          title: "Mi QR de Yape",
          text: qrPayload || "Mi QR para recibir yapeos.",
          url: origin ? `${origin}/qr-personal` : undefined,
        },
        downloadQrImage,
      );
      setNotice(result);
    } catch {
      setNotice("No se pudo compartir tu QR.");
    }
  }

  return (
    <div className="reference-qr-view">
      <section className="qr-purple-hero">
        <InnerHeader title="Mi QR personal" backHref="/mi-qr" compact />
        <p>
          Muestra tu QR para recibir yapeos sin compartir tu número de celular.
        </p>
      </section>
      <section className="reference-qr-card">
        {qrImage ? (
          <span className="personal-yape-qr yape-qr-card">
            <img
              className="apk-sample-qr"
              src={qrImage}
              alt={`Código QR de ${clientName}`}
            />
            <span className="yape-qr-logo-mark" aria-hidden="true">
              <img src="/assets/apk/icons/ic_logo_static.svg" alt="" />
            </span>
          </span>
        ) : (
          <div
            className="qr-loading-placeholder"
            role="status"
            aria-label="Preparando código QR"
          />
        )}
        <strong>{clientName || "PREPARANDO TU QR"}</strong>
      </section>
      <button
        className="qr-share-button"
        type="button"
        onClick={shareQr}
        disabled={!qrImage}
      >
        <AssetIcon name="ic_share_outline_yape_on_secondary" />
        Comparte y descarga tu QR
      </button>
      {notice ? (
        <p className="inline-notice qr-share-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
