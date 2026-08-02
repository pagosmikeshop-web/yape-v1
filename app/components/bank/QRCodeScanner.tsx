"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import { normalizeQrPayload, QR_TRANSFER_SESSION_KEY } from "../../lib/qr-scanning";
import { APK_ASSET_ROOT, AssetIcon } from "./primitives";

type DecodeResult = { getText: () => string };
type ScannerControls = { stop: () => void };
type ScanStatus = "searching" | "processing" | "error";

type ScanResponse = {
  status?: "valid" | "invalid";
  message?: string;
  qr?: {
    id: string;
    name: string;
    provider: string;
    recipientId: string | null;
    phone: string | null;
  };
  error?: string;
};

const COOLDOWN_MS = 1_800;

function statusCopy(status: ScanResponse["status"] | undefined) {
  return status === "valid" ? "QR válido." : "QR inválido.";
}

export function QRCodeScanner() {
  const router = useRouter();
  const [status, setStatus] = useState<ScanStatus>("searching");
  const [notice, setNotice] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [uploadedImage, setUploadedImage] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const scanLockedRef = useRef(false);
  const lastValueRef = useRef("");
  const lastReadAtRef = useRef(0);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice("La cámara no está disponible. Puedes subir una imagen con QR.");
      setStatus("error");
      return;
    }
    try {
      stopCamera();
      scanLockedRef.current = false;
      setNotice("");
      setStatus("searching");
      const preview = videoRef.current;
      if (!preview) throw new Error("camera-preview-unavailable");
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      controlsRef.current = await reader.decodeFromConstraints(
        {
          // El navegador selecciona la cámara trasera automáticamente. No se
          // muestra un select porque iOS lo convierte en un picker nativo.
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        preview,
        (decoded: DecodeResult | undefined) => {
          if (decoded) void processValue(decoded.getText());
        },
      );
      setCameraReady(true);
    } catch (error) {
      stopCamera();
      setStatus("error");
      setNotice(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Permite el acceso a la cámara para escanear un QR."
        : "No se pudo abrir la cámara. Revisa el permiso o sube una imagen.");
    }
  }, [stopCamera]);

  const processValue = useCallback(async (rawValue: string) => {
    if (scanLockedRef.current) return;
    const value = normalizeQrPayload(rawValue);
    if (!value) {
      setStatus("error");
      setNotice("El código leído no es válido.");
      return;
    }
    const now = Date.now();
    if (value === lastValueRef.current && now - lastReadAtRef.current < COOLDOWN_MS) return;
    lastValueRef.current = value;
    lastReadAtRef.current = now;
    scanLockedRef.current = true;
    stopCamera();
    setStatus("processing");
    setNotice("Validando el QR...");

    try {
      const response = await fetch("/api/qr/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ value, scanId: crypto.randomUUID() }),
      });
      const data = await response.json() as ScanResponse;
      if (!response.ok || !data.status) {
        throw new Error(safeApiMessage(data.error, "No pudimos validar el QR."));
      }
      if (data.status !== "valid") {
        setStatus("error");
        setNotice(data.message ?? statusCopy(data.status));
        return;
      }
      if (!data.qr || (!data.qr.recipientId && !data.qr.phone)) {
        throw new Error("El QR no contiene un destinatario válido.");
      }

      const transferPayload = JSON.stringify({
        recipientId: data.qr.recipientId,
        phone: data.qr.phone,
        displayName: data.qr.name,
      });
      let stored = false;
      try {
        sessionStorage.setItem(QR_TRANSFER_SESSION_KEY, transferPayload);
        stored = true;
      } catch {
        // Fallback para navegadores que bloquean sessionStorage.
      }

      if (stored) {
        router.replace("/transferir?from=qr");
      } else if (data.qr.recipientId) {
        router.replace(`/transferir?recipient=${encodeURIComponent(data.qr.recipientId)}`);
      } else {
        throw new Error("No pudimos preparar el destinatario para el pago.");
      }
    } catch (error) {
      setStatus("error");
      setNotice(safeClientMessage(error, "No pudimos contactar con el servidor. Revisa tu conexión e intenta nuevamente."));
    }
  }, [router, stopCamera]);

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setStatus("error");
      setNotice("Selecciona una imagen JPG, PNG o WebP de hasta 10 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setUploadedImage((current) => {
      if (current) URL.revokeObjectURL(current);
      return preview;
    });
    setStatus("processing");
    setNotice("Analizando la imagen...");
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      const decoded = await reader.decodeFromImageUrl(preview);
      await processValue(decoded.getText());
    } catch {
      scanLockedRef.current = false;
      setStatus("error");
      setNotice("No encontramos un código QR visible en esa imagen.");
    }
  }

  function retry() {
    scanLockedRef.current = false;
    setUploadedImage((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
    void startCamera();
  }

  useEffect(() => {
    void startCamera();
    return () => stopCamera();
    // El escáner se inicia una vez por montaje, no en cada cambio de estado.
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only camera lifecycle
  }, []);

  useEffect(() => () => {
    if (uploadedImage) URL.revokeObjectURL(uploadedImage);
  }, [uploadedImage]);

  return (
    <div className="reference-scanner-view" aria-busy={status === "processing"}>
      <header>
        <span className="scanner-status-chip">LECTOR QR SEGURO</span>
        <Link href="/inicio" aria-label="Cerrar escáner"><AssetIcon name="ic_close_scan" /></Link>
      </header>

      <div className={`scanner-frame scanner-live-frame${cameraReady ? " is-camera-ready" : ""}`}>
        <video ref={videoRef} className={`scanner-video${cameraReady ? " is-ready" : ""}`} muted playsInline autoPlay aria-label="Cámara para escanear QR" />
        {uploadedImage ? <img className="scanner-upload-preview" src={uploadedImage} alt="Imagen QR seleccionada" /> : null}
        <i aria-hidden="true" />
        <p>{status === "processing" ? "Validando el QR..." : "Coloca el código QR dentro del recuadro"}</p>
      </div>

      <input ref={fileInputRef} className="scanner-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} />
      <div className="scanner-actions scanner-live-actions">
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={status === "processing"}>
          <AssetIcon name="ic_add_photo_outline_yape" />
          Subir una imagen con QR
        </button>
      </div>

      {notice ? <p className={`scanner-notice scanner-notice-${status}`} role={status === "error" ? "alert" : "status"}>{notice}</p> : null}
      {status === "error" ? <button type="button" className="scanner-retry" onClick={retry}>Intentar nuevamente</button> : null}
      <small>La lectura se registra de forma segura y no guarda el contenido completo del QR.</small>
      <img className="scanner-brand-mark" src={`${APK_ASSET_ROOT}/icons/ic_qrcode_r_yape_primary.svg`} alt="" aria-hidden="true" />
    </div>
  );
}
