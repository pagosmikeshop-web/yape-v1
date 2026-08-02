"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeQrPayload } from "../../lib/qr-scanning";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import { APK_ASSET_ROOT, AssetIcon } from "./primitives";

type DecodeResult = { getText: () => string };
type ScannerControls = { stop: () => void };
type CameraDevice = { deviceId: string; label: string };
type ScanStatus = "searching" | "processing" | "result" | "error" | "paused";

type ScanResponse = {
  ok?: boolean;
  status?: "valid" | "invalid";
  message?: string;
  qr?: {
    id: string;
    name: string;
    provider: string;
    recipientId: string | null;
  };
  error?: string;
};

const COOLDOWN_MS = 1_800;

function statusCopy(status: ScanResponse["status"] | undefined) {
  return status === "valid" ? "QR válido." : "QR inválido.";
}

function playFeedback(success: boolean) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate(success ? 70 : [40, 35, 40]);
  }
  if (typeof window === "undefined" || !window.AudioContext) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = success ? 880 : 220;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.13);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // El sonido es opcional; el resultado visual no depende de él.
  }
}

export function QRCodeScanner() {
  const router = useRouter();
  const [status, setStatus] = useState<ScanStatus>("searching");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [flashlight, setFlashlight] = useState(false);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(true);
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
    setFlashlight(false);
  }, []);

  const enumerateCameras = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cameras = all
      .filter((device) => device.kind === "videoinput" && device.deviceId)
      .map((device, index) => ({
        deviceId: device.deviceId,
        label: device.label || `Cámara ${index + 1}`,
      }));
    setDevices(cameras);
    if (!selectedDevice && cameras[0]) {
      const rearCamera = cameras.find((camera) => /back|rear|environment|trasera/i.test(camera.label));
      setSelectedDevice((rearCamera ?? cameras[0]).deviceId);
    }
  }, [selectedDevice]);

  const startCamera = useCallback(async (deviceId = selectedDevice) => {
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
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      controlsRef.current = await reader.decodeFromConstraints(
        constraints,
        preview,
        (decoded: DecodeResult | undefined) => {
          if (decoded) void processValue(decoded.getText());
        },
      );
      setCameraReady(true);
      await enumerateCameras();
    } catch (error) {
      stopCamera();
      setStatus("error");
      setNotice(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Permite el acceso a la cámara para escanear un QR."
        : "No se pudo abrir la cámara. Revisa el permiso o sube una imagen.");
    }
  }, [enumerateCameras, selectedDevice, stopCamera]);

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
    setNotice("Validando el QR con Supabase…");
    const scanId = crypto.randomUUID();
    try {
      const response = await fetch("/api/qr/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ value, scanId }),
      });
      const data = await response.json() as ScanResponse;
      if (!response.ok || !data.status) {
        throw new Error(safeApiMessage(data.error, "No pudimos validar el QR."));
      }
      setResult(data);
      if (data.status === "valid") {
        setStatus("result");
        setNotice(data.message ?? "QR válido.");
        if (soundEnabled) playFeedback(true);
      } else {
        setStatus("error");
        setNotice(data.message ?? statusCopy(data.status));
        if (soundEnabled) playFeedback(false);
      }
    } catch (error) {
      setResult(null);
      setStatus("error");
      setNotice(safeClientMessage(error, "No pudimos contactar con Supabase. Revisa tu conexión e inténtalo nuevamente."));
      if (soundEnabled) playFeedback(false);
    }
  }, [soundEnabled, stopCamera]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setStatus("error");
      setNotice("Selecciona una imagen JPG, PNG o WebP de hasta 10 MB.");
      return;
    }
    const preview = URL.createObjectURL(file);
    setUploadedImage((current) => { if (current) URL.revokeObjectURL(current); return preview; });
    setStatus("processing");
    setNotice("Analizando la imagen…");
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

  async function toggleFlashlight() {
    const stream = videoRef.current?.srcObject;
    const track = stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
    const capabilities = track?.getCapabilities() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
    if (!track || !capabilities?.torch) {
      setNotice("La linterna no está disponible en esta cámara.");
      return;
    }
    const next = !flashlight;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] } as unknown as MediaTrackConstraints);
      setFlashlight(next);
    } catch {
      setNotice("No se pudo cambiar la linterna.");
    }
  }

  function retry() {
    setResult(null);
    scanLockedRef.current = false;
    setUploadedImage((current) => { if (current) URL.revokeObjectURL(current); return ""; });
    void startCamera();
  }

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
    };
    // The scanner must start once per screen mount, not on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    if (uploadedImage) URL.revokeObjectURL(uploadedImage);
  }, [uploadedImage]);

  const canContinue = Boolean(result?.qr?.recipientId);

  return (
    <div className={`reference-scanner-view${flashlight ? " is-lit" : ""}`} aria-busy={status === "processing"}>
      <header>
        <span className="scanner-status-chip">LECTOR QR SEGURO</span>
        <Link href="/inicio" aria-label="Cerrar escáner"><AssetIcon name="ic_close_scan" /></Link>
      </header>

      <div className={`scanner-frame scanner-live-frame${cameraReady ? " is-camera-ready" : ""}`}>
        <video ref={videoRef} className={`scanner-video${cameraReady ? " is-ready" : ""}`} muted playsInline autoPlay aria-label="Cámara para escanear QR" />
        {uploadedImage ? <img className="scanner-upload-preview" src={uploadedImage} alt="Imagen QR seleccionada" /> : null}
        <i aria-hidden="true" />
        <p>{status === "processing" ? "Validando con Supabase…" : status === "paused" ? "Escáner en pausa" : "Coloca el código QR dentro del recuadro"}</p>
      </div>

      {devices.length > 1 ? (
        <label className="scanner-camera-select">
          <span>Cámara</span>
          <select value={selectedDevice} onChange={(event) => { setSelectedDevice(event.target.value); void startCamera(event.target.value); }} disabled={status === "processing"}>
            {devices.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
          </select>
        </label>
      ) : null}

      <input ref={fileInputRef} className="scanner-file-input" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} />
      <div className="scanner-actions scanner-live-actions">
        <button type="button" onClick={() => void toggleFlashlight()} disabled={!cameraReady || status === "processing"}><AssetIcon name="mb_ic_flash_on" />{flashlight ? "Apagar linterna" : "Encender linterna"}</button>
        <button type="button" onClick={() => { if (paused) { setPaused(false); void startCamera(); } else { stopCamera(); setPaused(true); setStatus("paused"); } }} disabled={status === "processing"}>{paused ? "Reanudar cámara" : "Pausar cámara"}</button>
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={status === "processing"}><AssetIcon name="ic_add_photo_outline_yape" />Subir una imagen con QR</button>
      </div>

      {notice ? <p className={`scanner-notice scanner-notice-${status}`} role={status === "error" ? "alert" : "status"}>{notice}</p> : null}

      {result?.qr && status === "result" ? (
        <section className="scanner-result" aria-live="polite">
          <div className="scanner-result-icon"><AssetIcon name="ic_check_circle" /></div>
          <div><strong>{result.qr.name}</strong><span>{result.qr.provider}</span></div>
          {canContinue ? <button type="button" onClick={() => router.push(`/transferir?recipient=${encodeURIComponent(result.qr?.recipientId ?? "")}`)}>Continuar al pago</button> : null}
          <button type="button" className="scanner-secondary-action" onClick={retry}>Escanear otro QR</button>
        </section>
      ) : null}

      {status === "error" ? <button type="button" className="scanner-retry" onClick={retry}>Intentar nuevamente</button> : null}
      <label className="scanner-preferences"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} />Sonido y vibración</label>
      <small>La lectura se registra de forma segura y no guarda el contenido completo del QR.</small>
      <img className="scanner-brand-mark" src={`${APK_ASSET_ROOT}/icons/ic_qrcode_r_yape_primary.svg`} alt="" aria-hidden="true" />
    </div>
  );
}
