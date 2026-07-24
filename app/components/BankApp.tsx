"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  buildPaymentQrPayload,
  parsePaymentQrPayload,
} from "../lib/payment-qr";
import {
  clearSessionCache,
  fetchSession,
  hasOptimisticUnlock,
  setOptimisticUnlock,
} from "../lib/session-cache";
import {
  clearBalanceCache,
  fetchAccountBalance,
} from "../lib/balance-cache";
import {
  APK_ASSET_ROOT,
  AssetIcon,
  AssetIllustration,
  LottiePlayer,
  Money,
} from "./bank/primitives";
import {
  buildVoucherShareText,
  createVoucherImage,
  formatVoucherAmount,
  formatVoucherDate,
  formatVoucherTime,
  getVoucherHero,
  MovementVoucher,
  shareVoucherImage,
  VoucherSinglePromo,
} from "./bank/MovementVoucher";
import { HomeView } from "./bank/HomeView";
import { contactInitials, maskPhone, TransferView } from "./bank/TransferView";
import type {
  BankView,
  Movement,
  MovementHistoryGroup,
  MovementHistoryItem,
  StoredAccountMovement,
} from "./bank/types";

export type { BankView } from "./bank/types";

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

export const movements: Movement[] = [
  {
    id: 1,
    name: "Roberto Hua*",
    detail: "*** *** 967",
    date: "19 jul. 2026 - 10:08 p. m.",
    amount: -1,
    initials: "RH",
    color: "violet",
  },
  {
    id: 2,
    name: "Mariela Qui*",
    detail: "*** *** 735",
    date: "19 jul. 2026 - 09:23 p. m.",
    amount: -1,
    initials: "MQ",
    color: "amber",
  },
  {
    id: 3,
    name: "Mariela Qui*",
    detail: "*** *** 735",
    date: "19 jul. 2026 - 09:17 p. m.",
    amount: -1,
    initials: "MQ",
    color: "blue",
  },
  {
    id: 4,
    name: "Juan Per*",
    detail: "*** *** 321",
    date: "19 jul. 2026 - 09:17 p. m.",
    amount: -1,
    initials: "JP",
    color: "green",
  },
  {
    id: 5,
    name: "",
    detail: "*** *** 430",
    date: "19 jul. 2026 - 09:16 p. m.",
    amount: -11,
    initials: "--",
    color: "violet",
  },
  {
    id: 6,
    name: "Mariela Qui*",
    detail: "*** *** 735",
    date: "19 jul. 2026 - 04:01 a. m.",
    amount: -1,
    initials: "MQ",
    color: "blue",
  },
  {
    id: 7,
    name: "Mariela Qui*",
    detail: "*** *** 735",
    date: "19 jul. 2026 - 04:01 a. m.",
    amount: -1,
    initials: "MQ",
    color: "amber",
  },
];

export const MOVEMENT_HISTORY_CLEARED_KEY = "yape-movement-history-cleared";
export const HISTORY_CLEARED_EVENT = "yape-history-cleared";

const movementHistoryGroups: MovementHistoryGroup[] = [
  {
    month: "Julio 2026",
    items: [
      {
        id: 101,
        name: "Mariela Qui*",
        detail: "*** *** 735",
        date: "19 jul. 2026 - 09:23 p. m.",
        displayDate: "19 jul. · 09:23 p. m.",
        amount: -1,
        amountLabel: "- S/ 1.00",
        initials: "MQ",
        color: "violet",
      },
      {
        id: 102,
        name: "Mariela Qui*",
        detail: "*** *** 735",
        date: "19 jul. 2026 - 09:17 p. m.",
        displayDate: "19 jul. · 09:17 p. m.",
        amount: -1,
        amountLabel: "- S/ 1.00",
        initials: "MQ",
        color: "amber",
      },
      {
        id: 103,
        name: "Juan Per*",
        detail: "*** *** 321",
        date: "19 jul. 2026 - 09:17 p. m.",
        displayDate: "19 jul. · 09:17 p. m.",
        amount: -1,
        amountLabel: "- S/ 1.00",
        initials: "JP",
        color: "blue",
      },
      {
        id: 104,
        name: "",
        detail: "*** *** 430",
        date: "19 jul. 2026 - 09:16 p. m.",
        displayDate: "19 jul. · 09:16 p. m.",
        amount: -11,
        amountLabel: "- S/ 11.00",
        initials: "--",
        color: "green",
      },
      {
        id: 105,
        name: "Mariela Qui*",
        detail: "*** *** 735",
        date: "19 jul. 2026 - 04:01 a. m.",
        displayDate: "19 jul. · 04:01 a. m.",
        amount: -1,
        amountLabel: "- S/ 1.00",
        initials: "MQ",
        color: "violet",
      },
      {
        id: 106,
        name: "Mariela Qui*",
        detail: "*** *** 735",
        date: "19 jul. 2026 - 04:01 a. m.",
        displayDate: "19 jul. · 04:01 a. m.",
        amount: -1,
        amountLabel: "- S/ 1.00",
        initials: "MQ",
        color: "blue",
      },
      {
        id: 107,
        name: "mike salvador",
        detail: "*** *** 574",
        date: "19 jul. 2026 - 04:00 a. m.",
        displayDate: "19 jul. · 04:00 a. m.",
        amount: -1,
        amountLabel: "- S/ 1.00",
        initials: "MS",
        color: "amber",
      },
      {
        id: 108,
        name: "Mariela Qui*",
        detail: "*** *** 735",
        date: "16 jul. 2026 - 11:17 a. m.",
        displayDate: "16 jul. · 11:17 a. m.",
        amount: 350,
        amountLabel: "S/ 350.00",
        initials: "MQ",
        color: "green",
      },
      {
        id: 109,
        name: "Luis Alb*",
        detail: "*** *** 967",
        date: "16 jul. 2026 - 11:16 a. m.",
        displayDate: "16 jul. · 11:16 a. m.",
        amount: -10,
        amountLabel: "- S/ 10.00",
        initials: "LA",
        color: "violet",
      },
      {
        id: 110,
        name: "Roberto Hua*",
        detail: "*** *** 967",
        date: "16 jul. 2026 - 11:16 a. m.",
        displayDate: "16 jul. · 11:16 a. m.",
        amount: -200,
        amountLabel: "- S/ 200.00",
        initials: "RH",
        color: "blue",
      },
      {
        id: 111,
        name: "Diego Mam*",
        detail: "*** *** 321",
        date: "16 jul. 2026 - 11:16 a. m.",
        displayDate: "16 jul. · 11:16 a. m.",
        amount: -20,
        amountLabel: "- S/ 20.00",
        initials: "DM",
        color: "amber",
      },
      {
        id: 112,
        name: "Adam Lop*",
        detail: "*** *** 430",
        date: "16 jul. 2026 - 11:13 a. m.",
        displayDate: "16 jul. · 11:13 a. m.",
        amount: -500,
        amountLabel: "- S/ 500.00",
        initials: "AL",
        color: "green",
      },
      {
        id: 113,
        name: "Vanessa Qui*",
        detail: "*** *** 735",
        date: "16 jul. 2026 - 11:05 a. m.",
        displayDate: "16 jul. · 11:05 a. m.",
        amount: -100,
        amountLabel: "- S/ 100.00",
        initials: "VQ",
        color: "violet",
      },
      {
        id: 114,
        name: "Vanessa Quispe",
        detail: "*** *** 736",
        date: "16 jul. 2026 - 11:04 a. m.",
        displayDate: "16 jul. · 11:04 a. m.",
        amount: -100,
        amountLabel: "- S/ 100.00",
        initials: "VQ",
        color: "blue",
      },
      {
        id: 115,
        name: "Mariela Qui*",
        detail: "*** *** 735",
        date: "13 jul. 2026 - 09:50 p. m.",
        displayDate: "13 jul. · 09:50 p. m.",
        amount: -200,
        amountLabel: "- S/ 200.00",
        initials: "MQ",
        color: "amber",
      },
      {
        id: 116,
        name: "Leydy San*",
        detail: "*** *** 574",
        date: "05 jul. 2026 - 10:26 p. m.",
        displayDate: "05 jul. · 10:26 p. m.",
        amount: -28,
        amountLabel: "- S/ 28.00",
        initials: "LS",
        color: "green",
      },
      {
        id: 117,
        name: "Lemon - Caterine Ca*",
        detail: "*** *** 693",
        date: "05 jul. 2026 - 10:12 p. m.",
        displayDate: "05 jul. · 10:12 p. m.",
        amount: -20,
        amountLabel: "- S/ 20.00",
        initials: "LC",
        color: "violet",
      },
    ],
  },
  {
    month: "Junio 2026",
    items: [
      {
        id: 118,
        name: "Anderson Mor*",
        detail: "*** *** 430",
        date: "26 jun. 2026 - 12:46 p. m.",
        displayDate: "26 jun. · 12:46 p. m.",
        amount: -150,
        amountLabel: "- S/ 150.00",
        initials: "AM",
        color: "blue",
      },
      {
        id: 119,
        name: "Leydy San*",
        detail: "*** *** 574",
        date: "08 jun. 2026 - 09:38 p. m.",
        displayDate: "08 jun. · 09:38 p. m.",
        amount: -18,
        amountLabel: "- S/ 18.00",
        initials: "LS",
        color: "amber",
      },
    ],
  },
  {
    month: "Mayo 2026",
    items: [
      {
        id: 120,
        name: "Leydy San*",
        detail: "*** *** 574",
        date: "30 may. 2026 - 07:38 p. m.",
        displayDate: "30 may. · 07:38 p. m.",
        amount: -10,
        amountLabel: "- S/ 10.00",
        initials: "LS",
        color: "green",
      },
    ],
  },
];

const movementColors: Movement["color"][] = [
  "violet",
  "amber",
  "blue",
  "green",
];

function storedMovementToHistoryItem(
  movement: StoredAccountMovement,
  index: number,
): MovementHistoryItem {
  const date = new Date(movement.createdAt);
  const validDate = !Number.isNaN(date.getTime());
  const fullDate = validDate
    ? `${formatVoucherDate(date)} - ${formatVoucherTime(date)}`
    : "Movimiento reciente";
  const shortDate = validDate
    ? `${new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short" }).format(date)} · ${formatVoucherTime(date)}`
    : "Movimiento reciente";
  const amount = -(movement.amountCents / 100);
  return {
    id: movement.id,
    name: movement.recipientName,
    detail: movement.recipientReference,
    date: fullDate,
    displayDate: shortDate,
    amount,
    amountLabel: `- S/ ${Math.abs(amount).toFixed(2)}`,
    initials: contactInitials(movement.recipientName) || "--",
    color: movementColors[index % movementColors.length],
    securityCode: movement.securityCode,
    operationNumber: movement.operationNumber,
    destination: movement.destination,
    createdAt: movement.createdAt,
  };
}

function groupStoredMovements(items: MovementHistoryItem[]) {
  const groups = new Map<string, MovementHistoryItem[]>();
  for (const item of items) {
    const date = item.createdAt ? new Date(item.createdAt) : null;
    const rawMonth =
      date && !Number.isNaN(date.getTime())
        ? new Intl.DateTimeFormat("es-PE", {
            month: "long",
            year: "numeric",
          }).format(date)
        : "Movimientos recientes";
    const month =
      rawMonth.charAt(0).toLocaleUpperCase("es-PE") + rawMonth.slice(1);
    groups.set(month, [...(groups.get(month) ?? []), item]);
  }
  return Array.from(groups, ([month, groupItems]) => ({
    month,
    items: groupItems,
  }));
}

function mergeMovementGroups(
  primary: MovementHistoryGroup[],
  legacy: MovementHistoryGroup[],
) {
  const groups = new Map<string, MovementHistoryItem[]>();
  for (const group of [...primary, ...legacy]) {
    groups.set(group.month, [
      ...(groups.get(group.month) ?? []),
      ...group.items,
    ]);
  }
  return Array.from(groups, ([month, items]) => ({ month, items }));
}

export async function fetchStoredMovements() {
  const response = await fetch("/api/account/movements", { cache: "no-store" });
  const data = (await response.json()) as {
    ok?: boolean;
    historyCleared?: boolean;
    movements?: StoredAccountMovement[];
    error?: string;
  };
  if (!response.ok || !data.ok || !Array.isArray(data.movements)) {
    throw new Error(data.error || "No pudimos cargar los movimientos.");
  }
  return {
    historyCleared: Boolean(data.historyCleared),
    movements: data.movements.map(storedMovementToHistoryItem),
  };
}

const viewTitles: Partial<Record<BankView, string>> = {
  movements: "Movimientos",
  transfer: "Yapear",
  services: "Yapear Servicios",
  recharge: "Recargar celular",
  qr: "Guardar QR",
  "personal-qr": "Mi QR personal",
  profile: "Mi perfil",
  notifications: "Notificaciones",
  "account-data": "Mis datos",
  "account-details": "Datos de mi cuenta",
  "voucher-editor": "Editar voucher",
  "high-amount": "Confirmación de yapeo alto",
  limits: "Límites transaccionales",
  "transfer-alerts": "Notificaciones por yapeo",
  "purchase-approval": "Aprobar compras",
  help: "Centro de ayuda",
  dollars: "Dólares",
  insurance: "SOAT",
  biometric: "Biometría digital",
  credits: "Créditos",
  addresses: "Mis direcciones",
  "online-purchases": "Compras por internet",
  scanner: "Escanear QR",
  "transport-recharge": "Recargar Transportes",
};

async function shareContent(
  payload: { title: string; text: string; url?: string },
  fallback?: () => void,
) {
  const textToCopy = [payload.text, payload.url].filter(Boolean).join("\n");
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function"
  ) {
    await navigator.share(payload);
    return "Listo para compartir.";
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(textToCopy);
    fallback?.();
    return "Copiado para compartir.";
  }
  fallback?.();
  return "Tu dispositivo no permite compartir desde el navegador.";
}

export function SimpleMovementList({
  items,
  onSelect,
}: {
  items: Movement[];
  onSelect?: (movement: Movement) => void;
}) {
  return (
    <div className="simple-movement-list">
      {items.map((movement) => {
        const content = (
          <>
            <span>
              <strong>{movement.name}</strong>
              <small>{movement.date}</small>
            </span>
            <Money value={movement.amount} />
          </>
        );

        return onSelect ? (
          <button
            className="simple-movement-item"
            type="button"
            key={movement.id}
            onClick={() => onSelect(movement)}
            aria-label={`Ver comprobante de ${movement.name}`}
          >
            {content}
          </button>
        ) : (
          <article className="simple-movement-item" key={movement.id}>
            {content}
          </article>
        );
      })}
    </div>
  );
}

function FullMovementsList({
  groups,
  onSelect,
}: {
  groups: MovementHistoryGroup[];
  onSelect: (movement: MovementHistoryItem) => void;
}) {
  return (
    <div className="reference-full-movements-list">
      {groups.map((group) => (
        <section className="reference-full-movement-group" key={group.month}>
          <h2 className="reference-full-movement-month">{group.month}</h2>
          {group.items.map((movement) => (
            <button
              className="reference-full-movement-item"
              type="button"
              key={movement.id}
              onClick={() => onSelect(movement)}
              aria-label={
                movement.name
                  ? `Ver movimiento de ${movement.name}`
                  : "Ver movimiento"
              }
            >
              <span className="reference-full-movement-info">
                <strong>{movement.name}</strong>
                <small>{movement.displayDate}</small>
              </span>
              <span
                className={
                  movement.amount < 0
                    ? "reference-full-movement-amount is-negative"
                    : "reference-full-movement-amount is-positive"
                }
              >
                {movement.amountLabel}
              </span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function InnerHeader({
  title,
  backHref = "/inicio",
  compact = false,
}: {
  title: string;
  backHref?: string;
  compact?: boolean;
}) {
  return (
    <header className={`inner-header${compact ? " is-compact" : ""}`}>
      <Link href={backHref} className="inner-back" aria-label="Volver">
        <AssetIcon name="ic_arrow_left_yape_on_primary" />
      </Link>
      <h1>{title}</h1>
      <span className="inner-header-spacer" aria-hidden="true" />
    </header>
  );
}

function MovementsView() {
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(
    null,
  );
  const [historyCleared, setHistoryCleared] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(MOVEMENT_HISTORY_CLEARED_KEY) === "1",
  );
  const [storedMovements, setStoredMovements] = useState<MovementHistoryItem[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    function refreshMovements() {
      void fetchStoredMovements()
        .then((result) => {
          if (cancelled) return;
          setHistoryCleared(result.historyCleared);
          setStoredMovements(result.movements);
          window.localStorage.setItem(
            MOVEMENT_HISTORY_CLEARED_KEY,
            result.historyCleared ? "1" : "0",
          );
        })
        .catch(() => undefined);
    }
    refreshMovements();
    window.addEventListener(HISTORY_CLEARED_EVENT, refreshMovements);
    return () => {
      cancelled = true;
      window.removeEventListener(HISTORY_CLEARED_EVENT, refreshMovements);
    };
  }, []);

  if (selectedMovement) {
    return (
      <MovementVoucher
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
      />
    );
  }

  const storedGroups = groupStoredMovements(storedMovements);
  const visibleGroups = historyCleared
    ? storedGroups
    : mergeMovementGroups(storedGroups, movementHistoryGroups);

  return (
    <div className="reference-movements-view">
      <header className="reference-movements-header">
        <Link
          href="/inicio"
          aria-label="Volver al inicio"
          className="reference-movements-back"
        >
          <AssetIcon name="ic_arrow_left_yape_on_primary" />
        </Link>
        <h1>Movimientos</h1>
        <span
          className="reference-movements-header-spacer"
          aria-hidden="true"
        />
      </header>
      {visibleGroups.length === 0 ? (
        <div className="cleared-movements-page">
          <AssetIcon name="ic_list_b_yape" />
          <strong>No tienes yapeos guardados</strong>
          <span>Los nuevos movimientos aparecerán aquí.</span>
        </div>
      ) : (
        <FullMovementsList
          groups={visibleGroups}
          onSelect={setSelectedMovement}
        />
      )}
    </div>
  );
}

function ServicesView() {
  const recommended = [
    ["Claro", "ic_claro_circle"],
    ["Bitel", "ic_bitel_circle"],
    ["Movistar", "ic_movistar_circle"],
    ["Cálidda", "ic_duotone_gas"],
  ] as const;

  return (
    <div className="reference-services-view">
      <section className="services-purple-hero">
        <InnerHeader title="Yapear Servicios" compact />
        <label className="services-search">
          <AssetIcon name="ic_search_companies_on_primary" />
          <input
            aria-label="Buscar una empresa"
            placeholder="Busca una empresa"
          />
        </label>
        <div className="services-chips" aria-label="Categorías">
          {["Luz", "Agua", "Transportes", "Telefonía e Internet"].map(
            (label) => (
              <button type="button" key={label}>
                {label}
              </button>
            ),
          )}
        </div>
      </section>
      <section className="services-reference-sheet">
        <article className="services-promo-note">
          <small>Nuevo</small>
          <p>
            ¡Gana hasta S/10,000! Yapea 1 servicio extra y aumenta tus chances.
          </p>
        </article>
        <h2>Te recomendamos yapear</h2>
        <div className="recommended-services">
          {recommended.map(([label, icon]) => (
            <button type="button" key={label}>
              <span className="service-icon">
                <AssetIcon name={icon} />
              </span>
              <strong>{label}</strong>
            </button>
          ))}
        </div>
        <h2>
          Tus servicios recientes <AssetIcon name="ic_info_solid_yape" />
        </h2>
        <div className="recent-services-list">
          <button type="button">
            <span className="recent-service-logo">
              <AssetIcon name="ic_entel_circle" />
            </span>
            <span>
              <strong>Entel</strong>
              <small>Servicio: Pago con número</small>
              <small>Teléfono: *** *** 000</small>
            </span>
            <AssetIcon name="ic_arrow_right_r_yape" />
          </button>
          <button type="button">
            <span className="recent-service-logo">
              <AssetIcon name="ic_document_outline_yape" />
            </span>
            <span>
              <strong>Servicio registrado</strong>
              <small>Servicio: Cuenta genérica</small>
              <small>Documento: ********</small>
            </span>
            <AssetIcon name="ic_arrow_right_r_yape" />
          </button>
        </div>
      </section>
    </div>
  );
}

function RechargeView() {
  return (
    <div className="reference-recharge-view">
      <section className="recharge-purple-hero">
        <InnerHeader title="Recargar celular" compact />
        <p>
          Recarga saldo a cualquier línea de celular para estar siempre
          conectados.
        </p>
        <div className="recharge-person-cards">
          <button type="button">
            <AssetIcon name="ic_smartphone_outline_yape" />
            <strong>Mi número</strong>
            <small>*** *** 000</small>
          </button>
          <button type="button">
            <AssetIcon name="ic_person_outline_yape" />
            <strong>Otra persona</strong>
            <small>Contacto nuevo</small>
          </button>
        </div>
      </section>
      <section className="recharge-reference-sheet">
        <h2>Últimos contactos recargados</h2>
        <div className="recharge-empty-state">
          <AssetIllustration name="sp_contact_list" />
          <p>Aquí verás tus contactos recargados en los últimos 30 días.</p>
        </div>
      </section>
    </div>
  );
}

type SavedQrContact = {
  id: string;
  holderName: string;
  phone: string | null;
  provider: string;
  recipientId: string | null;
  verified: boolean;
  createdAt: string;
};

const QR_CONTACT_PROVIDERS = [
  "Yape",
  "Plin",
  "BCP",
  "BBVA",
  "Interbank",
  "Scotiabank",
  "Bim",
  "Banco Falabella",
  "Banco Pichincha",
  "Dale!",
  "Izipay",
  "Agora / Oh!",
  "Tunki",
] as const;

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

function QrView() {
  const [contacts, setContacts] = useState<SavedQrContact[]>([]);
  const [holderName, setHolderName] = useState("");
  const [phone, setPhone] = useState("");
  const [provider, setProvider] =
    useState<(typeof QR_CONTACT_PROVIDERS)[number]>("Yape");
  const [qrPayload, setQrPayload] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [selectedFileName, setSelectedFileName] = useState("");
  const [decodeError, setDecodeError] = useState("");
  const [notice, setNotice] = useState("");
  const [modalMessage, setModalMessage] = useState("");
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<QrScannerControls | null>(null);
  const scanLockedRef = useRef(false);

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const response = await fetch("/api/qr-contacts", { cache: "no-store" });
      const data = (await response.json()) as {
        contacts?: SavedQrContact[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.contacts)) {
        throw new Error(data.error || "No pudimos cargar tus QR guardados.");
      }
      setContacts(data.contacts);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
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

  async function saveQrContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!qrPayload || holderName.trim().length < 2 || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const response = await fetch("/api/qr-contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          holderName: holderName.trim(),
          phone,
          provider,
          payload: qrPayload,
        }),
      });
      const data = (await response.json()) as {
        contact?: SavedQrContact;
        error?: string;
      };
      if (!response.ok || !data.contact)
        throw new Error(data.error || "No pudimos guardar el QR.");
      setHolderName("");
      setPhone("");
      setProvider("Yape");
      clearCapture();
      setModalMessage(
        `El QR de ${data.contact.holderName} quedó guardado en Yape.`,
      );
      await loadContacts();
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "No pudimos guardar el QR.",
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
        `/api/qr-contacts/${encodeURIComponent(contact.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(data.error || "No pudimos eliminar el QR.");
      setContacts((current) =>
        current.filter((item) => item.id !== contact.id),
      );
      setNotice("QR eliminado.");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "No pudimos eliminar el QR.",
      );
    }
  }

  const canSave = Boolean(
    qrPayload && holderName.trim().length >= 2 && !saving,
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
            <h1 className="qrc-header-title">Guardar QR</h1>
            <p className="qrc-header-sub">Sube una imagen con código QR</p>
          </div>
        </div>
      </header>

      <form className="qrc-card" onSubmit={saveQrContact}>
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
          <span className="qrc-label">Nombre del titular</span>
          <input
            className="qrc-input"
            value={holderName}
            onChange={(event) => setHolderName(event.target.value.slice(0, 80))}
            placeholder="Ej: Juan Pérez"
            autoComplete="name"
            required
            minLength={2}
          />
        </label>
        <label className="qrc-field">
          <span className="qrc-label">
            Número de celular <small className="qrc-optional">(Opcional)</small>
          </span>
          <input
            className="qrc-input"
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(event) =>
              setPhone(event.target.value.replace(/\D/g, "").slice(0, 9))
            }
            placeholder="9XXXXXXXX"
            autoComplete="tel"
          />
        </label>
        <label className="qrc-field">
          <span className="qrc-label">App / Banco de destino</span>
          <span className="qrc-select-wrap">
            <select
              className="qrc-select"
              value={provider}
              onChange={(event) =>
                setProvider(
                  event.target.value as (typeof QR_CONTACT_PROVIDERS)[number],
                )
              }
            >
              {QR_CONTACT_PROVIDERS.map((item) => (
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
          {saving ? "Guardando..." : "Guardar QR"}
        </button>
        {notice ? (
          <p className="qrc-notice" role="status">
            {notice}
          </p>
        ) : null}
      </form>

      <section className="qrc-saved-section" aria-labelledby="saved-qr-title">
        <div className="qrc-saved-heading">
          <h2 id="saved-qr-title">Tus QR guardados</h2>
          <span>{contacts.length}/50</span>
        </div>
        {loadingContacts ? (
          <p className="qrc-empty">Cargando tus QR...</p>
        ) : null}
        {!loadingContacts && contacts.length === 0 ? (
          <p className="qrc-empty">Los QR que guardes aparecerán aquí.</p>
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
          className="qrc-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="QR guardado"
        >
          <div className="qrc-modal">
            <span className="qrc-modal-icon">
              <AssetIcon name="ic_qrcode_r_yape_on_primary" />
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
    </div>
  );
}

function PersonalQrView() {
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
      if (!id || !displayName) {
        setNotice("No pudimos preparar tu QR.");
        return;
      }
      if (role !== "client") {
        setNotice("El QR de cobro está disponible para cuentas de cliente.");
        return;
      }
      try {
        const payload = buildPaymentQrPayload(id);
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
              ? error.message
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

function ProfileMenuItem({
  icon,
  animatedIcon,
  label,
  href,
  badge,
  onClick,
}: {
  icon?: string;
  animatedIcon?: string;
  label: string;
  href?: string;
  badge?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="profile-row-icon">
        {animatedIcon ? (
          <LottiePlayer
            name={animatedIcon}
            className="profile-row-lottie"
            loop
            autoplay
          />
        ) : icon ? (
          <AssetIcon name={icon} />
        ) : null}
      </span>
      <strong>{label}</strong>
      {badge ? <small className="profile-row-badge">{badge}</small> : null}
    </>
  );
  return href ? (
    <Link className="profile-menu-row" href={href}>
      {content}
    </Link>
  ) : (
    <button className="profile-menu-row" type="button" onClick={onClick}>
      {content}
    </button>
  );
}

function ProfileView() {
  const router = useRouter();

  async function logout() {
    clearSessionCache();
    setOptimisticUnlock(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  return (
    <div className="reference-profile">
      <div className="profile-safe-strip" />
      <header className="profile-heading">
        <Link
          href="/inicio"
          className="profile-back"
          aria-label="Volver al inicio"
        >
          <AssetIcon name="ic_arrow_left_yape" />
        </Link>
        <div>
          <h1>Mi Perfil</h1>
        </div>
        <Link className="profile-help-link" href="/ayuda">
          <AssetIcon name="ic_headphone_outline_yape" />
          <span>Ayuda</span>
        </Link>
      </header>

      <section className="profile-menu-section">
        <h2>Mi cuenta</h2>
        <ProfileMenuItem
          icon="ic_dni_outline_yape_primary"
          label="Mis datos"
          href="/datos-cuenta"
        />
        <ProfileMenuItem
          icon="ic_qrcode_r_yape_primary"
          label="Mi QR"
          href="/mi-qr"
        />
        <ProfileMenuItem
          icon="ic_location_r_yape_primary"
          label="Mis direcciones"
          href="/direcciones"
        />
        <ProfileMenuItem
          icon="ic_broken_heart_outline_yape_primary"
          label="Eliminar mi cuenta"
          onClick={() => {}}
        />
      </section>

      <section className="profile-menu-section profile-settings-section">
        <h2>Ajustes</h2>
        <ProfileMenuItem
          icon="ic_lock_outline_yape_primary"
          label="Biometría digital"
          href="/biometria"
        />
        <ProfileMenuItem
          icon="ic_credit_card_outline_yape_primary"
          label="Compras por internet y POS"
          href="/compras-internet"
        />
        <ProfileMenuItem
          icon="ic_info_outline_yape_primary"
          label="Confirmación de yapeo alto"
          href="/confirmacion-montos"
        />
        <ProfileMenuItem
          icon="ic_bar_chart_outline_yape_primary"
          label="Límites Transaccionales"
          href="/limites-transaccionales"
        />
        <ProfileMenuItem
          icon="ic_bell_r_yape_primary"
          label="Notificaciones por yapeo"
          href="/notificaciones-transferencias"
        />
      </section>

      <footer className="profile-footer">
        <p>
          <strong>Versión Yape:</strong> 3.66.1
        </p>
        <p>
          <strong>Tipo de cuenta:</strong> Yape con BCP
        </p>
        <p>
          <strong>Banco de Crédito del Perú</strong>
        </p>
        <p>
          <strong>RUC:</strong> 20100047218
        </p>
        <button type="button">
          <AssetIcon name="ic_document_outline_yape_primary" />
          Términos y condiciones
        </button>
        <button type="button">
          <AssetIcon name="ic_lock_outline_yape_primary" />
          Política de privacidad
        </button>
        <button type="button" onClick={logout}>
          <AssetIcon name="ic_sign_out_r_yape_primary" />
          Cerrar sesión
        </button>
      </footer>
    </div>
  );
}

function NotificationsView() {
  return (
    <div className="notifications-view">
      <InnerHeader title="Notificaciones" compact />
      <section className="notification-group">
        <h2>Yape para ti</h2>
        <article>
          <AssetIllustration name="sp_fullcolor_bell_disable" />
          <div>
            <strong>Aún no tenemos novedades para ti.</strong>
          </div>
        </article>
      </section>
      <section className="notification-group">
        <h2>Consejos</h2>
        <article>
          <AssetIcon name="ic_eye_r_yape_primary" />
          <div>
            <strong>Ordena mejor tu dinero</strong>
            <span>¡Descubre cómo hacerlo!</span>
          </div>
        </article>
      </section>
      <section className="notification-group">
        <h2>Comunicados</h2>
        <article>
          <AssetIcon name="ic_star_outline_yape_primary" />
          <div>
            <strong>Conoce Buen Provecho</strong>
            <span>Historias con sazón aquí</span>
          </div>
        </article>
      </section>
    </div>
  );
}

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
  monthlyLimit: number;
  usedThisMonth: number;
  remainingThisMonth: number;
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
    try {
      await navigator.clipboard.writeText(value);
      setReferralNotice(message);
    } catch {
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
        throw new Error(data?.error || "No pudimos validar el token.");
      setUser((current) =>
        current ? { ...current, accessExpiresAt: null } : current,
      );
      setAccessToken("");
      setAccessMessage(
        String(data.message || "Tu acceso ahora es permanente."),
      );
    } catch (error) {
      setAccessMessage(
        error instanceof Error ? error.message : "No pudimos validar el token.",
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
                  : `${accessDays} ${accessDays === 1 ? "día restante" : "días restantes"}`}
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
            <span className="account-referral-icon">+3</span>
            <div>
              <span>PROGRAMA DE INVITACIONES</span>
              <h2 id="account-referral-title">Gana días con tu código</h2>
            </div>
            <strong>
              {referral
                ? `${referral.remainingThisMonth}/${referral.monthlyLimit}`
                : "—"}
            </strong>
          </header>
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
              <strong>{referral?.usedThisMonth ?? 0}</strong> canjes usados este
              mes
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
  const amountValue = Number(voucher.amount);
  const voucherHero = getVoucherHero(amountValue);
  const voucherDate = new Date(`${voucher.date}T${voucher.time || "00:00"}:00`);
  const validVoucherDate = Number.isNaN(voucherDate.getTime())
    ? new Date()
    : voucherDate;
  const formattedDate = formatVoucherDate(validVoucherDate);
  const formattedTime = formatVoucherTime(validVoucherDate);
  const securityCode = voucher.operation.slice(-3).padStart(3, "0");

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
      const result = await shareVoucherImage(voucherShareFile, {
        title: "Comprobante de yapeo",
        text: buildVoucherShareText({
          title: "¡Yapeaste!",
          amount: formatVoucherAmount(amountValue),
          recipient: voucher.name,
          date: formattedDate,
          time: formattedTime,
          securityCode,
          phone: maskPhone(voucher.phone),
          destination: voucher.destination,
          operation: voucher.operation,
        }),
      });
      setShareNotice(result);
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
                <strong>{maskPhone(voucher.phone)}</strong>
              </div>
              <div>
                <span>Destino</span>
                <strong>{voucher.destination}</strong>
              </div>
              <div>
                <span>Nro. de operación</span>
                <strong>{voucher.operation}</strong>
              </div>
            </div>
            <span className="voucher-validity-label">
              NO ES COMPROBANTE DE PAGO
            </span>
          </div>
        </div>

        <button
          type="button"
          className="voucher-new-yape-button"
          onClick={onEdit}
        >
          <AssetIcon name="ic_send_outline_yape_on_secondary" />
          Nuevo Yapeo
        </button>
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
  email: string;
  sellerCode: string;
  telegramUserId: string | null;
  referralCode: string | null;
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
  const [smsActive, setSmsActive] = useState(false);
  const [emailReceipts, setEmailReceipts] = useState(false);
  const [autocomplete, setAutocomplete] = useState(false);
  const [smsToken, setSmsToken] = useState("");
  const [autoToken, setAutoToken] = useState("");
  const [smsValidated, setSmsValidated] = useState(false);
  const [autoValidated, setAutoValidated] = useState(false);
  const [validatingToken, setValidatingToken] = useState<"sms" | "auto" | null>(
    null,
  );
  const [smsTokenMessage, setSmsTokenMessage] = useState("");
  const [autoTokenMessage, setAutoTokenMessage] = useState("");
  const [receiptEmail, setReceiptEmail] = useState("");
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [showCredentials, setShowCredentials] = useState(false);
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetchSession().then((result) => {
      if (cancelled || !result.ok || !result.user) return;
      const sessionUser = result.user as AccountDetailsUser;
      setUser(sessionUser);
      setReceiptEmail(sessionUser.email || "");
      setRecoveryEmail(sessionUser.email || "");
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
      setBalanceInput(result.balance.toFixed(2));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function registerData(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("Tus datos fueron revisados correctamente.");
    window.setTimeout(() => setNotice(""), 3200);
  }

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
        throw new Error(data.error || "No pudimos borrar los yapeos.");
      window.localStorage.setItem(MOVEMENT_HISTORY_CLEARED_KEY, "1");
      window.dispatchEvent(new Event(HISTORY_CLEARED_EVENT));
      setClearConfirmation(false);
      setNotice("Todos los yapeos guardados fueron eliminados.");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : "No pudimos borrar los yapeos.",
      );
      setClearConfirmation(false);
    } finally {
      setClearingHistory(false);
    }
  }

  async function validateAccountToken(kind: "sms" | "auto") {
    const token = (kind === "sms" ? smsToken : autoToken).trim();
    const setMessage =
      kind === "sms" ? setSmsTokenMessage : setAutoTokenMessage;
    if (!token) {
      setMessage("Ingresa un token antes de validarlo.");
      return;
    }

    setValidatingToken(kind);
    setMessage("");
    try {
      const response = await fetch("/api/account/tokens/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, token }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error || "No pudimos validar el token.");

      if (kind === "sms") {
        setSmsValidated(true);
        setSmsActive(true);
        setSmsTokenMessage("Token validado. SMS activado.");
      } else {
        setAutoValidated(true);
        setAutocomplete(true);
        setAutoTokenMessage("Token validado. Autocompletado activado.");
      }
    } catch (error) {
      if (kind === "sms") {
        setSmsValidated(false);
        setSmsActive(false);
      } else {
        setAutoValidated(false);
        setAutocomplete(false);
      }
      setMessage(
        error instanceof Error ? error.message : "No pudimos validar el token.",
      );
    } finally {
      setValidatingToken(null);
    }
  }

  function updateSmsToken(value: string) {
    setSmsToken(value);
    setSmsValidated(false);
    setSmsActive(false);
    setSmsTokenMessage("");
  }

  function updateAutoToken(value: string) {
    setAutoToken(value);
    setAutoValidated(false);
    setAutocomplete(false);
    setAutoTokenMessage("");
  }

  function updateBalanceInput(value: string) {
    const normalized = value.replace(",", ".").replace(/[^0-9.]/gu, "");
    const [integerPart = "", ...decimalParts] = normalized.split(".");
    const decimals = decimalParts.join("").slice(0, 2);
    setBalanceInput(
      decimalParts.length > 0 ? `${integerPart}.${decimals}` : integerPart,
    );
    setBalanceMessage("");
  }

  async function saveBalance() {
    const parsedBalance = Number(balanceInput);
    if (
      !Number.isFinite(parsedBalance) ||
      parsedBalance < 0 ||
      parsedBalance > 999_999_999.99
    ) {
      setBalanceMessage("Ingresa un saldo válido.");
      return;
    }

    const balanceCents = Math.round(parsedBalance * 100);
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
        throw new Error(data?.error || "No pudimos guardar el saldo.");
      const savedBalance = Number(data.balance);
      clearBalanceCache();
      setBalance(savedBalance);
      setBalanceInput(savedBalance.toFixed(2));
      setEditingBalance(false);
      setBalanceMessage("Saldo actualizado correctamente.");
      window.setTimeout(() => setBalanceMessage(""), 3200);
    } catch (error) {
      setBalanceMessage(
        error instanceof Error ? error.message : "No pudimos guardar el saldo.",
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
            setBalanceInput(balance === null ? "" : balance.toFixed(2));
            setBalanceMessage("");
            setEditingBalance((current) => !current);
          }}
          aria-expanded={editingBalance}
        >
          <AssetIcon name="ic_money_bag_soles_outline_yape_primary" />
          <span>
            <strong>Saldo</strong>
            <small>{balance === null ? "" : `S/ ${balance.toFixed(2)}`}</small>
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
                setBalanceInput(balance === null ? "" : balance.toFixed(2));
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

      <form className="account-details-form" onSubmit={registerData}>
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
                <small>Valida el token para habilitar esta función</small>
              </span>
              <SwitchControl
                checked={smsActive}
                onChange={setSmsActive}
                label="Activar SMS"
                disabled={!smsValidated}
              />
            </div>
            <div className="account-token-entry">
              <label className="account-details-field">
                <span>Token SMS</span>
                <div>
                  <AssetIcon name="ic_lock_outline_yape_primary" />
                  <input
                    aria-label="Token SMS"
                    value={smsToken}
                    onChange={(event) => updateSmsToken(event.target.value)}
                    placeholder="Ingresa el token"
                    autoComplete="off"
                  />
                </div>
              </label>
              <button
                className={`account-token-validate${smsValidated ? " is-valid" : ""}`}
                type="button"
                onClick={() => validateAccountToken("sms")}
                disabled={!smsToken.trim() || validatingToken === "sms"}
              >
                {validatingToken === "sms"
                  ? "Validando…"
                  : smsValidated
                    ? "Validado"
                    : "Validar"}
              </button>
            </div>
            <div className="account-token-status-row">
              <span
                className={`account-detail-pill${smsValidated ? " is-validated" : ""}`}
              >
                {smsValidated ? "Token válido" : "0 disponibles"}
              </span>
              <small
                className={smsTokenMessage && !smsValidated ? "is-error" : ""}
              >
                {smsTokenMessage ||
                  "El interruptor se activará automáticamente."}
              </small>
            </div>
          </article>

          <article className="account-setting-panel">
            <div className="account-setting-row">
              <span className="account-setting-icon is-purple">
                <AssetIcon name="ic_mail_outline_yape_primary" />
              </span>
              <span className="account-setting-copy">
                <strong>Constancias a correo</strong>
                <small>Se desactiva tras cada yapeo</small>
              </span>
              <SwitchControl
                checked={emailReceipts}
                onChange={setEmailReceipts}
                label="Enviar constancias por correo"
              />
            </div>
            <label className="account-details-field">
              <span>Tu correo</span>
              <div>
                <AssetIcon name="ic_mail_outline_yape_primary" />
                <input
                  type="email"
                  value={receiptEmail}
                  onChange={(event) => setReceiptEmail(event.target.value)}
                  placeholder="correo@ejemplo.com"
                  disabled={!emailReceipts}
                />
              </div>
            </label>
          </article>

          <article className="account-setting-panel account-token-panel">
            <div className="account-setting-row">
              <span className="account-setting-icon is-amber">
                <AssetIcon name="ic_refresh_yape_on_primary" />
              </span>
              <span className="account-setting-copy">
                <strong>Autocompletado</strong>
                <small>Valida un token temporal para activarlo</small>
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
                <span>Token Auto</span>
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
                onClick={() => validateAccountToken("auto")}
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
                {autoValidated ? "Token válido" : "Caduca en 0 días"}
              </span>
              <small
                className={autoTokenMessage && !autoValidated ? "is-error" : ""}
              >
                {autoTokenMessage ||
                  "El interruptor se activará automáticamente."}
              </small>
            </div>
          </article>
        </section>

        <section className="account-details-block">
          <div className="account-details-block-title">
            <span>RECUPERACIÓN</span>
            <h2>Seguridad de acceso</h2>
          </div>
          <article className="account-setting-panel">
            <div className="account-setting-row">
              <span className="account-setting-icon is-teal">
                <AssetIcon name="ic_shield_outline_yape" />
              </span>
              <span className="account-setting-copy">
                <strong>Correo de recuperación</strong>
                <small>
                  Registra o cambia tu correo para recuperar tu contraseña
                </small>
              </span>
            </div>
            <label className="account-details-field">
              <span>Correo seguro</span>
              <div>
                <AssetIcon name="ic_mail_outline_yape_primary" />
                <input
                  type="email"
                  value={recoveryEmail}
                  onChange={(event) => setRecoveryEmail(event.target.value)}
                  placeholder="correo@ejemplo.com"
                />
              </div>
            </label>
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
        <button className="account-details-submit" type="submit">
          <AssetIcon name="ic_switch_check_r_yape" />
          Registrar datos
        </button>
      </form>
      {clearConfirmation ? (
        <div
          className="account-clear-overlay"
          role="presentation"
          onClick={() => setClearConfirmation(false)}
        >
          <section
            className="account-clear-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-history-title"
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
  const [enabled, setEnabled] = useState(true);
  const [amount, setAmount] = useState("500");

  return (
    <div className="settings-page high-amount-page">
      <section className="settings-purple-hero">
        <InnerHeader
          title="Confirmación de yapeo alto"
          backHref="/perfil"
          compact
        />
        <AssetIcon name="ic_info_outline_yape_on_primary" />
        <p>
          Elige desde qué monto quieres confirmar tus yapeos antes de enviarlos.
        </p>
      </section>
      <section className="settings-sheet">
        <div className="setting-toggle-row">
          <strong>Activar la confirmación</strong>
          <SwitchControl
            checked={enabled}
            onChange={setEnabled}
            label="Activar confirmación de montos altos"
          />
        </div>
        <label className="generic-amount-field">
          <span>Indica el monto alto</span>
          <div>
            <b>S/</b>
            <input
              value={amount}
              onChange={(event) =>
                setAmount(event.target.value.replace(/[^0-9.]/g, ""))
              }
              inputMode="decimal"
              disabled={!enabled}
            />
            <button
              type="button"
              onClick={() => setAmount("")}
              aria-label="Limpiar monto"
            >
              ×
            </button>
          </div>
          <small>Mínimo S/ 1 y máximo S/ 500</small>
        </label>
      </section>
    </div>
  );
}

function TransferAlertsView() {
  const [emailAlerts, setEmailAlerts] = useState(false);

  return (
    <div className="settings-page transfer-alerts-page">
      <InnerHeader
        title="Notificaciones por yapeo"
        backHref="/perfil"
        compact
      />
      <section className="simple-settings-body">
        <h2>YAPEOS</h2>
        <div className="setting-toggle-row detailed">
          <span>
            <strong>Recibir aviso por correo</strong>
            <small>
              Indica el monto desde el cual deseas recibir tus notificaciones.
            </small>
          </span>
          <SwitchControl
            checked={emailAlerts}
            onChange={setEmailAlerts}
            label="Recibir avisos por correo"
          />
        </div>
      </section>
    </div>
  );
}

function LimitsView() {
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState("1000");

  return (
    <div className="settings-page limits-page">
      <section className="limits-purple-hero">
        <InnerHeader
          title="Límites transaccionales"
          backHref="/perfil"
          compact
        />
        <AssetIcon name="ic_bar_chart_outline_yape_on_primary" />
        <p>Consulta y ajusta tus límites de yapeo.</p>
      </section>
      <section className="limits-sheet">
        <small>LÍMITE DIARIO DE ENVÍOS</small>
        <div className="limit-card">
          <span>
            <small>Límite configurado</small>
            <strong>S/ {Number(limit || 0).toFixed(2)}</strong>
          </span>
          <button
            type="button"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? "Cancelar" : "Editar límite"}
          </button>
        </div>
        {editing ? (
          <label className="generic-amount-field">
            <span>Nuevo límite diario</span>
            <div>
              <b>S/</b>
              <input
                value={limit}
                onChange={(event) =>
                  setLimit(event.target.value.replace(/[^0-9.]/g, ""))
                }
                inputMode="decimal"
              />
            </div>
          </label>
        ) : null}
        <div className="monthly-limit-card">
          <span>
            <small>Recibido durante el mes</small>
            <strong>S/ 320.00</strong>
          </span>
          <div>
            <i />
          </div>
          <p>32% de un máximo de S/ 1,000.00</p>
        </div>
      </section>
    </div>
  );
}

function PurchaseApprovalView() {
  return (
    <div className="purchase-approval-page">
      <section className="approval-purple-hero">
        <InnerHeader title="Aprobar compras" compact />
        <div>
          <p>Haz tus compras por internet de forma más clara y segura.</p>
          <AssetIcon name="ic_shopping_cart_outline_yape_on_primary" />
        </div>
      </section>
      <section className="approval-sheet">
        <h2>Solicitudes por aprobar</h2>
        <p>Ingresa a la solicitud pendiente para aprobarla.</p>
        <div className="empty-approval">
          <AssetIcon name="ic_info_outline_yape_primary" />
          No tienes solicitudes en este momento
        </div>
        <div className="fraud-warning">
          <AssetIcon name="ic_shield_check_r_yape" />
          <strong>Nunca compartas claves ni códigos reales.</strong>
        </div>
      </section>
    </div>
  );
}

function HelpView() {
  const [notice, setNotice] = useState("");
  const popular = [
    ["Reportar extorsión", "ic_warning_outline_yape_primary"],
    ["No veo un movimiento", "ic_send_outline_yape_primary"],
    ["Mi saldo no coincide", "ic_money_bag_soles_outline_yape_primary"],
    ["No me deja yapear", "ic_send_outline_yape_primary"],
  ] as const;

  return (
    <div className="reference-help-view">
      <InnerHeader title="Centro de Ayuda" compact />
      <section className="help-reference-sheet">
        <div className="help-section-title">
          <h2>Ayuda con un movimiento</h2>
          <Link href="/movimientos">Ver todo</Link>
        </div>
        <SimpleMovementList items={movements.slice(0, 2)} />
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

function DollarsView() {
  return (
    <div className="reference-dollars-view">
      <Link className="full-purple-close" href="/inicio" aria-label="Cerrar">
        <AssetIcon name="ic_close_yape_on_primary" />
      </Link>
      <AssetIllustration
        name="ic_exchange_dollars_onboarding"
        className="dollars-illustration"
      />
      <h1>Cambiar dólares con Yape es muy fácil</h1>
      <section className="dollar-benefits">
        <article>
          <AssetIcon name="ic_world_r_yape_on_primary" />
          <span>
            <strong>Dólares al toque</strong>
            <small>Cambia tus soles a dólares al instante y 100% seguro.</small>
          </span>
        </article>
        <article>
          <AssetIcon name="ic_shield_outline_yape_on_primary" />
          <span>
            <strong>100% confiable</strong>
            <small>
              Como una casa de cambio superconfiable que atiende 24/7.
            </small>
          </span>
        </article>
      </section>
      <div className="dollar-actions">
        <button type="button">Continuar</button>
        <Link href="/ayuda">Conoce más sobre cambiar dólares</Link>
      </div>
    </div>
  );
}

function InsuranceView() {
  const [quoted, setQuoted] = useState(false);

  function quote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuoted(true);
  }

  return (
    <div className="reference-insurance-view">
      <section className="insurance-purple-hero">
        <InnerHeader title="" compact />
        <AssetIcon
          name="ic_headphone_outline_yape_on_primary"
          className="insurance-help-icon"
        />
        <h1>
          ¡Ten tu SOAT hoy mismo!
          <br />
          desde S/ 47.00
        </h1>
        <p>Precios incluyen IGV</p>
        <form onSubmit={quote} className="insurance-quote-card">
          <h2>Cotízalo sin compromiso</h2>
          <label>
            <span>Nro. de placa</span>
            <input aria-label="Número de placa" required />
          </label>
          <button type="submit">Cotizar</button>
          <small>
            Con el respaldo de <AssetIcon name="ic_logo_pacifico" />
          </small>
        </form>
      </section>
      {quoted ? (
        <p className="insurance-result" role="status">
          <AssetIcon name="ic_shield_check_r_yape" />
          Cotización lista.
        </p>
      ) : null}
    </div>
  );
}

function BiometricView() {
  const [enabled, setEnabled] = useState(true);

  return (
    <div className="reference-biometric-view">
      <InnerHeader title="Biometría digital" backHref="/perfil" compact />
      <section className="biometric-status">
        <AssetIllustration
          name="sp_shield_fingerprint_check"
          className="biometric-mark"
        />
        <h1>
          {enabled
            ? "Tienes activa tu biometría digital en Yape"
            : "Biometría digital desactivada"}
        </h1>
        <p>
          Recuerda que también puedes entrar a Yape con tu clave de siempre.
        </p>
      </section>
      <div className="biometric-actions">
        <Link href="/inicio">Ir al inicio</Link>
        <button type="button" onClick={() => setEnabled((current) => !current)}>
          {enabled
            ? "Desactivar biometría digital"
            : "Activar biometría digital"}
        </button>
      </div>
    </div>
  );
}

function CreditsView() {
  const [notice, setNotice] = useState("");

  return (
    <div className="reference-credits-view">
      <section className="credits-purple-hero">
        <InnerHeader title="Créditos Yape" compact />
        <h1>Impulsa tu Historial Crediticio</h1>
        <p>
          Miles de yaperos ya construyen su futuro financiero con Yape. ¡Empieza
          hoy!
        </p>
      </section>
      <section className="credits-reference-sheet">
        <h2>
          Tenemos esto para ti <small>Por tiempo limitado</small>
        </h2>
        <h2>Resuelve tus dudas</h2>
        {[
          "¿Qué es un crédito?",
          "¿Qué necesito para solicitar un crédito?",
          "¿Cómo pago mi crédito Yape?",
        ].map((question) => (
          <button
            className="credit-question"
            type="button"
            key={question}
            onClick={() => setNotice(question)}
          >
            <span>{question}</span>
            <AssetIcon name="ic_arrow_right_r_yape" />
          </button>
        ))}
        {notice ? (
          <p className="inline-notice" role="status">
            {notice}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function AddressesView() {
  const [notice, setNotice] = useState("");

  return (
    <div className="reference-addresses-view">
      <InnerHeader title="Mis direcciones" backHref="/perfil" compact />
      <button
        className="new-address-row"
        type="button"
        onClick={() => setNotice("Nueva dirección")}
      >
        <AssetIcon name="ic_add_circle_solid_yape_secondary" />
        <span>Nueva dirección</span>
      </button>
      <section className="addresses-empty">
        <AssetIllustration name="sp_change_location" />
        <h2>Aún no nos has proporcionado ninguna dirección.</h2>
        <p>
          Agrega una dirección para brindarte la mejor experiencia de delivery.
        </p>
      </section>
      {notice ? (
        <p className="inline-notice addresses-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function OnlinePurchasesView() {
  const [enabled, setEnabled] = useState(true);

  return (
    <div className="reference-online-purchases-view">
      <section className="online-purchases-hero">
        <InnerHeader title="Compras por internet" backHref="/perfil" compact />
        <article className="generic-bank-card">
          <AssetIcon name="ic_bcp_logo" className="card-logo" />
          <AssetIcon name="bcp_card_tdc" className="card-symbol" />
          <small>Número de tarjeta</small>
          <strong>•••• •••• •••• 0000</strong>
        </article>
      </section>
      <section className="online-purchases-body">
        <div className="online-purchase-toggle">
          <span>
            <strong>Activar Compras por internet</strong>
            <p>
              Permite comprar en apps y páginas web, aplica a tu tarjeta
              afiliada y a las siguientes funcionalidades de Yape:
            </p>
          </span>
          <SwitchControl
            checked={enabled}
            onChange={setEnabled}
            label="Activar compras por internet"
          />
        </div>
        <ol>
          <li>Código de Aprobación</li>
          <li>Pago QR en Comercio electrónico</li>
        </ol>
      </section>
    </div>
  );
}

function ScannerView() {
  const router = useRouter();
  const [flashlight, setFlashlight] = useState(false);
  const [notice, setNotice] = useState("");
  const [uploadedImage, setUploadedImage] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<QrScannerControls | null>(null);
  const scanLockedRef = useRef(false);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream)
      stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  const acceptQrValue = useCallback(
    (rawValue: string) => {
      if (scanLockedRef.current) return;
      const recipientId = parsePaymentQrPayload(rawValue);
      if (!recipientId) {
        setNotice("El código no corresponde a un QR válido de Yape.");
        return;
      }

      scanLockedRef.current = true;
      setNotice("QR reconocido. Verificando destinatario...");
      controlsRef.current?.stop();
      router.push(`/transferir?recipient=${encodeURIComponent(recipientId)}`);
    },
    [router],
  );

  const startCamera = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setNotice(
        "La cámara no está disponible en este navegador. Puedes subir una imagen con QR.",
      );
      return;
    }

    try {
      stopCamera();
      const preview = videoRef.current;
      if (!preview) return;
      scanLockedRef.current = false;
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader() as QrCodeReader;
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        preview,
        (result) => {
          if (result) acceptQrValue(result.getText());
        },
      );
      controlsRef.current = controls;
      setCameraReady(true);
      setNotice("");
    } catch {
      setCameraReady(false);
      setNotice(
        "No se pudo abrir la cámara. Revisa el permiso o sube una imagen con QR.",
      );
    }
  }, [acceptQrValue, stopCamera]);

  async function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const nextPreview = URL.createObjectURL(file);
    setUploadedImage((current) => {
      if (current) URL.revokeObjectURL(current);
      return nextPreview;
    });
    setNotice(`Analizando ${file.name}...`);
    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader() as QrCodeReader;
      const result = await reader.decodeFromImageUrl(nextPreview);
      acceptQrValue(result.getText());
    } catch {
      setNotice("No encontramos un QR válido de Yape en esa imagen.");
    } finally {
      event.target.value = "";
    }
  }

  async function toggleFlashlight() {
    const nextValue = !flashlight;
    const stream = videoRef.current?.srcObject;
    const track =
      stream instanceof MediaStream ? stream.getVideoTracks()[0] : undefined;
    if (!track) {
      setFlashlight(nextValue);
      await startCamera();
      return;
    }

    const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
      torch?: boolean;
    };
    if (!capabilities.torch) {
      setNotice("La linterna física no está disponible en este dispositivo.");
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: nextValue }],
      } as unknown as MediaTrackConstraints);
      setFlashlight(nextValue);
    } catch {
      setNotice("No se pudo cambiar el estado de la linterna.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void startCamera();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  useEffect(() => {
    return () => {
      if (uploadedImage) URL.revokeObjectURL(uploadedImage);
    };
  }, [uploadedImage]);

  return (
    <div className={`reference-scanner-view${flashlight ? " is-lit" : ""}`}>
      <header>
        <span className="scanner-status-chip">LECTOR YAPE</span>
        <Link href="/inicio" aria-label="Cerrar escáner">
          <AssetIcon name="ic_close_scan" />
        </Link>
      </header>
      <div className="scanner-frame scanner-live-frame">
        <video
          ref={videoRef}
          className={`scanner-video${cameraReady ? " is-ready" : ""}`}
          muted
          playsInline
          autoPlay
          aria-label="Cámara para escanear QR"
        />
        {uploadedImage ? (
          <img
            className="scanner-upload-preview"
            src={uploadedImage}
            alt="Imagen QR seleccionada"
          />
        ) : null}
        <i />
        <p>Enfoca el código QR dentro del recuadro</p>
      </div>
      <input
        ref={fileInputRef}
        className="scanner-file-input"
        type="file"
        accept="image/*"
        onChange={handleUpload}
      />
      <div className="scanner-actions scanner-live-actions">
        <button type="button" onClick={() => void toggleFlashlight()}>
          <AssetIcon name="mb_ic_flash_on" />
          {flashlight ? "Apagar linterna" : "Encender linterna"}
        </button>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          <AssetIcon name="ic_add_photo_outline_yape" />
          Subir una imagen con QR
        </button>
      </div>
      {notice ? (
        <p className="scanner-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}

function TransportRechargeView() {
  const [cardNumber, setCardNumber] = useState("");

  return (
    <div className="reference-transport-view">
      <InnerHeader title="Buscar recibos de" />
      <div className="inner-content">
        <div className="transport-provider-heading">
          <span className="transport-provider-logo">
            <AssetIcon name="ic_duotone_bus" />
          </span>
          <strong>Metropolitano y Corredores</strong>
          <small>Recarga de Tarjetas</small>
        </div>
        <label className="transport-card-number-field">
          <span>Ingresar Número de Tarjeta</span>
          <input
            inputMode="numeric"
            value={cardNumber}
            onChange={(event) =>
              setCardNumber(event.target.value.replace(/\D/g, "").slice(0, 16))
            }
            placeholder="0000 0000 0000 0000"
          />
        </label>
        <div className="transport-info-card">
          <AssetIcon name="ic_info_solid_yape" />
          <div>
            <p>
              El número se encuentra en la parte inferior de la tarjeta.
              <br />
              Puedes recargar de 00:00 a 20:45 (mínimo S/1).
              <br />
              ¡Recuerda! Debes esperar 15 min. y activar tu recarga para usar tu
              saldo:
            </p>
            <ul>
              <li>
                <strong>Metropolitano:</strong> Activa tu saldo acercando tu
                tarjeta al tótem.
              </li>
              <li>
                <strong>Corredores:</strong> Acerca tu tarjeta al validador y
                espera que figure tu nuevo saldo.
              </li>
            </ul>
          </div>
        </div>
        <button
          type="button"
          className="transport-example-link"
          onClick={() => {}}
        >
          ¿No ubicas tu Número de Tarjeta? Ver ejemplo
        </button>
        <button
          className="transfer-primary-button transfer-full-width-button"
          type="button"
          disabled={cardNumber.length < 6}
        >
          Continuar
        </button>
      </div>
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

export function BankApp({ view }: { view: BankView }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(() =>
    isLocalEditMode() ? true : hasOptimisticUnlock(),
  );

  useEffect(() => {
    if (isLocalEditMode()) return;

    let cancelled = false;
    void fetchSession().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setOptimisticUnlock(false);
        clearSessionCache();
        if (result.code === "ACCESS_EXPIRED") {
          router.replace("/?reason=expired");
          return;
        }
        router.replace("/");
        return;
      }
      if (!result.user.unlocked) {
        setOptimisticUnlock(false);
        setAuthorized(false);
        router.replace("/");
        return;
      }
      setOptimisticUnlock(true);
      setAuthorized(true);
    });

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!authorized) return <main className="banking-stage" />;

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
          {view === "services" ? <ServicesView /> : null}
          {view === "recharge" ? <RechargeView /> : null}
          {view === "qr" ? <QrView /> : null}
          {view === "personal-qr" ? <PersonalQrView /> : null}
          {view === "profile" ? <ProfileView /> : null}
          {view === "notifications" ? <NotificationsView /> : null}
          {view === "account-data" ? <AccountDataView /> : null}
          {view === "account-details" ? <AccountDetailsView /> : null}
          {view === "voucher-editor" ? <VoucherEditorView /> : null}
          {view === "high-amount" ? <HighAmountView /> : null}
          {view === "limits" ? <LimitsView /> : null}
          {view === "transfer-alerts" ? <TransferAlertsView /> : null}
          {view === "purchase-approval" ? <PurchaseApprovalView /> : null}
          {view === "help" ? <HelpView /> : null}
          {view === "dollars" ? <DollarsView /> : null}
          {view === "insurance" ? <InsuranceView /> : null}
          {view === "biometric" ? <BiometricView /> : null}
          {view === "credits" ? <CreditsView /> : null}
          {view === "addresses" ? <AddressesView /> : null}
          {view === "online-purchases" ? <OnlinePurchasesView /> : null}
          {view === "scanner" ? <ScannerView /> : null}
          {view === "transport-recharge" ? <TransportRechargeView /> : null}
        </div>
      </section>
    </main>
  );
}
