"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  clearSessionCache,
  fetchSession,
  setOptimisticUnlock,
} from "../lib/session-cache";
import { clearBalanceCache, fetchAccountBalance } from "../lib/balance-cache";
import {
  formatAccountBalance,
  isValidAccountBalanceCents,
  MAX_ACCOUNT_BALANCE_CENTS,
  normalizeAccountBalanceInput,
  parseAccountBalanceCents,
} from "../lib/money";
import { copyText } from "../lib/platform-adapters";
import { safeApiMessage, safeClientMessage } from "../lib/client-error";
import { useModalLayer } from "../hooks/useModalLayer";
import {
  APK_ASSET_ROOT,
  AssetIcon,
  AssetIllustration,
  LottiePlayer,
} from "./bank/primitives";
import {
  createVoucherImage,
  formatVoucherAmount,
  formatVoucherDate,
  formatVoucherTime,
  getVoucherHero,
  isIzipayDestination,
  isYapeDestination,
  shareVoucherImage,
  VoucherSinglePromo,
} from "./bank/MovementVoucher";
import { useVoucherScale } from "./bank/useVoucherScale";
import { HomeView } from "./bank/HomeView";
import { InnerHeader } from "./bank/InnerHeader";
import { maskPhone, TransferView } from "./bank/TransferView";
import { PersonalQrView } from "./bank/PersonalQrView";
import { ProfileView } from "./bank/ProfileView";
import { NotificationsView } from "./bank/NotificationsView";
import { RecipientContactsView } from "./bank/RecipientContactsView";
import { QRCodeScanner } from "./bank/QRCodeScanner";
import { QrView } from "./bank/QrView";
import { MovementsView } from "./bank/MovementsView";
import {
  fetchStoredMovements,
  HISTORY_CLEARED_EVENT,
  MOVEMENT_HISTORY_CLEARED_KEY,
} from "./bank/movement-history";
import { SimpleMovementList } from "./bank/SimpleMovementList";
import type {
  BankView,
  Movement,
} from "./bank/types";

export type { BankView } from "./bank/types";

const viewTitles: Partial<Record<BankView, string>> = {
  movements: "Movimientos",
  transfer: "Yapear",
  qr: "Guardar QR",
  "personal-qr": "Mi QR personal",
  profile: "Mi perfil",
  notifications: "Notificaciones",
  "account-data": "Mis datos",
  "account-details": "Datos de mi cuenta",
  "account-payment-data": "Autocompletado Free",
  "voucher-editor": "Editar voucher",
  "high-amount": "Confirmación de yapeo alto",
  limits: "Límites transaccionales",
  "transfer-alerts": "Notificaciones por yapeo",
  help: "Centro de ayuda",
  biometric: "Biometría digital",
  addresses: "Mis direcciones",
  "online-purchases": "Compras por internet",
  scanner: "Escanear QR",
};

function AccountHubMenuItem({
  icon,
  title,
  description,
  href,
  external,
  disabled,
  onClick,
  expanded,
}: {
  icon: string;
  title: string;
  description: string;
  href?: string;
  external?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  expanded?: boolean;
}) {
  const content = (
    <>
      <span className="account-hub-row-icon">
        <AssetIcon name={icon} />
      </span>
      <span className="account-hub-row-copy">
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      {disabled ? null : (
        <AssetIcon
          name={expanded ? "ic_chevron_up_yape" : "ic_chevron_right_yape"}
          className="account-hub-chevron"
        />
      )}
    </>
  );

  if (disabled)
    return (
      <button
        className="account-hub-row is-disabled"
        type="button"
        disabled
        aria-disabled="true"
      >
        {content}
      </button>
    );
  if (href && external)
    return (
      <a className="account-hub-row" href={href}>
        {content}
      </a>
    );
  if (href)
    return (
      <Link className="account-hub-row" href={href}>
        {content}
      </Link>
    );
  return (
    <button
      className="account-hub-row"
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
    >
      {content}
    </button>
  );
}

type AccountHubUser = {
  displayName: string;
  accessExpiresAt: string | null;
  referralCode: string | null;
};

type ReferralOverview = {
  code: string | null;
  command: string | null;
  rewardDays: number;
  redemptionLimit: number;
  usedRedemptions: number;
  remainingRedemptions: number;
  groupUrl: string;
};

function remainingAccessDays(accessExpiresAt: string | null) {
  if (!accessExpiresAt) return null;
  return Math.max(
    0,
    Math.ceil((Date.parse(accessExpiresAt) - Date.now()) / 86_400_000),
  );
}

function AccountDataView() {
  const [user, setUser] = useState<AccountHubUser | null>(null);
  const [accessExpanded, setAccessExpanded] = useState(false);
  const [referralExpanded, setReferralExpanded] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [accessMessage, setAccessMessage] = useState("");
  const [claimingAccess, setClaimingAccess] = useState(false);
  const [referral, setReferral] = useState<ReferralOverview | null>(null);
  const [referralNotice, setReferralNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((result) => {
      if (!cancelled && result.ok && result.user)
        setUser(result.user as AccountHubUser);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/referral", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && data?.ok !== false)
          setReferral(data as ReferralOverview);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyReferral(value: string, message: string) {
    const result = await copyText(value);
    if (result.ok) {
      setReferralNotice(message);
    } else {
      setReferralNotice("Mantén presionado el código para copiarlo.");
    }
  }

  async function claimPermanentAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken.trim() || claimingAccess) return;
    setClaimingAccess(true);
    setAccessMessage("");
    try {
      const response = await fetch("/api/access/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: accessToken }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(safeApiMessage(data?.error, "No pudimos validar el token."));
      setUser((current) =>
        current ? { ...current, accessExpiresAt: null } : current,
      );
      setAccessToken("");
      setAccessMessage(
        safeApiMessage(data.message, "Tu acceso ahora es permanente."),
      );
    } catch (error) {
      setAccessMessage(
        safeClientMessage(error, "No pudimos validar el token."),
      );
    } finally {
      setClaimingAccess(false);
    }
  }

  const accessDays = user
    ? remainingAccessDays(user.accessExpiresAt)
    : undefined;
  return (
    <div className="account-hub">
      <header className="account-hub-header">
        <Link href="/perfil" aria-label="Volver a mi perfil">
          <AssetIcon name="ic_arrow_left_yape" />
        </Link>
        <span>Cuenta y perfil</span>
        <Link href="/ayuda" aria-label="Abrir ayuda">
          <AssetIcon name="ic_headphone_outline_yape" />
        </Link>
      </header>

      <section className="account-hub-hero">
        <span className="account-hub-eyebrow">TU ESPACIO PERSONAL</span>
        <h1>Mis datos</h1>
        <p>
          Gestiona tu información, tus contactos y las opciones de tu cuenta
          desde un solo lugar.
        </p>
        <button
          className={`account-hub-status-card${accessDays === null ? " is-permanent" : ""}`}
          type="button"
          onClick={() => setAccessExpanded((current) => !current)}
          aria-expanded={accessExpanded}
        >
          <span className="account-hub-avatar">
            <AssetIcon name="ic_person_solid_yape_on_primary" />
          </span>
          <span>
            <strong>{user?.displayName || "Mi cuenta Yape"}</strong>
            <small>
              {accessDays === undefined
                ? "Consultando acceso"
                : accessDays === null
                  ? "Acceso permanente"
                  : "Acceso activo"}
            </small>
          </span>
          <span className="account-hub-status">
            <i /> {accessDays === null ? "Permanente" : "Activa"}
          </span>
        </button>
        {accessExpanded ? (
          <form
            className="account-hub-access-panel"
            onSubmit={claimPermanentAccess}
          >
            <div>
              <strong>Activar acceso permanente</strong>
              <small>
                Ingresa el token de un solo uso entregado por tu vendedor.
              </small>
            </div>
            <label>
              <span>Token permanente</span>
              <input
                value={accessToken}
                onChange={(event) => {
                  setAccessToken(event.target.value.toUpperCase());
                  setAccessMessage("");
                }}
                placeholder="YAPE-XXXX-XXXX-XXXX"
                autoComplete="one-time-code"
              />
            </label>
            <button
              type="submit"
              disabled={!accessToken.trim() || claimingAccess}
            >
              {claimingAccess ? "Validando…" : "Reclamar token"}
            </button>
            {accessMessage ? (
              <p className="account-hub-access-message" role="status">
                {accessMessage}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>

      <main className="account-hub-content">
        <section
          className="account-referral-card"
          aria-labelledby="account-referral-title"
        >
          <div className="account-referral-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <header>
            <button
              type="button"
              className="account-referral-toggle"
              onClick={() => setReferralExpanded((current) => !current)}
              aria-expanded={referralExpanded}
              aria-controls="account-referral-details"
            >
              <span className="account-referral-icon">+3</span>
              <span className="account-referral-heading">
                <span>PROGRAMA DE INVITACIONES</span>
                <span className="account-referral-title" id="account-referral-title">
                  Gana días con tu código
                </span>
              </span>
              <strong>
                {referral
                  ? `${referral.remainingRedemptions}/${referral.redemptionLimit}`
                  : "—"}
              </strong>
              <span className="account-referral-chevron" aria-hidden="true">
                {referralExpanded ? "⌃" : "⌄"}
              </span>
            </button>
          </header>
          <div
            id="account-referral-details"
            className="account-referral-details"
            hidden={!referralExpanded}
          >
              <p>
                Comparte tu código. Otra persona debe entrar al grupo y usar el
                comando desde su propia cuenta de Telegram.
              </p>
              <div className="account-referral-code">
                <span>
                  <small>Tu código personal</small>
                  <strong>
                    {referral?.code || user?.referralCode || "Preparando…"}
                  </strong>
                </span>
                <button
                  type="button"
                  disabled={!referral?.code}
                  onClick={() =>
                    referral?.code &&
                    void copyReferral(referral.code, "Código copiado.")
                  }
                >
                  Copiar
                </button>
              </div>
              <div className="account-referral-command">
                <code>
                  {referral?.command ||
                    (user?.referralCode
                      ? `/redeem ${user.referralCode}`
                      : "/redeem CODIGO")}
                </code>
                <button
                  type="button"
                  disabled={!referral?.command}
                  onClick={() =>
                    referral?.command &&
                    void copyReferral(referral.command, "Comando copiado.")
                  }
                >
                  Copiar comando
                </button>
              </div>
              <ol>
                <li>
                  <i>1</i>
                  <span>Comparte tu código con otra persona.</span>
                </li>
                <li>
                  <i>2</i>
                  <span>Esa persona entra al grupo de Telegram.</span>
                </li>
                <li>
                  <i>3</i>
                  <span>
                    Escribe el comando y tú recibes {referral?.rewardDays ?? 3}{" "}
                    días.
                  </span>
                </li>
              </ol>
              <footer>
                <span>
                  <strong>{referral?.usedRedemptions ?? 0}</strong> canjes usados
                </span>
                <a href={referral?.groupUrl || "/api/telegram/group"}>
                  Abrir grupo de Telegram
                </a>
              </footer>
              {referralNotice ? (
                <p className="account-referral-notice" role="status">
                  {referralNotice}
                </p>
              ) : null}
          </div>
        </section>

        <section
          className="account-hub-section"
          aria-labelledby="account-management-title"
        >
          <div className="account-hub-section-heading">
            <div>
              <span>GESTIÓN</span>
              <h2 id="account-management-title">Cuenta y operaciones</h2>
            </div>
          </div>
          <div className="account-hub-menu-card">
            <AccountHubMenuItem
              icon="ic_dni_outline_yape_primary"
              title="Datos de mi cuenta"
              description="Información personal y afiliación"
              href="/datos-cuenta/detalle"
            />
            <AccountHubMenuItem
              icon="ic_qrcode_r_yape_primary"
              title="Autocompletado Free"
              description="Nombres y QR para autocompletar"
              href="/datos-cuenta/recepcion"
            />
            <AccountHubMenuItem
              icon="ic_document_outline_yape_primary"
              title="DOX (Documentos)"
              description="Consulta documentos y comprobantes"
              disabled
            />
            <AccountHubMenuItem
              icon="ic_shopping_cart_outline_yape"
              title="Servicios"
              description="Pagos, recargas y servicios disponibles"
              disabled
            />
            <AccountHubMenuItem
              icon="ic_list_b_yape"
              title="Editar voucher"
              description="Configura y revisa una vista previa"
              href="/editar-voucher"
            />
            <AccountHubMenuItem
              icon="ic_bell_r_yape_primary"
              title="Programar notificación"
              description="Configura tus avisos de yapeo"
              disabled
            />
          </div>
        </section>

        <section
          className="account-hub-section account-hub-last-section"
          aria-labelledby="account-more-title"
        >
          <div className="account-hub-section-heading">
            <div>
              <span>MÁS OPCIONES</span>
              <h2 id="account-more-title">Ayuda y preferencias</h2>
            </div>
          </div>
          <div className="account-hub-menu-card">
            <AccountHubMenuItem
              icon="ic_headset_r_yape"
              title="Contactar soporte"
              description="Abre el chat directo en Telegram"
              href="/api/telegram/support?source=account-data"
              external
            />
            <AccountHubMenuItem
              icon="ic_document_r_yape"
              title="Términos y condiciones"
              description="Consulta la información legal"
              disabled
            />
            <AccountHubMenuItem
              icon="ic_book_outline_yape"
              title="Videotutoriales"
              description="Aprende a usar cada función"
              disabled
            />
          </div>
        </section>
      </main>
    </div>
  );
}

type VoucherEditorPreview = {
  name: string;
  phone: string;
  destination: string;
  message: string;
  amount: string;
  date: string;
  time: string;
  operation: string;
};

const voucherDestinations = [
  ["Yape", "Yape"],
  ["Plin", "Plin"],
  ["BCP", "BCP"],
  ["BBVA", "BBVA"],
  ["Interbank", "Interbank"],
  ["Scotiabank", "Scotiabank"],
  ["Bim", "Bim"],
  ["Falabella", "Banco Falabella"],
  ["Pichincha", "Banco Pichincha"],
  ["Dale", "Dale!"],
  ["Izipay", "Izipay"],
  ["Agora", "Agora / Oh!"],
  ["Tunki", "Tunki"],
] as const;

function getLocalInputDate(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(0, 10);
}

function getLocalInputTime(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );
  return localDate.toISOString().slice(11, 16);
}

function createVoucherOperation() {
  return `01${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

function ConfiguredVoucherReceipt({
  voucher,
  onEdit,
}: {
  voucher: VoucherEditorPreview;
  onEdit: () => void;
}) {
  const [shareNotice, setShareNotice] = useState("");
  const [voucherShareFile, setVoucherShareFile] = useState<File | null>(null);
  const voucherCaptureRef = useRef<HTMLDivElement>(null);
  useVoucherScale(voucherCaptureRef);
  const amountValue = Number(voucher.amount);
  const voucherHero = getVoucherHero(amountValue);
  const voucherDate = new Date(`${voucher.date}T${voucher.time || "00:00"}:00`);
  const validVoucherDate = Number.isNaN(voucherDate.getTime())
    ? new Date()
    : voucherDate;
  const formattedDate = formatVoucherDate(validVoucherDate);
  const formattedTime = formatVoucherTime(validVoucherDate);
  const securityCode = voucher.operation.slice(-3).padStart(3, "0");
  const hideSecurityCode = isIzipayDestination(voucher.destination);

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
  }, [voucher]);

  async function shareConfiguredVoucher() {
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
      className="yape-voucher yape-success-voucher configured-voucher-receipt"
      role="status"
    >
      <LottiePlayer
        src="/assets/captured/lottie/animacion_yape.json"
        renderer="canvas"
        loop={false}
        className="voucher-success-animation"
        preserveAspectRatio="xMidYMid slice"
      />
      <div className="voucher-content" ref={voucherCaptureRef}>
        <div className="voucher-share-capture">
          <div className="voucher-banner">
            <img
              src={`${APK_ASSET_ROOT}/images/${voucherHero}.webp`}
              alt=""
              className="voucher-banner-image"
            />
            <span className="voucher-logo-badge" aria-hidden="true">
              <LottiePlayer name="logo" className="voucher-logo-lottie" />
            </span>
          </div>
          <div className="voucher-card">
            <div className="voucher-card-headline">
              <h2>¡Yapeaste!</h2>
              <button
                type="button"
                className="voucher-share-button"
                aria-label="Compartir comprobante"
                data-share-ready={voucherShareFile ? "true" : "false"}
                onClick={shareConfiguredVoucher}
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
            <p className="voucher-recipient">{voucher.name}</p>
            <div className="voucher-datetime">
              <span>
                <img
                  src="/assets/captured/voucher/fecha-icon.svg"
                  alt=""
                  aria-hidden="true"
                />
                {formattedDate}
              </span>
              <i aria-hidden="true">|</i>
              <span>
                <img
                  src="/assets/captured/voucher/hora-icon.svg"
                  alt=""
                  aria-hidden="true"
                />
                {formattedTime}
              </span>
            </div>
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
              {isYapeDestination(voucher.destination) ? (
                <div>
                  <span>Nro. de celular</span>
                  <strong>{maskPhone(voucher.phone)}</strong>
                </div>
              ) : null}
              <div>
                <span>Destino</span>
                <strong>{voucher.destination}</strong>
              </div>
              <div>
                <span>Nro. de operación</span>
                <strong>{voucher.operation}</strong>
              </div>
            </div>
            <span className="voucher-validity-label"></span>
          </div>
        </div>

        <div className="voucher-more-section">
          <h3>
            Más en Yape <small className="voucher-new-badge">Nuevo</small>
          </h3>
          <VoucherSinglePromo />
        </div>
      </div>
      <button
        type="button"
        className="voucher-close-button"
        aria-label="Volver a editar voucher"
        onClick={onEdit}
      >
        <img
          src="/assets/captured/voucher/equis1.svg"
          alt=""
          aria-hidden="true"
        />
      </button>
      {shareNotice ? (
        <p className="inline-notice voucher-notice" role="status">
          {shareNotice}
        </p>
      ) : null}
    </section>
  );
}

function VoucherEditorView() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [destination, setDestination] = useState("Yape");
  const [message, setMessage] = useState("");
  const [manualDate, setManualDate] = useState(false);
  const [date, setDate] = useState(() => getLocalInputDate());
  const [time, setTime] = useState(() => getLocalInputTime());
  const [amount, setAmount] = useState("");
  const [manualOperation, setManualOperation] = useState(false);
  const [operation, setOperation] = useState(() => createVoucherOperation());
  const [preview, setPreview] = useState<VoucherEditorPreview | null>(null);

  const amountValue = Number(amount);
  const canPreview =
    name.trim().length >= 3 &&
    phone.length === 9 &&
    amountValue > 0 &&
    amountValue <= 500 &&
    operation.trim().length >= 3;

  function preparePreview(mode: "yape" | "bank") {
    if (!canPreview) return;
    const now = new Date();
    const selectedDestination =
      mode === "bank" && destination === "Yape" ? "BCP" : destination;
    setPreview({
      name: name.trim(),
      phone,
      destination: selectedDestination,
      message: message.trim(),
      amount: amountValue.toFixed(2),
      date: manualDate ? date : getLocalInputDate(now),
      time: manualDate ? time : getLocalInputTime(now),
      operation: operation.trim(),
    });
  }

  if (preview)
    return (
      <ConfiguredVoucherReceipt
        voucher={preview}
        onEdit={() => setPreview(null)}
      />
    );

  return (
    <div className="voucher-editor-screen">
      <header className="voucher-editor-topbar">
        <Link href="/datos-cuenta" aria-label="Volver a Mis datos">
          <AssetIcon name="ic_arrow_left_yape" />
        </Link>
        <div>
          <small>COMPROBANTES</small>
          <strong>Editar voucher</strong>
        </div>
        <span className="voucher-editor-top-icon">
          <AssetIcon name="ic_receipt_primary" />
        </span>
      </header>

      <section className="voucher-editor-intro">
        <span>EDITOR DE VOUCHER</span>
        <h1>Yapear a</h1>
        <p>
          Completa los datos para preparar y revisar tu voucher antes de
          guardarlo.
        </p>
      </section>

      <form
        className="voucher-editor-form"
        onSubmit={(event) => event.preventDefault()}
      >
        <section className="voucher-editor-card voucher-editor-recipient-card">
          <div className="voucher-editor-section-heading">
            <span>01</span>
            <div>
              <strong>Destinatario</strong>
              <small>Datos de la persona o entidad</small>
            </div>
          </div>
          <label className="voucher-editor-field">
            <span>Nombre y apellido</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 60))}
              placeholder="Nombre y Apellido"
              autoComplete="name"
            />
          </label>
          <div className="voucher-editor-field-grid">
            <label className="voucher-editor-field">
              <span>Número de celular</span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(event) =>
                  setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))
                }
                placeholder="999999999"
                autoComplete="tel"
              />
            </label>
            <label className="voucher-editor-field">
              <span>Destino</span>
              <select
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                {voucherDestinations.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="voucher-editor-field">
            <span>Mensaje</span>
            <input
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 80))}
              placeholder="Agregar mensaje (opcional)"
            />
          </label>
        </section>

        <section className="voucher-editor-card voucher-editor-date-card">
          <div className="voucher-editor-section-heading">
            <span>02</span>
            <div>
              <strong>Fecha y hora</strong>
              <small>Usaremos el momento actual por defecto</small>
            </div>
          </div>
          <label className="voucher-editor-check">
            <input
              type="checkbox"
              checked={manualDate}
              onChange={(event) => setManualDate(event.target.checked)}
            />
            <span>
              <strong>Elegir fecha y hora manualmente</strong>
              <small>Actívalo para personalizar ambos datos</small>
            </span>
          </label>
          {manualDate ? (
            <div className="voucher-editor-field-grid voucher-editor-manual-date">
              <label className="voucher-editor-field">
                <span>Fecha</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </label>
              <label className="voucher-editor-field">
                <span>Hora</span>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="voucher-editor-card voucher-editor-amount-card">
          <div className="voucher-editor-section-heading">
            <span>03</span>
            <div>
              <strong>Monto</strong>
              <small>Importe que aparecerá en la vista previa</small>
            </div>
          </div>
          <label className="voucher-editor-amount">
            <span>S/</span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="500"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0"
              aria-label="Monto del voucher"
            />
          </label>
          <p>Puedes ingresar hasta S/500.</p>
        </section>

        <section className="voucher-editor-card voucher-editor-operation-card">
          <div className="voucher-editor-section-heading">
            <span>04</span>
            <div>
              <strong>Número de operación</strong>
              <small>Generado automáticamente y editable</small>
            </div>
          </div>
          <label className="voucher-editor-check">
            <input
              type="checkbox"
              checked={manualOperation}
              onChange={(event) => setManualOperation(event.target.checked)}
            />
            <span>
              <strong>Ingresar N.º de operación manualmente</strong>
              <small>El código de seguridad usará los 3 últimos dígitos</small>
            </span>
          </label>
          <div className="voucher-editor-operation-row">
            <input
              inputMode="numeric"
              value={operation}
              onChange={(event) =>
                setOperation(event.target.value.replace(/\D/g, "").slice(0, 16))
              }
              readOnly={!manualOperation}
              placeholder="01XXXXXX"
              aria-label="Número de operación"
            />
            <button
              type="button"
              onClick={() => setOperation(createVoucherOperation())}
            >
              Regenerar
            </button>
          </div>
        </section>

        <div className="voucher-editor-actions">
          <button
            type="button"
            className="voucher-editor-bank-button"
            disabled={!canPreview}
            onClick={() => preparePreview("bank")}
          >
            Otros bancos
          </button>
          <button
            type="button"
            className="voucher-editor-yape-button"
            disabled={!canPreview}
            onClick={() => preparePreview("yape")}
          >
            Yapear
          </button>
        </div>
      </form>
    </div>
  );
}

type AccountDetailsUser = {
  username: string;
  displayName: string;
  sellerCode: string;
  telegramUserId: string | null;
  referralCode: string | null;
  credits: number;
};

type SmsAccountSettings = {
  enabled: boolean;
  displayName: string;
  credits: number;
};

function AccountDetailsView() {
  const [user, setUser] = useState<AccountDetailsUser | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceInput, setBalanceInput] = useState("");
  const [editingBalance, setEditingBalance] = useState(false);
  const [savingBalance, setSavingBalance] = useState(false);
  const [balanceMessage, setBalanceMessage] = useState("");
  const [homeAds, setHomeAds] = useState(true);
  const [smsSettings, setSmsSettings] = useState<SmsAccountSettings>({
    enabled: false,
    displayName: "",
    credits: 0,
  });
  const [autocomplete, setAutocomplete] = useState(false);
  const [smsToken, setSmsToken] = useState("");
  const [autoToken, setAutoToken] = useState("");
  const [autoValidated, setAutoValidated] = useState(false);
  const [autoCredits, setAutoCredits] = useState<number | null>(null);
  const [validatingToken, setValidatingToken] = useState<"auto" | null>(null);
  const [savingSms, setSavingSms] = useState(false);
  const [smsTokenMessage, setSmsTokenMessage] = useState("");
  const [autoTokenMessage, setAutoTokenMessage] = useState("");
  const [showCredentials, setShowCredentials] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [notice, setNotice] = useState("");
  const clearHistoryDialogRef = useModalLayer<HTMLElement>(
    clearConfirmation,
    () => setClearConfirmation(false),
  );

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((result) => {
      if (cancelled || !result.ok || !result.user) return;
      const sessionUser = result.user as AccountDetailsUser;
      setUser(sessionUser);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountBalance().then((result) => {
      if (cancelled || !result.ok) return;
      setBalance(result.balance);
      setBalanceInput(formatAccountBalance(result.balance));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/tokens/validate", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data?.ok || cancelled) return;
        const entitlements = Array.isArray(data.entitlements)
          ? data.entitlements
          : [];
        const auto = entitlements.find(
          (entry: { kind?: string }) => entry.kind === "auto",
        );
        setAutocomplete(Boolean(auto?.enabled));
        setAutoValidated(Boolean(auto?.enabled));
        const autocompleteStatus = data.autocomplete as
          | { enabled?: boolean; credits?: number | null; keyClaimed?: boolean }
          | undefined;
        if (autocompleteStatus) {
          setAutocomplete(Boolean(autocompleteStatus.enabled));
          setAutoCredits(
            typeof autocompleteStatus.credits === "number"
              ? autocompleteStatus.credits
              : null,
          );
          setAutoValidated(Boolean(auto?.enabled || autocompleteStatus.enabled));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/sms", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data?.ok || cancelled) return;
        const sms = data.sms as Partial<SmsAccountSettings> | undefined;
        setSmsSettings({
          enabled: Boolean(sms?.enabled),
          displayName: typeof sms?.displayName === "string" ? sms.displayName : "",
          credits: typeof sms?.credits === "number" ? Math.max(0, sms.credits) : 0,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function requestClearHistory() {
    setClearConfirmation(true);
  }

  async function clearHistory() {
    if (clearingHistory) return;
    setClearingHistory(true);
    setNotice("");
    try {
      const response = await fetch("/api/account/movements", {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(safeApiMessage(data.error, "No pudimos borrar los yapeos."));
      window.localStorage.setItem(MOVEMENT_HISTORY_CLEARED_KEY, "1");
      window.dispatchEvent(new Event(HISTORY_CLEARED_EVENT));
      setClearConfirmation(false);
      setNotice(
        "El historial anterior fue ocultado. El registro de seguridad se conserva.",
      );
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? safeClientMessage(error, "No pudimos borrar los yapeos.")
          : "No pudimos borrar los yapeos.",
      );
      setClearConfirmation(false);
    } finally {
      setClearingHistory(false);
    }
  }

  async function validateAccountToken() {
    const token = autoToken.trim();
    if (!token) {
      setAutoTokenMessage("Ingresa un token antes de validarlo.");
      return;
    }

    setValidatingToken("auto");
    setAutoTokenMessage("");
    try {
      const response = await fetch("/api/account/tokens/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "auto", token }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(safeApiMessage(data?.error, "No pudimos validar el token."));

      setAutoValidated(true);
      setAutocomplete(true);
      setAutoCredits(
        typeof data?.credits === "number" ? data.credits : null,
      );
      setAutoTokenMessage("Token validado. Autocompletado activado.");
    } catch (error) {
      setAutoValidated(false);
      setAutocomplete(false);
      setAutoTokenMessage(
        safeClientMessage(error, "No pudimos validar el token."),
      );
    } finally {
      setValidatingToken(null);
    }
  }

  function updateSmsToken(value: string) {
    setSmsToken(value);
    setSmsTokenMessage("");
  }

  async function updateSmsSettings(patch: Partial<Pick<SmsAccountSettings, "enabled" | "displayName">>) {
    setSavingSms(true);
    setSmsTokenMessage("");
    try {
      const response = await fetch("/api/account/sms", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(safeApiMessage(data?.error, "No pudimos guardar los SMS."));
      const sms = data?.sms as Partial<SmsAccountSettings> | undefined;
      setSmsSettings({
        enabled: Boolean(sms?.enabled),
        displayName: typeof sms?.displayName === "string" ? sms.displayName : "",
        credits: typeof sms?.credits === "number" ? Math.max(0, sms.credits) : 0,
      });
      setSmsTokenMessage("Configuración SMS actualizada.");
    } catch (error) {
      setSmsTokenMessage(safeClientMessage(error, "No pudimos guardar los SMS."));
    } finally {
      setSavingSms(false);
    }
  }

  async function redeemSmsCredits() {
    const token = smsToken.trim();
    if (!token) {
      setSmsTokenMessage("Ingresa un token de créditos SMS.");
      return;
    }
    setSavingSms(true);
    setSmsTokenMessage("");
    try {
      const response = await fetch("/api/account/sms/credits/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(safeApiMessage(data?.error, "No pudimos canjear el token SMS."));
      const sms = data?.sms as Partial<SmsAccountSettings> | undefined;
      setSmsSettings({
        enabled: Boolean(sms?.enabled),
        displayName: typeof sms?.displayName === "string" ? sms.displayName : "",
        credits: typeof sms?.credits === "number" ? Math.max(0, sms.credits) : 0,
      });
      setSmsToken("");
      setSmsTokenMessage("Créditos SMS agregados. Configura tu nombre antes de enviar.");
    } catch (error) {
      setSmsTokenMessage(safeClientMessage(error, "No pudimos canjear el token SMS."));
    } finally {
      setSavingSms(false);
    }
  }

  function updateAutoToken(value: string) {
    setAutoToken(value);
    setAutoValidated(false);
    setAutocomplete(false);
    setAutoCredits(null);
    setAutoTokenMessage("");
  }

  function updateBalanceInput(value: string) {
    const normalized = normalizeAccountBalanceInput(value);
    setBalanceInput(normalized);
    const cents = parseAccountBalanceCents(normalized);
    setBalanceMessage(
      cents !== null && cents > MAX_ACCOUNT_BALANCE_CENTS
        ? "El saldo máximo es S/ 1,000,000.00."
        : "",
    );
  }

  async function saveBalance() {
    const balanceCents = parseAccountBalanceCents(balanceInput);
    if (balanceCents === null) {
      setBalanceMessage("Ingresa un saldo válido.");
      return;
    }
    if (balanceCents > MAX_ACCOUNT_BALANCE_CENTS) {
      setBalanceMessage("El saldo máximo es S/ 1,000,000.00.");
      return;
    }
    if (!isValidAccountBalanceCents(balanceCents)) {
      setBalanceMessage("Ingresa un saldo válido.");
      return;
    }

    setSavingBalance(true);
    setBalanceMessage("");
    try {
      const response = await fetch("/api/account/balance", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ balanceCents }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(safeApiMessage(data?.error, "No pudimos guardar el saldo."));
      const savedBalanceCents = Number(data.balanceCents);
      const savedBalance = isValidAccountBalanceCents(savedBalanceCents)
        ? savedBalanceCents / 100
        : Number(data.balance);
      if (!Number.isFinite(savedBalance)) {
        throw new Error("No pudimos leer el saldo guardado.");
      }
      clearBalanceCache();
      setBalance(savedBalance);
      setBalanceInput(formatAccountBalance(savedBalance));
      setEditingBalance(false);
      setBalanceMessage("Saldo actualizado correctamente.");
      window.setTimeout(() => setBalanceMessage(""), 3200);
    } catch (error) {
      setBalanceMessage(
        safeClientMessage(error, "No pudimos guardar el saldo."),
      );
    } finally {
      setSavingBalance(false);
    }
  }

  return (
    <div className="account-details-screen">
      <header className="account-details-topbar">
        <Link href="/datos-cuenta" aria-label="Volver a Mis datos">
          <AssetIcon name="ic_arrow_left_yape" />
        </Link>
        <div>
          <small>MIS DATOS</small>
          <strong>Datos de mi cuenta</strong>
        </div>
        <span className="account-details-lock">
          <AssetIcon name="ic_lock_r_yape" />
        </span>
      </header>

      <section className="account-details-hero">
        <div>
          <span>BIENVENIDO</span>
          <h1>{user?.displayName || "Tu cuenta Yape"}</h1>
          <p>Administra los datos y automatizaciones asociadas a tu cuenta.</p>
        </div>
        <span className="account-details-hero-icon">
          <AssetIcon name="ic_shield_check_r_yape" />
        </span>
      </section>

      <nav
        className="account-details-shortcuts"
        aria-label="Resumen y acciones de la cuenta"
      >
        <button
          className="account-balance-shortcut"
          type="button"
          onClick={() => {
            setBalanceInput(formatAccountBalance(balance ?? 0));
            setBalanceMessage("");
            setEditingBalance((current) => !current);
          }}
          aria-expanded={editingBalance}
        >
          <AssetIcon name="ic_money_bag_soles_outline_yape_primary" />
          <span>
            <strong>Saldo</strong>
            <small>{`S/ ${formatAccountBalance(balance ?? 0)}`}</small>
          </span>
        </button>
        <button type="button" onClick={requestClearHistory}>
          <AssetIcon name="ic_send_outline_yape_primary" />
          <span>
            <strong>Yapeos</strong>
            <small>Borrar historial</small>
          </span>
        </button>
        <button type="button" disabled aria-disabled="true">
          <AssetIcon name="ic_grid_r_yape" />
          <span>
            <strong>Servicios</strong>
            <small>Próximamente</small>
          </span>
        </button>
      </nav>

      {editingBalance ? (
        <section
          className="account-balance-editor"
          aria-labelledby="balance-editor-title"
        >
          <div className="account-balance-editor-heading">
            <span>
              <AssetIcon name="ic_money_bag_soles_outline_yape_primary" />
            </span>
            <div>
              <strong id="balance-editor-title">Editar saldo</strong>
              <small>Este monto aparecerá en el inicio de tu Yape.</small>
            </div>
          </div>
          <label>
            <span>Nuevo saldo</span>
            <div>
              <b>S/</b>
              <input
                value={balanceInput}
                onChange={(event) => updateBalanceInput(event.target.value)}
                inputMode="decimal"
                placeholder="0.00"
                autoFocus
                aria-label="Nuevo saldo"
              />
            </div>
          </label>
          {balanceMessage ? (
            <p className="account-balance-message" role="status">
              {balanceMessage}
            </p>
          ) : null}
          <div className="account-balance-actions">
            <button
              type="button"
              onClick={() => {
                setEditingBalance(false);
                setBalanceInput(formatAccountBalance(balance ?? 0));
                setBalanceMessage("");
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={saveBalance}
              disabled={savingBalance || !balanceInput}
            >
              {savingBalance ? "Guardando…" : "Guardar saldo"}
            </button>
          </div>
        </section>
      ) : balanceMessage ? (
        <p className="account-balance-saved" role="status">
          <AssetIcon name="ic_shield_check_r_yape" />
          {balanceMessage}
        </p>
      ) : null}

      <div className="account-details-form">
        <section className="account-details-block">
          <div className="account-details-block-title">
            <span>PERSONALIZACIÓN</span>
            <h2>Experiencia de la app</h2>
          </div>
          <article className="account-setting-row">
            <span className="account-setting-icon is-purple">
              <AssetIcon name="ic_star_outline_yape_primary" />
            </span>
            <span className="account-setting-copy">
              <strong>Anuncio Home</strong>
              <small>Muestra anuncios en la pantalla principal</small>
            </span>
            <SwitchControl
              checked={homeAds}
              onChange={setHomeAds}
              label="Mostrar anuncios en la pantalla principal"
            />
          </article>
        </section>

        <section className="account-details-block">
          <div className="account-details-block-title">
            <span>AUTOMATIZACIONES</span>
            <h2>Mensajes y constancias</h2>
          </div>
          <article className="account-setting-panel account-token-panel">
            <div className="account-setting-row">
              <span className="account-setting-icon is-teal">
                <AssetIcon name="ic_chat_outline_yape_primary" />
              </span>
              <span className="account-setting-copy">
                <strong>SMS activos</strong>
                <small>Envía una constancia al destinatario después de un yapeo</small>
              </span>
              <SwitchControl
                checked={smsSettings.enabled}
                onChange={(enabled) => void updateSmsSettings({
                  enabled,
                  displayName: smsSettings.displayName,
                })}
                label="Activar SMS"
                disabled={savingSms || smsSettings.credits <= 0 || smsSettings.displayName.trim().length < 2}
              />
            </div>
            {smsSettings.credits > 0 ? (
              <label className="account-details-field">
                <span>Nombre que aparecerá en el SMS</span>
                <div>
                  <AssetIcon name="ic_chat_outline_yape_primary" />
                  <input
                    aria-label="Nombre para SMS"
                    value={smsSettings.displayName}
                    onChange={(event) => setSmsSettings((current) => ({
                      ...current,
                      displayName: event.target.value.slice(0, 80),
                    }))}
                    placeholder="Ejemplo: Jhon Tas*"
                    minLength={2}
                    maxLength={80}
                    autoComplete="name"
                  />
                </div>
              </label>
            ) : null}
            {smsSettings.credits > 0 ? (
              <button
                className="account-token-validate"
                type="button"
                onClick={() => void updateSmsSettings({ displayName: smsSettings.displayName })}
                disabled={savingSms || smsSettings.displayName.trim().length < 2}
              >
                {savingSms ? "Guardando…" : "Guardar nombre"}
              </button>
            ) : null}
            <div className="account-token-entry">
              <label className="account-details-field">
                <span>{smsSettings.credits > 0 ? "Recargar con token" : "Activar con token"}</span>
                <div>
                  <AssetIcon name="ic_lock_outline_yape_primary" />
                  <input
                    aria-label="Token de créditos SMS"
                    value={smsToken}
                    onChange={(event) => updateSmsToken(event.target.value)}
                    placeholder="Ingresa el token de créditos"
                    autoComplete="off"
                  />
                </div>
              </label>
              <button
                className="account-token-validate"
                type="button"
                onClick={() => void redeemSmsCredits()}
                disabled={!smsToken.trim() || savingSms}
              >
                {savingSms ? "Canjeando…" : smsSettings.credits > 0 ? "Recargar" : "Activar"}
              </button>
            </div>
            <div className="account-token-status-row">
              <span
                className={`account-detail-pill${smsSettings.credits > 0 ? " is-validated" : ""}`}
              >
                <AssetIcon name="ic_chat_outline_yape_primary" />
                {smsSettings.credits} crédito{smsSettings.credits === 1 ? "" : "s"}
              </span>
              <small
                className={smsTokenMessage && !smsSettings.credits ? "is-error" : ""}
              >
                {smsTokenMessage ||
                  (smsSettings.credits > 0
                    ? smsSettings.displayName.trim().length >= 2
                      ? "El SMS se enviará solo mientras el interruptor esté activo."
                      : "Guarda el nombre que aparecerá antes de activar SMS."
                    : "Canjea un token para obtener créditos SMS.")}
              </small>
            </div>
          </article>

          <article className="account-setting-panel account-token-panel">
            <div className="account-setting-row">
              <span className="account-setting-icon is-amber">
                <AssetIcon name="ic_refresh_yape_on_primary" />
              </span>
              <span className="account-setting-copy">
                <strong>Autocompletado</strong>
                <small>Actívalo con una key de créditos vinculada a tu cuenta</small>
              </span>
              <SwitchControl
                checked={autocomplete}
                onChange={setAutocomplete}
                label="Activar autocompletado"
                disabled={!autoValidated}
              />
            </div>
            <div className="account-token-entry">
              <label className="account-details-field">
                <span>Key de autocompletado</span>
                <div>
                  <AssetIcon name="ic_lock_outline_yape_primary" />
                  <input
                    aria-label="Token de autocompletado"
                    value={autoToken}
                    onChange={(event) => updateAutoToken(event.target.value)}
                    placeholder="Ingresa el token"
                    autoComplete="off"
                  />
                </div>
              </label>
              <button
                className={`account-token-validate${autoValidated ? " is-valid" : ""}`}
                type="button"
                onClick={() => validateAccountToken()}
                disabled={!autoToken.trim() || validatingToken === "auto"}
              >
                {validatingToken === "auto"
                  ? "Validando…"
                  : autoValidated
                    ? "Validado"
                    : "Validar"}
              </button>
            </div>
            <div className="account-token-status-row">
              <span
                className={`account-detail-pill${autoValidated ? " is-validated" : ""}`}
              >
                <AssetIcon name="ic_clock_outline_yape" />
                {autoCredits === null
                  ? autoValidated
                    ? "Autocompletado activo"
                    : "Sin créditos"
                  : `${autoCredits} créditos`}
              </span>
              <small
                className={autoTokenMessage && !autoValidated ? "is-error" : ""}
              >
                {autoTokenMessage ||
                  (autoCredits === null
                    ? "El token maestro mantiene el acceso activo."
                    : `${autoCredits} créditos disponibles para esta cuenta.`)}
              </small>
            </div>
          </article>
        </section>

        <section className="account-details-block">
          <div className="account-details-block-title">
            <span>DATOS PRIVADOS</span>
            <h2>Mis credenciales</h2>
          </div>
          <article className="account-private-card">
            <div className="account-private-heading">
              <span>
                <AssetIcon name="ic_lockedpass_r_yape_primary" />
              </span>
              <div>
                <strong>Información protegida</strong>
                <small>Usuario, contraseña y seller ID</small>
              </div>
              <button
                type="button"
                onClick={() => setShowCredentials((current) => !current)}
              >
                {showCredentials ? "Ocultar" : "Ver datos"}
              </button>
            </div>
            {showCredentials ? (
              <div className="account-credentials-grid">
                <div>
                  <small>Usuario</small>
                  <strong>{user?.username || "Cargando…"}</strong>
                </div>
                <div>
                  <small>Seller ID</small>
                  <strong>{user?.sellerCode || "Cargando…"}</strong>
                </div>
                <div>
                  <small>ID de Telegram</small>
                  <strong>{user?.telegramUserId || "No vinculado"}</strong>
                </div>
                <div>
                  <small>Contraseña</small>
                  <strong>••••••</strong>
                  <Link href="/cambiar-contrasena">Cambiar</Link>
                </div>
              </div>
            ) : null}
            <p>
              <AssetIcon name="ic_info_outline_yape_primary" /> Por seguridad,
              tu contraseña nunca puede visualizarse.
            </p>
          </article>
        </section>

        {notice ? (
          <p className="account-details-notice" role="status">
            <AssetIcon name="ic_shield_check_r_yape" />
            {notice}
          </p>
        ) : null}
      </div>
      {clearConfirmation ? (
        <div
          className="account-clear-overlay"
          role="presentation"
          onClick={() => setClearConfirmation(false)}
        >
          <section
            ref={clearHistoryDialogRef}
            className="account-clear-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
          >
            <span>
              <AssetIcon name="ic_warning_outline_yape_primary" />
            </span>
            <h2 id="clear-history-title">¿Borrar todos los yapeos?</h2>
            <p>
              Se eliminarán todos los movimientos guardados en tu cuenta. Esta
              acción no se puede deshacer.
            </p>
            <div>
              <button
                type="button"
                onClick={() => setClearConfirmation(false)}
                disabled={clearingHistory}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void clearHistory()}
                disabled={clearingHistory}
              >
                {clearingHistory ? "Borrando…" : "Borrar todo"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function SwitchControl({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch-control${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span />
    </button>
  );
}

function HighAmountView() {
  return (
    <div className="settings-page high-amount-page">
      <InnerHeader
        title="Confirmación de yapeo alto"
        backHref="/perfil"
        compact
      />
    </div>
  );
}

function TransferAlertsView() {
  return (
    <div className="settings-page transfer-alerts-page">
      <InnerHeader
        title="Notificaciones por yapeo"
        backHref="/perfil"
        compact
      />
    </div>
  );
}

function LimitsView() {
  return (
    <div className="settings-page limits-page">
      <InnerHeader
        title="Límites transaccionales"
        backHref="/perfil"
        compact
      />
    </div>
  );
}

function HelpView() {
  const [notice, setNotice] = useState("");
  const [helpMovements, setHelpMovements] = useState<Movement[]>([]);
  const popular = [
    ["Reportar extorsión", "ic_warning_outline_yape_primary"],
    ["No veo un movimiento", "ic_send_outline_yape_primary"],
    ["Mi saldo no coincide", "ic_money_bag_soles_outline_yape_primary"],
    ["No me deja yapear", "ic_send_outline_yape_primary"],
  ] as const;

  useEffect(() => {
    let cancelled = false;
    void fetchStoredMovements()
      .then((result) => {
        if (!cancelled) setHelpMovements(result.movements.slice(0, 2));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="reference-help-view">
      <InnerHeader title="Centro de Ayuda" compact />
      <section className="help-reference-sheet">
        <div className="help-section-title">
          <h2>Ayuda con un movimiento</h2>
          <Link href="/movimientos">Ver todo</Link>
        </div>
        {helpMovements.length > 0 ? (
          <SimpleMovementList items={helpMovements} />
        ) : (
          <p className="empty-inline-state">Aún no tienes movimientos.</p>
        )}
        <h2>Contáctanos</h2>
        <a
          className="help-menu-row"
          href="/api/telegram/support?source=assistant"
        >
          <AssetIcon name="ic_chat_outline_yape_primary" />
          <span>Asistente virtual</span>
        </a>
        <h2>Lo más buscado</h2>
        {popular.map(([label, icon]) => (
          <button
            className="help-menu-row"
            type="button"
            key={label}
            onClick={() => setNotice(label)}
          >
            <AssetIcon name={icon} />
            <span>{label}</span>
          </button>
        ))}
        <h2>Resuelve otras dudas</h2>
        <button
          className="help-menu-row"
          type="button"
          onClick={() => setNotice("Tengo otra consulta")}
        >
          <AssetIcon name="ic_help_outline_yape_primary" />
          <span>Tengo otra consulta</span>
        </button>
        <button
          className="help-menu-row"
          type="button"
          onClick={() => setNotice("Libro de reclamaciones")}
        >
          <AssetIcon name="ic_document_outline_yape_primary" />
          <span>Libro de reclamaciones</span>
        </button>
        {notice ? (
          <p className="inline-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function BiometricView() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    tone: "info" | "error";
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("../lib/webauthn-client")
      .then(({ fetchWebAuthnStatus }) => fetchWebAuthnStatus())
      .then((isEnabled) => {
        if (!cancelled) setEnabled(isEnabled);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggleBiometric() {
    if (busy || loading) return;
    setBusy(true);
    setNotice(null);
    try {
      const { disablePlatformBiometric, registerPlatformBiometric } =
        await import("../lib/webauthn-client");
      if (enabled) {
        await disablePlatformBiometric();
        setEnabled(false);
        setNotice({
          text: "Biometría desactivada. Puedes seguir entrando con tu clave.",
          tone: "info",
        });
      } else {
        await registerPlatformBiometric();
        setEnabled(true);
        setNotice({
          text: "Biometría activada. Si no quieres usarla, sigue entrando con tu clave.",
          tone: "info",
        });
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? safeClientMessage(error, "No se pudo actualizar la biometría.")
          : "No se pudo actualizar la biometría.";
      setNotice({ text: message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reference-biometric-view">
      <InnerHeader title="Biometría digital" backHref="/perfil" compact />
      <section className="biometric-status">
        <AssetIllustration
          name="sp_shield_fingerprint_check"
          className="biometric-mark"
        />
        <h1>
          {loading
            ? "Cargando biometría…"
            : enabled
              ? "Tienes activa tu biometría digital en Yape"
              : "Biometría digital desactivada"}
        </h1>
        <p>
          Recuerda que también puedes entrar a Yape con tu clave de siempre,
          aunque no uses Face ID o huella.
        </p>
        {notice ? (
          <p className={`form-notice is-${notice.tone}`} role="status">
            {notice.text}
          </p>
        ) : null}
      </section>
      <div className="biometric-actions">
        <Link href="/inicio">Ir al inicio</Link>
        <button
          type="button"
          disabled={busy || loading}
          onClick={() => void toggleBiometric()}
        >
          {busy
            ? "Espera…"
            : enabled
              ? "Desactivar biometría digital"
              : "Activar biometría digital"}
        </button>
      </div>
    </div>
  );
}

function AddressesView() {
  return (
    <div className="reference-addresses-view">
      <InnerHeader title="Mis direcciones" backHref="/perfil" compact />
    </div>
  );
}

function OnlinePurchasesView() {
  return (
    <div className="reference-online-purchases-view">
      <InnerHeader
        title="Compras por internet"
        backHref="/perfil"
        compact
      />
    </div>
  );
}

function isLocalEditMode() {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_LOCAL_EDIT_MODE !== "true" ||
    typeof window === "undefined"
  )
    return false;

  return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
    window.location.hostname,
  );
}

function ScannerView() {
  return <QRCodeScanner />;
}

type ExpiredAccessReferral = {
  code: string | null;
  command: string | null;
  rewardDays: number;
  redemptionLimit: number;
  usedRedemptions: number;
  remainingRedemptions: number;
  groupUrl: string;
};

function AccessExpiredGate({ onResolved }: { onResolved: () => void }) {
  const [referral, setReferral] = useState<ExpiredAccessReferral | null>(null);
  const [referralLoaded, setReferralLoaded] = useState(false);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/referral", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.ok !== false) setReferral(data as ExpiredAccessReferral);
        setReferralLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setReferralLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function claimPermanentAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token.trim() || loading) return;
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/access/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(safeApiMessage(data?.error, "No pudimos activar la clave permanente."));
        return;
      }
      onResolved();
    } catch (error) {
      setMessage(safeClientMessage(error, "No pudimos activar la clave permanente."));
    } finally {
      setLoading(false);
    }
  }

  async function checkTelegramRedemption() {
    if (checking) return;
    setChecking(true);
    setMessage("");
    try {
      clearSessionCache();
      const result = await fetchSession({ force: true });
      if (result.ok) {
        const expiry = typeof result.user.accessExpiresAt === "string"
          ? result.user.accessExpiresAt
          : null;
        if (!expiry || Date.parse(expiry) > Date.now()) {
          onResolved();
          return;
        }
      }
      setMessage("Todavía no vemos un canje. Escribe el comando en el grupo y vuelve a comprobar.");
    } catch (error) {
      setMessage(safeClientMessage(error, "No pudimos comprobar el acceso."));
    } finally {
      setChecking(false);
    }
  }

  const remaining = referral?.remainingRedemptions ?? 3;
  return (
    <div className="access-expired-overlay" role="presentation">
      <section
        className="access-expired-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-expired-title"
        aria-describedby="access-expired-description"
      >
        <span className="access-expired-eyebrow">ACCESO REQUERIDO</span>
        <h2 id="access-expired-title">Tu prueba de 30 días terminó</h2>
        <p id="access-expired-description">
          Para continuar, activa un acceso permanente o utiliza <strong>/redeem</strong>.
          Este aviso no se puede cerrar.
        </p>

        <form className="access-expired-form" onSubmit={claimPermanentAccess}>
          <label htmlFor="expired-access-token">Clave permanente</label>
          <div className="access-expired-token-row">
            <input
              id="expired-access-token"
              value={token}
              onChange={(event) => setToken(event.target.value.toUpperCase())}
              placeholder="YAPE-XXXX-XXXX-XXXX"
              autoComplete="one-time-code"
              disabled={loading}
            />
            <button type="submit" disabled={!token.trim() || loading}>
              {loading ? "Validando…" : "Activar"}
            </button>
          </div>
        </form>

        <div className="access-expired-divider" aria-hidden="true"><span>o</span></div>

        <div className="access-expired-redeem">
          <h3>Usar /redeem</h3>
          {!referralLoaded ? (
            <p>Preparando tu código de acceso…</p>
          ) : !referral ? (
            <p>No pudimos cargar tu código. Vuelve a intentar en unos segundos.</p>
          ) : remaining > 0 && referral.command ? (
            <>
              <p>Comparte este comando en el grupo de Telegram:</p>
              <code>{referral.command}</code>
              <small>
                Te quedan {remaining} de {referral.redemptionLimit} canjes disponibles.
              </small>
              <button type="button" onClick={() => void checkTelegramRedemption()} disabled={checking}>
                {checking ? "Comprobando…" : "Ya hice /redeem, comprobar acceso"}
              </button>
              <a href={referral.groupUrl || "/api/telegram/group"}>Abrir grupo de Telegram</a>
            </>
          ) : (
            <p className="access-expired-limit">
              Ya agotaste los 3 canjes disponibles. Necesitas comprar el plan permanente.
            </p>
          )}
        </div>
        {message ? <p className="access-expired-message" role="alert">{message}</p> : null}
      </section>
    </div>
  );
}

export function BankApp({ view }: { view: BankView }) {
  const router = useRouter();
  // Keep the first render deterministic on the server and in the browser.
  // Browser-only state (local edit mode/sessionStorage) is resolved after
  // hydration so the protected shell cannot appear only on the client.
  const [authorized, setAuthorized] = useState(false);
  const [accessExpired, setAccessExpired] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    if (isLocalEditMode()) {
      setAccessExpired(false);
      setAuthorized(true);
      return;
    }

    let cancelled = false;
    setSessionError("");
    void fetchSession().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.transient) {
          setSessionError("No pudimos comprobar tu sesión por un problema de conexión. Vuelve a intentarlo sin perder tus datos.");
          return;
        }
        if (result.code === "ACCESS_EXPIRED") {
          // An expired subscription is not a logout. The PIN and credentials
          // have already authenticated the user, so keep the session alive and
          // render the non-dismissible access gate in the app shell.
          setAccessExpired(true);
          setOptimisticUnlock(true);
          setAuthorized(true);
          return;
        }
        setOptimisticUnlock(false);
        clearSessionCache();
        router.replace("/");
        return;
      }
      if (!result.user.unlocked) {
        setOptimisticUnlock(false);
        setAuthorized(false);
        router.replace("/");
        return;
      }
      const accessExpiresAt = typeof result.user.accessExpiresAt === "string"
        ? result.user.accessExpiresAt
        : null;
      setAccessExpired(
        Boolean(accessExpiresAt && Date.parse(accessExpiresAt) <= Date.now()),
      );
      setOptimisticUnlock(true);
      setAuthorized(true);
    });

    return () => {
      cancelled = true;
    };
  }, [router, sessionAttempt]);

  if (!authorized) {
    return (
      <main className="banking-stage">
        {sessionError ? (
          <section className="session-recovery" aria-live="polite">
            <p className="form-notice is-error" role="alert">{sessionError}</p>
            <button className="login-button" type="button" onClick={() => setSessionAttempt((value) => value + 1)}>
              REINTENTAR
            </button>
          </section>
        ) : null}
      </main>
    );
  }

  const entryAnimationClass =
    view === "profile"
      ? " profile-entry-animate"
      : view === "account-data"
        ? " account-data-entry-animate"
        : "";

  return (
    <main className="banking-stage">
      <section
        className={`mobile-bank-shell view-${view}${entryAnimationClass}`}
        aria-label={view === "home" ? "Inicio de Yape" : viewTitles[view]}
      >
        <div className="bank-scroll-area">
          {view === "home" ? <HomeView /> : null}
          {view === "movements" ? <MovementsView /> : null}
          {view === "transfer" ? <TransferView /> : null}
          {view === "qr" ? <QrView /> : null}
          {view === "personal-qr" ? <PersonalQrView /> : null}
          {view === "profile" ? <ProfileView /> : null}
          {view === "notifications" ? <NotificationsView /> : null}
          {view === "account-data" ? <AccountDataView /> : null}
          {view === "account-details" ? <AccountDetailsView /> : null}
          {view === "account-payment-data" ? <RecipientContactsView /> : null}
          {view === "voucher-editor" ? <VoucherEditorView /> : null}
          {view === "high-amount" ? <HighAmountView /> : null}
          {view === "limits" ? <LimitsView /> : null}
          {view === "transfer-alerts" ? <TransferAlertsView /> : null}
          {view === "help" ? <HelpView /> : null}
          {view === "biometric" ? <BiometricView /> : null}
          {view === "addresses" ? <AddressesView /> : null}
          {view === "online-purchases" ? <OnlinePurchasesView /> : null}
          {view === "scanner" ? <ScannerView /> : null}
        </div>
      </section>
      {accessExpired ? (
        <AccessExpiredGate
          onResolved={() => {
            clearSessionCache();
            setOptimisticUnlock(true);
            setAccessExpired(false);
            setSessionAttempt((value) => value + 1);
          }}
        />
      ) : null}
    </main>
  );
}
