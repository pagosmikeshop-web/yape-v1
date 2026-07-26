"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { APK_ASSET_ROOT, AssetIcon } from "./primitives";
import type { Movement } from "./types";

export function splitMovementVoucherDate(date: string): [string, string] {
  const dashMatch = date.match(/^(.+?)\s+-\s+(.+)$/u);
  if (dashMatch) return [dashMatch[1], dashMatch[2]];

  const dotMatch = date.match(/^(.+?)\s+·\s+(.+)$/u);
  if (dotMatch) return [dotMatch[1], dotMatch[2]];

  const todayMatch = date.match(/^Hoy\s+(.+)$/u);
  if (todayMatch) return ["Hoy", todayMatch[1]];

  const fallback = date.split(/ (?=\d)/u);
  return [fallback[0] || date, fallback.slice(1).join(" ") || ""];
}

export async function createVoucherImage(
  voucherContent: HTMLDivElement | null,
) {
  if (!voucherContent || typeof window === "undefined") {
    throw new Error("El comprobante todavÃ­a no estÃ¡ listo.");
  }

  await document.fonts?.ready;
  const images = Array.from(voucherContent.querySelectorAll("img"));
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) return;
      try {
        await image.decode();
      } catch {
        // Si una imagen no expone decode, html-to-image intentarÃ¡ incluirla igualmente.
      }
    }),
  );

  const { toBlob } = await import("html-to-image");
  const blob = await toBlob(voucherContent, {
    backgroundColor: "#660185",
    cacheBust: true,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  });

  if (!blob) throw new Error("No se pudo generar la imagen del comprobante.");

  return new File([blob], "comprobante-yape.png", { type: "image/png" });
}

export async function shareVoucherImage(
  file: File,
  payload: { title: string; text: string },
) {
  if (typeof navigator.share === "function") {
    let canShareFile = false;

    try {
      canShareFile =
        typeof navigator.canShare === "function"
          ? navigator.canShare({ files: [file] })
          : false;
    } catch {
      canShareFile = false;
    }

    if (canShareFile) {
      try {
        await navigator.share({
          title: payload.title,
          text: payload.text,
          files: [file],
        });
        return "Comprobante compartido como imagen.";
      } catch (error) {
        // Cerrar voluntariamente el selector no debe iniciar una descarga inesperada.
        if (error instanceof DOMException && error.name === "AbortError") {
        }

        // Algunos WebView anuncian soporte para archivos, pero bloquean navigator.share.
        // En ese caso continuamos con la descarga del PNG completo.
        console.warn(
          "No se pudo abrir el menú nativo para compartir; se descargará el PNG.",
          error,
        );
      }
    }
  }

  const downloadUrl = URL.createObjectURL(file);
  const downloadLink = document.createElement("a");
  downloadLink.href = downloadUrl;
  downloadLink.download = file.name;
  downloadLink.style.display = "none";
  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 10_000);
  return "Imagen del comprobante descargada para compartir.";
}

export function buildVoucherShareText({
  title,
  amount,
  recipient,
  date,
  time,
  securityCode,
  phone,
  destination,
  operation,
}: {
  title: string;
  amount: string;
  recipient: string;
  date: string;
  time: string;
  securityCode: string;
  phone: string;
  destination: string;
  operation: string;
}) {
  return [
    title,
    `S/ ${amount}`,
    recipient,
    `${date} | ${time}`,
    `Código de seguridad: ${securityCode.split("").join(" ")}`,
    `Nro. de celular: ${phone}`,
    `Destino: ${destination}`,
    `Nro. de operación: ${operation}`,
  ].join("\n");
}

export function getVoucherHero(amountValue: number) {
  if (amountValue < 20) return "jose_quinones";
  if (amountValue < 50) return "miguel_grau";
  if (amountValue < 100) return "abraham_valdelomar";
  if (amountValue < 200) return "pedro_paulet";
  if (amountValue < 1001) return "santa_rosa_de_lima";
  return "pedro_paulet";
}

export function formatVoucherAmount(amountValue: number) {
  return Number.isInteger(amountValue)
    ? String(amountValue)
    : amountValue.toFixed(2);
}

export function formatVoucherDate(date: Date) {
  const parts = new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const month = value("month").replace(/\.$/u, "").toLocaleLowerCase("es-PE");
  return `${value("day")} ${month}. ${value("year")}`;
}

export function formatVoucherTime(date: Date) {
  const parts = new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const dayPeriod = value("dayPeriod")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("es-PE");
  return `${value("hour")}:${value("minute")} ${dayPeriod}`;
}

export function VoucherSinglePromo() {
  return (
    <div className="voucher-single-promo">
      <Link
        href="/creditos"
        className="voucher-single-promo-frame"
        aria-label="Ir a Créditos: pide tu crédito preaprobado"
      >
        <img
          src="/assets/reference/mas-en-yape-banner.png"
          alt="Pide tu crédito preaprobado. Ir a Créditos."
          draggable={false}
        />
      </Link>
    </div>
  );
}

export function MovementVoucher({
  movement,
  onClose,
}: {
  movement: Movement;
  onClose: () => void;
}) {
  const sent = movement.amount < 0;
  const amountValue = Math.abs(movement.amount);
  const [dayLabel, timeLabel] = splitMovementVoucherDate(movement.date);
  const numericMovementId =
    typeof movement.id === "number"
      ? movement.id
      : Array.from(movement.id).reduce(
          (total, character) => total + character.charCodeAt(0),
          0,
        );
  const securityCode =
    movement.securityCode ??
    String(430 + numericMovementId * 37)
      .padStart(3, "0")
      .slice(-3);
  const operation =
    movement.operationNumber ?? String(76000000 + numericMovementId * 184731);
  const [shareNotice, setShareNotice] = useState("");
  const [voucherShareFile, setVoucherShareFile] = useState<File | null>(null);
  const voucherCaptureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void createVoucherImage(voucherCaptureRef.current)
        .then((file) => {
          if (!cancelled) setVoucherShareFile(file);
        })
        .catch(() => {
          if (!cancelled)
            setShareNotice("No se pudo preparar la imagen del comprobante.");
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [movement.id]);

  async function shareMovementVoucher() {
    if (!voucherShareFile) {
      setShareNotice(
        "Preparando la imagen. Intenta compartir nuevamente en un momento.",
      );
      return;
    }
    try {
      const result = await shareVoucherImage(voucherShareFile, {
        title: "Comprobante de yapeo",
        text: buildVoucherShareText({
          title: sent ? "¡Yapeaste!" : "¡Te yapearon!",
          amount: formatVoucherAmount(amountValue),
          recipient: movement.name,
          date: dayLabel,
          time: timeLabel,
          securityCode,
          phone: movement.detail,
          destination: movement.destination ?? "Yape",
          operation,
        }),
      });
      setShareNotice(result);
    } catch {
      setShareNotice("No se pudo compartir el comprobante.");
    }
  }

  return (
    <section
      className="yape-voucher movement-voucher yape-success-voucher"
      aria-label={`Comprobante de ${movement.name}`}
    >
      <div className="voucher-content" ref={voucherCaptureRef}>
        <div className="voucher-share-capture">
          <div className="voucher-banner">
            <img
              src={`${APK_ASSET_ROOT}/images/${getVoucherHero(amountValue)}.webp`}
              alt=""
              className="voucher-banner-image"
            />
            <span className="voucher-logo-badge" aria-hidden="true">
              <img
                src="/assets/apk/icons/ic_logo_static.svg"
                alt=""
                className="voucher-logo-static"
              />
            </span>
          </div>
          <div className="voucher-card">
            <div className="voucher-card-headline">
              <h2>{sent ? "¡Yapeaste!" : "¡Te yapearon!"}</h2>
              <button
                type="button"
                className="voucher-share-button"
                aria-label="Compartir comprobante"
                data-share-ready={voucherShareFile ? "true" : "false"}
                onClick={shareMovementVoucher}
              >
                <img
                  src="/assets/captured/voucher/compartir-icon.svg"
                  alt=""
                  aria-hidden="true"
                />
                <span>Compartir</span>
              </button>
            </div>
            <p className="voucher-amount">
              <span>S/</span>
              <strong>{formatVoucherAmount(amountValue)}</strong>
            </p>
            <p className="voucher-recipient">{movement.name}</p>
            <div className="voucher-datetime">
              <span>
                <img
                  src="/assets/captured/voucher/fecha-icon.svg"
                  alt=""
                  aria-hidden="true"
                />
                {dayLabel}
              </span>
              <i aria-hidden="true">|</i>
              <span>
                <img
                  src="/assets/captured/voucher/hora-icon.svg"
                  alt=""
                  aria-hidden="true"
                />
                {timeLabel}
              </span>
            </div>
            <div className="voucher-security">
              <span className="voucher-section-label">
                CÓDIGO DE SEGURIDAD{" "}
                <img
                  src="/assets/captured/voucher/codigo-seguridad-icon.svg"
                  alt=""
                  aria-hidden="true"
                />
              </span>
              <div className="voucher-security-digits">
                {securityCode.split("").map((digit, index) => (
                  <span key={index}>{digit}</span>
                ))}
              </div>
            </div>
            <div className="voucher-details">
              <span className="voucher-section-label">
                DATOS DE LA TRANSACCIÓN
              </span>
              <div>
                <span>Nro. de celular</span>
                <strong>{movement.detail}</strong>
              </div>
              <div>
                <span>{sent ? "Destino" : "Origen"}</span>
                <strong>{movement.destination ?? "Yape"}</strong>
              </div>
              <div>
                <span>Nro. de operación</span>
                <strong>{operation}</strong>
              </div>
            </div>
          </div>
        </div>
        <Link href="/transferir" className="voucher-new-yape-button">
          <AssetIcon name="ic_send_outline_yape_on_secondary" />
          Nuevo Yapeo
        </Link>
        <Link href="/ayuda" className="voucher-help-link">
          <AssetIcon name="ic_headphone_outline_yape_on_primary" />
          Necesito ayuda
        </Link>
        <div className="voucher-more-section">
          <h3>
            Más en Yape <small className="voucher-new-badge">Nuevo</small>
          </h3>
          <VoucherSinglePromo />
        </div>
        {shareNotice ? (
          <p className="inline-notice voucher-notice" role="status">
            {shareNotice}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className="voucher-close-button"
        aria-label="Volver a movimientos"
        onClick={onClose}
      >
        <AssetIcon name="ic_close_yape_on_primary" />
      </button>
    </section>
  );
}
