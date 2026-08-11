"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import { useModalLayer } from "../../hooks/useModalLayer";
import { QR_PROVIDERS, type QrProvider } from "../../lib/payment-providers";
import { AssetIcon } from "./primitives";
import { GlobalDirectoryTermsDialog } from "./GlobalDirectoryTermsDialog";

type QrDecodeResult = {
  getText: () => string;
};

type QrScannerControls = {
  stop: () => void;
};

type QrCodeReader = {
  decodeFromConstraints: (
    constraints: MediaStreamConstraints,
    preview: HTMLVideoElement,
    callback: (result?: QrDecodeResult, error?: unknown) => void,
  ) => Promise<QrScannerControls>;
  decodeFromImageUrl: (url: string) => Promise<QrDecodeResult>;
};


type SavedQrContact = {
  id: string;
  holderName: string;
  phone: string | null;
  provider: string;
  recipientId: string | null;
  verified: boolean;
  createdAt: string;
};

function savedQrPhone(phone: string | null) {
  if (!phone) return "Sin celular asociado";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 3
    ? `*** *** ${digits.slice(-3)}`
    : "Celular registrado";
}

function savedQrDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Guardado recientemente";
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function QrView() {
  const [contacts, setContacts] = useState<SavedQrContact[]>([]);
  const [holderName, setHolderName] = useState("");
  const [nameFormat, setNameFormat] = useState<"plain" | "protected">("plain");
  const [phone, setPhone] = useState("");
  const [provider, setProvider] = useState<QrProvider>("Yape");
  const [qrPayload, setQrPayload] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [decodeError, setDecodeError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<QrScannerControls | null>(null);
  const scanLockedRef = useRef(false);
  const savedQrDialogRef = useModalLayer<HTMLDivElement>(
    Boolean(modalMessage),
    () => setModalMessage(""),
  );

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const response = await fetch("/api/qr-directory", { cache: "no-store" });
      const data = (await response.json()) as {
        contacts?: SavedQrContact[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.contacts)) {
        throw new Error(safeApiMessage(data.error, "No pudimos cargar tus QR guardados."));
      }
      setContacts(data.contacts);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? safeClientMessage(error, "No pudimos cargar tus QR guardados.")
          : "No pudimos cargar tus QR guardados.",
      );
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadContacts();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadContacts]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => () => stopCamera(), [stopCamera]);

  const acceptQrValue = useCallback(
    (rawValue: string) => {
      const payload = rawValue.trim();
      const payloadBytes = new TextEncoder().encode(payload).byteLength;
      if (
        payloadBytes < 4 ||
        payloadBytes > 2048 ||
        /[\u0000-\u001f\u007f]/u.test(payload) ||
        /^(?:data|blob):/iu.test(payload)
      ) {
        setDecodeError(
          "El QR está vacío, no es seguro o contiene demasiada información.",
        );
        return;
      }
      if (scanLockedRef.current) return;
      scanLockedRef.current = true;
      setQrPayload(payload);
      setDecodeError("");
      setNotice("QR reconocido. Completa los datos para guardarlo.");
      window.setTimeout(stopCamera, 0);
    },
    [stopCamera],
  );

  const startCamera = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setDecodeError(
        "La cámara no está disponible. Puedes subir una imagen con QR.",
      );
      return;
    }
    try {
      stopCamera();
      scanLockedRef.current = false;
      setDecodeError("");
      setCameraOpen(true);
      await new Promise<void>((resolve) =>
        window.requestAnimationFrame(() => resolve()),
      );
      const preview = videoRef.current;
      if (!preview) throw new Error("camera-preview-unavailable");
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader() as QrCodeReader;
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        preview,
        (result) => {
          if (result) acceptQrValue(result.getText());
        },
      );
    } catch {
      stopCamera();
      setDecodeError(
        "No se pudo abrir la cámara. Revisa el permiso o sube una imagen.",
      );
    }
  }, [acceptQrValue, stopCamera]);

  async function handleQrImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setDecodeError("Selecciona una imagen JPG o PNG de hasta 10 MB.");
      return;
    }

    const nextPreview = URL.createObjectURL(file);
    setPreviewUrl(nextPreview);
    setSelectedFileName(file.name);
    setQrPayload("");
    setDecodeError("");
    setNotice(`Analizando ${file.name}...`);
    scanLockedRef.current = false;
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader() as QrCodeReader;
      const result = await reader.decodeFromImageUrl(nextPreview);
      acceptQrValue(result.getText());
    } catch {
      setDecodeError("No encontramos un código QR visible en esa imagen.");
      setNotice("");
    }
  }

  function clearCapture() {
    setQrPayload("");
    setPreviewUrl("");
    setSelectedFileName("");
    setDecodeError("");
    scanLockedRef.current = false;
  }

  function requestSaveQrContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!qrPayload || holderName.trim().length < 2 || saving) return;
    setTermsOpen(true);
  }

  async function publishQrContact() {
    if (!qrPayload || holderName.trim().length < 2 || saving) return;
    setTermsOpen(false);
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/qr-directory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holderName: holderName.trim(),
          phone,
          provider,
          payload: qrPayload,
          termsAccepted: true,
          termsVersion: "global-recipient-v1",
        }),
      });
      const data = (await response.json()) as {
        contact?: SavedQrContact;
        error?: string;
      };
      if (!response.ok || !data.contact)
        throw new Error(safeApiMessage(data.error, "No pudimos guardar el QR."));
      setHolderName("");
      setNameFormat("plain");
      setPhone("");
      setProvider("Yape");
      clearCapture();
      setModalMessage(
        `El QR de ${data.contact.holderName} quedó guardado en Yape.`,
      );
      await loadContacts();
    } catch (error) {
      setNotice(
        safeClientMessage(error, "No pudimos guardar el QR."),
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteQrContact(contact: SavedQrContact) {
    if (!window.confirm(`¿Eliminar el QR de ${contact.holderName}?`)) return;
    setNotice("");
    try {
      const response = await fetch(
        `/api/qr-directory/${encodeURIComponent(contact.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(safeApiMessage(data.error, "No pudimos eliminar el QR."));
      setContacts((current) =>
        current.filter((item) => item.id !== contact.id),
      );
      setNotice("QR eliminado.");
    } catch (error) {
      setNotice(
        safeClientMessage(error, "No pudimos eliminar el QR."),
      );
    }
  }

  const isYapeProvider = provider === "Yape";
  const canSave = Boolean(
    qrPayload
      && holderName.trim().length >= 2
      && (!isYapeProvider || /^\d{3}$/u.test(phone))
      && !saving,
  );

  return (
    <div className="qrc-page">
      <header className="qrc-header">
        <div className="qrc-header-inner">
          <Link
            href="/perfil"
            className="qrc-avatar"
            aria-label="Volver al perfil"
          >
            <AssetIcon name="ic_qrcode_r_yape" />
          </Link>
          <div>
            <h1 className="qrc-header-title">Registrar QR</h1>
            <p className="qrc-header-sub">Sube una imagen con código QR</p>
          </div>
        </div>
      </header>

      <form className="qrc-card" onSubmit={requestSaveQrContact}>
        <input
          ref={fileInputRef}
          className="qrc-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={handleQrImage}
        />
        <button
          className={`qrc-upload-zone${qrPayload ? " is-ready" : ""}`}
          type="button"
          onClick={() => fileInputRef.current?.click()}
        >
          {previewUrl ? (
            <img
              className="qrc-upload-preview"
              src={previewUrl}
              alt="Vista previa del QR seleccionado"
            />
          ) : (
            <AssetIcon name="ic_qr_code_outline_yape" />
          )}
          <span
            className={`qrc-upload-text${qrPayload ? " qrc-upload-ok" : ""}`}
          >
            {qrPayload
              ? "QR reconocido correctamente"
              : "Toca para subir imagen con QR"}
          </span>
          <span className="qrc-upload-hint">
            {selectedFileName || "JPG, PNG — El código QR debe verse completo"}
          </span>
          {decodeError ? (
            <span className="qrc-upload-error" role="alert">
              {decodeError}
            </span>
          ) : null}
        </button>

        <div
          className={`qrc-camera-view${cameraOpen ? " is-open" : ""}`}
          aria-hidden={!cameraOpen}
        >
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            aria-label="Cámara para leer el QR que deseas guardar"
          />
          <button
            className="qrc-camera-close"
            type="button"
            onClick={stopCamera}
          >
            Cerrar cámara
          </button>
        </div>
        {!cameraOpen ? (
          <button
            className="qrc-camera-btn"
            type="button"
            onClick={() => void startCamera()}
          >
            <AssetIcon name="ic_add_photo_outline_yape" />
            Escanear con cámara
          </button>
        ) : null}

        <label className="qrc-field">
          <span className="qrc-label">Nombre visible del titular</span>
          <input
            className="qrc-input"
            value={holderName}
            onChange={(event) => setHolderName(event.target.value.slice(0, 80))}
            placeholder={nameFormat === "protected" ? "Ej: Laura Qui*" : "Ej: Juan Pérez"}
            autoComplete="name"
            required
            minLength={2}
          />
        </label>
        <div className="qrc-name-format-options">
          <label className="qrc-name-format">
            <input
              type="checkbox"
              checked={nameFormat === "protected"}
              onChange={(event) =>
                setNameFormat(event.target.checked ? "protected" : "plain")
              }
            />
            <span>Nombre protegido</span>
          </label>
          <p className="qrc-name-format-hint">
            Escribe el nombre exactamente como quieres mostrarlo. No se modifica automáticamente.
          </p>
        </div>
        {isYapeProvider ? (
          <label className="qrc-field">
            <span className="qrc-label">
              Últimos 3 dígitos del celular
              <small className="qrc-optional">(solo para identificar el QR)</small>
            </span>
            <input
              className="qrc-input"
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value.replace(/\D/g, "").slice(0, 3))
              }
              placeholder="000"
              maxLength={3}
              pattern="[0-9]{3}"
              autoComplete="off"
              required
            />
          </label>
        ) : null}
        <label className="qrc-field">
          <span className="qrc-label">App / Banco de destino</span>
          <span className="qrc-select-wrap">
            <select
              className="qrc-select"
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as QrProvider;
                setProvider(nextProvider);
                if (nextProvider !== "Yape") setPhone("");
              }}
            >
              {QR_PROVIDERS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </span>
        </label>

        {qrPayload ? (
          <button
            className="qrc-clear-capture"
            type="button"
            onClick={clearCapture}
          >
            Cambiar código QR
          </button>
        ) : null}
        <button className="qrc-btn" type="submit" disabled={!canSave}>
          {saving ? "Registrando..." : "Registrar"}
        </button>
        {notice ? (
          <p className="qrc-notice" role="status">
            {notice}
          </p>
        ) : null}
      </form>

      <section className="qrc-saved-section" aria-labelledby="saved-qr-title">
        <div className="qrc-saved-heading">
          <h2 id="saved-qr-title">Tus QR registrados</h2>
          <span>{contacts.length} recientes</span>
        </div>
        {loadingContacts ? (
          <p className="qrc-empty">Cargando tus QR...</p>
        ) : null}
        {!loadingContacts && contacts.length === 0 ? (
          <p className="qrc-empty">Los QR que registres aparecerán aquí.</p>
        ) : null}
        <div className="qrc-saved-list">
          {contacts.map((contact) => (
            <article className="qrc-saved-item" key={contact.id}>
              <span className="qrc-saved-icon">
                <AssetIcon name="ic_qrcode_r_yape_primary" />
              </span>
              <span className="qrc-saved-copy">
                <strong>{contact.holderName}</strong>
                <small>
                  {contact.provider} · {savedQrPhone(contact.phone)}
                  {contact.verified ? " · Verificado" : " · Solo guardado"}
                </small>
                <time dateTime={contact.createdAt}>
                  {savedQrDate(contact.createdAt)}
                </time>
              </span>
              <span className="qrc-saved-actions">
                {contact.recipientId ? (
                  <Link
                    href={`/transferir?recipient=${encodeURIComponent(contact.recipientId)}`}
                  >
                    Usar
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => void deleteQrContact(contact)}
                  aria-label={`Eliminar QR de ${contact.holderName}`}
                >
                  Eliminar
                </button>
              </span>
            </article>
          ))}
        </div>
      </section>

      <Link className="qrc-personal-link" href="/qr-personal">
        Ver mi QR personal para recibir yapeos
      </Link>

      {modalMessage ? (
        <div
          ref={savedQrDialogRef}
          className="qrc-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="QR guardado"
          tabIndex={-1}
        >
          <div className="qrc-modal">
            <span className="qrc-modal-icon">
              <AssetIcon name="ic_qrcode_r_yape_primary" />
            </span>
            <p className="qrc-modal-msg">{modalMessage}</p>
            <button
              className="qrc-modal-close"
              type="button"
              onClick={() => setModalMessage("")}
            >
              Listo
            </button>
          </div>
        </div>
      ) : null}
      <GlobalDirectoryTermsDialog
        open={termsOpen}
        onCancel={() => setTermsOpen(false)}
        onAccept={() => void publishQrContact()}
      />
    </div>
  );
}
