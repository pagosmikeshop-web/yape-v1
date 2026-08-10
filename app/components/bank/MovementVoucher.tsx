"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { APK_ASSET_ROOT, AssetIcon } from "./primitives";
import type { Movement } from "./types";
import { useVoucherScale } from "./useVoucherScale";

export function isYapeDestination(destination: string) {
  return destination.trim().toLocaleLowerCase("es-PE") === "yape";
}

export function isIzipayDestination(destination: string) {
  return destination.trim().toLocaleLowerCase("es-PE") === "izipay";
}

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

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("No se pudo convertir la imagen del comprobante."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("No se pudo leer la imagen del comprobante."));
    });
    reader.readAsDataURL(blob);
  });
}

async function rasterBlobAsPng(
  blob: Blob,
  requireRasterized = false,
): Promise<string> {
  if (blob.type === "image/svg+xml" || blob.type === "image/svg") {
    return readBlobAsDataUrl(blob);
  }

  try {
    let bitmap: ImageBitmap | null = null;
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        // Algunos navegadores exponen createImageBitmap pero no decodifican WebP.
        bitmap = null;
      }
    }

    if (!bitmap) {
      const objectUrl = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.decoding = "async";
        const loaded = new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener(
            "error",
            () => reject(new Error("La imagen del comprobante no pudo decodificarse.")),
            { once: true },
          );
        });
        image.src = objectUrl;
        await loaded;
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context || canvas.width === 0 || canvas.height === 0) {
          throw new Error("La imagen del comprobante no tiene dimensiones válidas.");
        }
        context.drawImage(image, 0, 0);
        return canvas.toDataURL("image/png");
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0 || canvas.height === 0) {
        throw new Error("La imagen del comprobante no tiene dimensiones válidas.");
      }
      context.drawImage(bitmap, 0, 0);
      return canvas.toDataURL("image/png");
    } finally {
      bitmap.close();
    }
  } catch (error) {
    // WebP is the banner format used by the voucher. Keeping it as a WebP
    // data URL would bring back the html-to-image omission we are avoiding.
    if (requireRasterized || blob.type === "image/webp") throw error;
    return readBlobAsDataUrl(blob);
  }
}

async function waitForVoucherImage(image: HTMLImageElement) {
  if (!image.complete) {
    await new Promise<void>((resolve) => {
      const finish = () => {
        image.removeEventListener("load", finish);
        image.removeEventListener("error", finish);
        resolve();
      };
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
      if (image.complete) finish();
    });
  }

  if (image.naturalWidth > 0) {
    try {
      await image.decode();
    } catch {
      // The browser already has a usable bitmap in this case.
    }
  }
}

async function inlineVoucherImages(voucherContent: HTMLDivElement) {
  const images = Array.from(voucherContent.querySelectorAll("img"));
  const originals = new Map<
    HTMLImageElement,
    { src: string | null; srcset: string | null }
  >();

  const restoreImages = () => {
    originals.forEach(({ src, srcset }, image) => {
      if (src === null) image.removeAttribute("src");
      else image.setAttribute("src", src);
      if (srcset === null) image.removeAttribute("srcset");
      else image.setAttribute("srcset", srcset);
    });
  };

  try {
    await Promise.all(
      images.map(async (image) => {
        await waitForVoucherImage(image);
        const source = image.currentSrc || image.getAttribute("src") || image.src;
        if (!source || source.startsWith("data:")) return;

        try {
          const response = await fetch(new URL(source, window.location.href), {
            credentials: "same-origin",
            cache: "force-cache",
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const dataUrl = await rasterBlobAsPng(
            await response.blob(),
            image.classList.contains("voucher-banner-image"),
          );
          if (
            image.classList.contains("voucher-banner-image") &&
            !dataUrl.startsWith("data:image/png")
          ) {
            throw new Error("El banner del comprobante no pudo rasterizarse.");
          }
          originals.set(image, {
            src: image.getAttribute("src"),
            srcset: image.getAttribute("srcset"),
          });
          image.setAttribute("src", dataUrl);
          // A stale srcset can override the inlined source in the clone.
          image.removeAttribute("srcset");
          await waitForVoucherImage(image);
          if (
            image.classList.contains("voucher-banner-image") &&
            image.naturalWidth === 0
          ) {
            throw new Error("El banner del comprobante no pudo decodificarse.");
          }
        } catch (error) {
          // Never create a receipt with a missing banner. Optional icons can
          // still be captured from their original source.
          if (image.classList.contains("voucher-banner-image")) throw error;
        }
      }),
    );
    return restoreImages;
  } catch (error) {
    restoreImages();
    throw error;
  }
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
      // `complete` no garantiza que los píxeles estén decodificados para html-to-image.
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            image.removeEventListener("load", finish);
            image.removeEventListener("error", finish);
            resolve();
          };
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
        });
      }

      if (image.naturalWidth > 0) {
        try {
          await image.decode();
        } catch {
          // html-to-image intentará incluirla igualmente si el navegador no puede decodificarla.
        }
      }
    }),
  );

  const restoreImages = await inlineVoucherImages(voucherContent);
  try {
    const { toBlob } = await import("html-to-image");
    const blob = await toBlob(voucherContent, {
      backgroundColor: "#660185",
      cacheBust: false,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      /*
       * La imagen se genera siempre sobre la superficie de diseño sin escalar
       * ni desplazar. html-to-image mide el nodo con offsetWidth/offsetHeight,
       * que ignoran la transformación, así que anular la escala y los márgenes
       * negativos de encaje deja un PNG de tamaño y composición idénticos en
       * cualquier dispositivo.
       */
      style: {
        transform: "none",
        margin: "0",
      },
    });

    if (!blob) throw new Error("No se pudo generar la imagen del comprobante.");

    return new File([blob], "comprobante-yape.png", { type: "image/png" });
  } finally {
    restoreImages();
  }
}

export async function shareVoucherImage(file: File): Promise<void> {
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
        // Compartir únicamente el archivo evita que el destino añada texto.
        await navigator.share({ files: [file] });
        return;
      } catch (error) {
        // Cerrar voluntariamente el selector no debe iniciar una descarga inesperada.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        // Algunos WebView anuncian soporte para archivos, pero bloquean navigator.share.
        // En ese caso continuamos con la descarga del PNG completo.
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
      <div className="voucher-single-promo-frame" aria-hidden="true">
        <img
          src="/assets/reference/mas-en-yape-banner.png"
          alt=""
          draggable={false}
        />
      </div>
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
  const hideSecurityCode = isIzipayDestination(movement.destination ?? "Yape");
  const [shareNotice, setShareNotice] = useState("");
  const [voucherShareFile, setVoucherShareFile] = useState<File | null>(null);
  const voucherCaptureRef = useRef<HTMLDivElement>(null);
  useVoucherScale(voucherCaptureRef);

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
      await shareVoucherImage(voucherShareFile);
      setShareNotice("");
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
            {hideSecurityCode ? (
              <div
                className="voucher-divider voucher-divider-izipay"
                aria-hidden="true"
              />
            ) : null}
            {!hideSecurityCode ? <div className="voucher-security">
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
            </div> : null}
            <div className="voucher-details">
              <span className="voucher-section-label">
                DATOS DE LA TRANSACCIÓN
              </span>
              {isYapeDestination(movement.destination ?? "Yape") ? (
                <div>
                  <span>Nro. de celular</span>
                  <strong>{movement.detail}</strong>
                </div>
              ) : null}
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
      </div>
      {/*
       * El aviso se posiciona con `position: fixed` respecto al viewport. Debe
       * quedar fuera de la superficie de diseño: dentro, la transformación de
       * escala lo reanclaría al comprobante y además entraría en la imagen
       * exportada.
       */}
      {shareNotice ? (
        <p className="inline-notice voucher-notice" role="status">
          {shareNotice}
        </p>
      ) : null}
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
