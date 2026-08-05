"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useModalLayer } from "../../hooks/useModalLayer";
import { fetchAccountBalance, clearBalanceCache } from "../../lib/balance-cache";
import { resetIOSViewport } from "../../lib/ios-viewport";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import { fetchSession } from "../../lib/session-cache";
import { maskPhone } from "../../lib/masked-phone";
import { QR_TRANSFER_SESSION_KEY } from "../../lib/qr-scanning";
import { APK_ASSET_ROOT, AssetIcon, LottiePlayer } from "./primitives";
import {
  buildVoucherShareText,
  createVoucherImage,
  formatVoucherAmount,
  formatVoucherDate,
  formatVoucherTime,
  getVoucherHero,
  isYapeDestination,
  shareVoucherImage,
  VoucherSinglePromo,
} from "./MovementVoucher";
import type {
  ContactPickerNavigator,
  PhoneContact,
  TransferStage,
} from "./types";

const TRANSFER_LOADING_MS = 900;

const PHONE_CONTACTS_CACHE_KEY = "yape-authorized-phone-contacts";

export function contactInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`
      : (parts[0]?.slice(0, 2) ?? "")
  ).toUpperCase();
}

function normalizeMobileNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  const localNumber = digits.length > 9 ? digits.slice(-9) : digits;
  if (localNumber.length !== 9) return "";
  return localNumber.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

const externalEntities = ["Banco Falabella", "Cmac Arequipa", "Dale", "Plin"];

const DAILY_YAPE_LIMIT = 500;

export { maskPhone } from "../../lib/masked-phone";

function formatEditablePhone(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
}

/** Overlay de carga recuperado del componente app-preload de la captura original. */
function LoadingOverlay({ text }: { text: string }) {
  return (
    <div className="transfer-preload entrance" role="status" aria-live="polite">
      <div className="transfer-preload-father">
        <div className="transfer-loading-card">
          <svg
            className="transfer-loading-spinner"
            viewBox="0 0 50 50"
            aria-hidden="true"
          >
            <circle
              className="path"
              cx="25"
              cy="25"
              r="20"
              fill="none"
              strokeWidth="5"
            />
          </svg>
          <h3>{text}</h3>
        </div>
      </div>
    </div>
  );
}

export function TransferView() {
  const [stage, setStage] = useState<TransferStage>("contact");
  const [recipientId, setRecipientId] = useState("");
  const [recipientQrId, setRecipientQrId] = useState("");
  const [recipientQrProvider, setRecipientQrProvider] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientIsNewNumber, setRecipientIsNewNumber] = useState(false);
  const [phoneIsEditing, setPhoneIsEditing] = useState(false);
  const [destination, setDestination] = useState("Yape");
  const [newNumber, setNewNumber] = useState("");
  const [recipientLookupLoading, setRecipientLookupLoading] = useState(false);
  const [manualRecipientMode, setManualRecipientMode] = useState(false);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [availableBalance, setAvailableBalance] = useState<number | null>(null);
  const [insufficientBalance, setInsufficientBalance] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [phoneContacts, setPhoneContacts] = useState<PhoneContact[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactPickerSupported, setContactPickerSupported] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsCacheKey, setContactsCacheKey] = useState(
    `${PHONE_CONTACTS_CACHE_KEY}:local`,
  );
  const [voucher, setVoucher] = useState<{
    code: string;
    operation: string;
    completedAt: Date;
  } | null>(null);
  const [voucherShareFile, setVoucherShareFile] = useState<File | null>(null);
  const voucherCaptureRef = useRef<HTMLDivElement>(null);
  const transferSubmittingRef = useRef(false);
  const recipientLookupAbortRef = useRef<AbortController | null>(null);
  const recipientLookupSequenceRef = useRef(0);
  const recipientLookupInFlightRef = useRef(false);
  const transferIdempotencyRef = useRef<{
    key: string;
    payload: string;
  } | null>(null);
  const confirmDialogRef = useModalLayer<HTMLDivElement>(
    stage === "confirm",
    () => setStage("entities"),
  );
  const insufficientDialogRef = useModalLayer<HTMLDivElement>(
    insufficientBalance,
    () => setInsufficientBalance(false),
  );

  const getBankScrollContainer = () =>
    document.querySelector<HTMLElement>(
      ".mobile-bank-shell.view-transfer .bank-scroll-area",
    );

  useEffect(() => {
    let cancelled = false;
    void fetchAccountBalance().then((result) => {
      if (cancelled || !result.ok) return;
      setAvailableBalance(result.balance);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("from") !== "qr") return;

    let rawPayload = "";
    try {
      rawPayload = window.sessionStorage.getItem(QR_TRANSFER_SESSION_KEY) ?? "";
      window.sessionStorage.removeItem(QR_TRANSFER_SESSION_KEY);
    } catch {
      return;
    }
    if (!rawPayload) return;

    try {
      const payload = JSON.parse(rawPayload) as {
        qrId?: unknown;
        provider?: unknown;
        recipientId?: unknown;
        phone?: unknown;
        displayName?: unknown;
      };
      const requestedQrId = typeof payload.qrId === "string"
        ? payload.qrId.trim()
        : "";
      const requestedQrProvider = typeof payload.provider === "string"
        ? payload.provider.trim()
        : "";
      const requestedRecipientId = typeof payload.recipientId === "string"
        ? payload.recipientId.trim()
        : "";
      const requestedPhone = typeof payload.phone === "string"
        ? payload.phone.replace(/\D/gu, "").slice(-9)
        : "";
      const requestedName = typeof payload.displayName === "string"
        ? payload.displayName.trim().slice(0, 48)
        : "";
      if (!requestedName || (!requestedQrId && !requestedRecipientId && !/^9\d{8}$/u.test(requestedPhone))) return;

      setRecipientQrId(requestedQrId);
      setRecipientQrProvider(requestedQrProvider);
      setRecipientId(requestedRecipientId);
      setRecipientName(requestedName);
      setRecipientPhone(requestedPhone);
      setRecipientIsNewNumber(false);
      setManualRecipientMode(false);
      setPhoneIsEditing(false);
      setDestination(
        requestedQrId && requestedQrProvider && requestedQrProvider !== "Yape"
          ? requestedQrProvider
          : "Yape",
      );
      setNotice("");
      setStage("amount");
    } catch {
      // Un payload QR corrupto no debe impedir usar la transferencia manual.
    }
  }, []);

  useEffect(() => {
    const requestedRecipientId =
      new URLSearchParams(window.location.search).get("recipient") ?? "";
    if (!requestedRecipientId) return;

    let cancelled = false;
    fetch("/api/payments/recipient-lookup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ recipientId: requestedRecipientId }),
    })
      .then(async (response) => {
        const data = (await response.json()) as {
          recipient?: { id?: string; displayName?: string; phone?: string };
          error?: string;
        };
        if (
          !response.ok ||
          !data.recipient?.id ||
          !data.recipient.displayName
        ) {
          throw new Error(
            safeApiMessage(data.error, "No encontramos al destinatario de este QR."),
          );
        }
        return data.recipient as { id: string; displayName: string; phone?: string };
      })
      .then((recipient) => {
        if (cancelled) return;
        setRecipientQrId("");
        setRecipientQrProvider("");
        setRecipientId(recipient.id);
        setRecipientName(recipient.displayName);
        setRecipientPhone(recipient.phone ?? "");
        setRecipientIsNewNumber(false);
        setManualRecipientMode(false);
        setDestination("Yape");
        setNotice("");
        setStage("amount");
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setNotice(safeClientMessage(error, "No pudimos verificar este QR."));
        setStage("contact");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const contactPicker = (navigator as ContactPickerNavigator).contacts;
    const supportTimer = window.setTimeout(() => {
      setContactPickerSupported(Boolean(contactPicker?.select));
    }, 0);

    let cancelled = false;
    void fetchSession().then((result) => {
      if (cancelled) return;
      const userId =
        result.ok && typeof result.user.id === "string"
          ? result.user.id
          : "local";
      setContactsCacheKey(`${PHONE_CONTACTS_CACHE_KEY}:${userId}`);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(supportTimer);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const cachedContacts = window.sessionStorage.getItem(contactsCacheKey);
        if (!cachedContacts) return;
        const parsedContacts = JSON.parse(cachedContacts) as PhoneContact[];
        if (Array.isArray(parsedContacts)) setPhoneContacts(parsedContacts);
      } catch {
        window.sessionStorage.removeItem(contactsCacheKey);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [contactsCacheKey]);

  useEffect(() => () => {
    recipientLookupAbortRef.current?.abort();
    recipientLookupSequenceRef.current += 1;
    recipientLookupInFlightRef.current = false;
  }, []);

  useLayoutEffect(() => {
    if (
      stage !== "amount" ||
      !recipientIsNewNumber ||
      Boolean(recipientId) ||
      Boolean(recipientQrId) ||
      manualRecipientMode
    ) {
      return;
    }

    const normalizedPhone = recipientPhone.replace(/\D/g, "");
    if (!/^9\d{8}$/u.test(normalizedPhone)) return;
    if (recipientLookupInFlightRef.current) return;

    recipientLookupAbortRef.current?.abort();
    const requestSequence = recipientLookupSequenceRef.current + 1;
    recipientLookupSequenceRef.current = requestSequence;
    const controller = new AbortController();
    recipientLookupAbortRef.current = controller;
    recipientLookupInFlightRef.current = true;
    setRecipientLookupLoading(true);
    setRecipientName("");
    setNotice("");

    void (async () => {
      try {
        const response = await fetch("/api/payments/recipient-lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: normalizedPhone }),
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as {
          recipient?: {
            id?: string;
            displayName?: string;
            phone?: string;
          };
        };

        if (
          requestSequence !== recipientLookupSequenceRef.current ||
          !response.ok
        ) {
          if (requestSequence === recipientLookupSequenceRef.current) {
            enableManualRecipientFallback(normalizedPhone);
          }
          return;
        }

        if (!data.recipient?.displayName || !data.recipient.phone) {
          enableManualRecipientFallback(normalizedPhone);
          return;
        }

        setRecipientId(data.recipient.id || "");
        setRecipientName(data.recipient.displayName);
        setRecipientPhone(data.recipient.phone);
        setManualRecipientMode(false);
        setRecipientIsNewNumber(false);
        setPhoneIsEditing(false);
        setDestination("Yape");
        setNotice("");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (requestSequence !== recipientLookupSequenceRef.current) return;
        enableManualRecipientFallback(normalizedPhone);
      } finally {
        if (requestSequence === recipientLookupSequenceRef.current) {
          setRecipientLookupLoading(false);
          recipientLookupInFlightRef.current = false;
          recipientLookupAbortRef.current = null;
        }
      }
    })();

    return () => {
      controller.abort();
      if (requestSequence === recipientLookupSequenceRef.current) {
        recipientLookupSequenceRef.current += 1;
        recipientLookupInFlightRef.current = false;
        setRecipientLookupLoading(false);
      }
    };
  }, [
    manualRecipientMode,
    recipientId,
    recipientQrId,
    recipientIsNewNumber,
    recipientPhone,
    stage,
  ]);

  useEffect(() => {
    if (stage !== "success" || !voucher) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void createVoucherImage(voucherCaptureRef.current)
        .then((file) => {
          if (!cancelled) setVoucherShareFile(file);
        })
        .catch(() => {
          if (!cancelled)
            setNotice("No se pudo preparar la imagen del comprobante.");
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [stage, voucher]);

  const amountValue = Number(amount || "0");
  const isNewNumber = recipientIsNewNumber;
  const amountIsInRange =
    amount !== "" && amountValue > 0 && amountValue <= DAILY_YAPE_LIMIT;
  const recipientIsValid =
    recipientName.trim().length >= 2 &&
    (Boolean(recipientId) || Boolean(recipientQrId) || (
      recipientPhone.replace(/\D/g, "").length === 9
    ));
  const yapearEnabled = recipientIsValid && amountIsInRange;
  const voucherRecipientName = recipientName;
  const recipientDisplayReference =
    recipientQrId && !recipientId && !recipientPhone
      ? `QR ${recipientQrProvider || "bancario"}`
      : recipientId && !recipientPhone
        ? "QR Yape"
        : maskPhone(recipientPhone);
  const normalizedContactSearch = contactSearch.trim().toLocaleLowerCase("es");
  const filteredPhoneContacts = phoneContacts.filter((contact) => {
    if (!normalizedContactSearch) return true;
    return (
      contact.name.toLocaleLowerCase("es").includes(normalizedContactSearch) ||
      contact.phone
        .replace(/\s/g, "")
        .includes(normalizedContactSearch.replace(/\D/g, ""))
    );
  });
  const frequentPhoneContacts = phoneContacts.slice(0, 4);

  async function requestPhoneContacts() {
    const contactPicker = (navigator as ContactPickerNavigator).contacts;
    if (!contactPicker?.select) return;

    setContactsLoading(true);
    try {
      const selectedContacts = await contactPicker.select(["name", "tel"], {
        multiple: true,
      });
      const contactsByPhone = new Map<string, PhoneContact>();

      for (const selectedContact of selectedContacts) {
        const name =
          selectedContact.name?.find((entry) => entry.trim())?.trim() ||
          "Contacto";
        for (const rawPhone of selectedContact.tel ?? []) {
          const phone = normalizeMobileNumber(rawPhone);
          if (!phone) continue;
          contactsByPhone.set(phone.replace(/\s/g, ""), {
            name,
            phone,
            initials: contactInitials(name),
          });
        }
      }

      const authorizedContacts = Array.from(contactsByPhone.values()).sort(
        (first, second) =>
          first.name.localeCompare(second.name, "es", { sensitivity: "base" }),
      );

      if (authorizedContacts.length === 0) return;
      setPhoneContacts(authorizedContacts);
      window.sessionStorage.setItem(
        contactsCacheKey,
        JSON.stringify(authorizedContacts),
      );
    } finally {
      setContactsLoading(false);
    }
  }

  function pickContact(name: string, phone: string) {
    const normalizedPhone = normalizeMobileNumber(phone);
    setRecipientId("");
    setRecipientQrId("");
    setRecipientQrProvider("");
    setRecipientName(name.trim());
    setRecipientPhone(normalizedPhone || phone);
    setManualRecipientMode(false);
    setRecipientIsNewNumber(false);
    setPhoneIsEditing(false);
    setDestination("Yape");
    setNewNumber("");
    setNotice("");
    // Los contactos frecuentes ya tienen nombre y celular guardados. No
    // necesitan volver a pasar por la consulta externa de titulares.
    setStage("amount");
  }

  function enableManualRecipientFallback(phone: string) {
    setRecipientId("");
    setRecipientQrId("");
    setRecipientQrProvider("");
    setRecipientName("");
    setRecipientPhone(phone);
    setManualRecipientMode(true);
    setRecipientIsNewNumber(true);
    setPhoneIsEditing(false);
    setDestination("Yape");
    setNotice("");
    // La consulta externa solo autocompleta el titular; el formulario manual
    // queda disponible cuando el proveedor no responde o no entrega un nombre.
  }

  function submitNewNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = newNumber.replace(/\D/g, "");
    if (!/^9\d{8}$/u.test(normalizedPhone)) {
      setNotice("Ingresa un número de celular válido de 9 dígitos.");
      return;
    }
    recipientLookupAbortRef.current?.abort();
    recipientLookupSequenceRef.current += 1;
    recipientLookupInFlightRef.current = false;
    setRecipientLookupLoading(false);
    setNotice("");
    setRecipientId("");
    setRecipientQrId("");
    setRecipientQrProvider("");
    setRecipientName("");
    setRecipientPhone(normalizedPhone);
    setManualRecipientMode(false);
    setRecipientIsNewNumber(true);
    setPhoneIsEditing(false);
    setDestination("Yape");
    // La consulta del titular se inicia al montar la pantalla de monto.
    setStage("amount");
  }

  function showInsufficientBalance() {
    setInsufficientBalance(true);
    setNotice("");
  }

  async function submitTransfer(
    destinationValue: string,
    processingStage: "amount-processing" | "confirm-processing",
  ) {
    if (!yapearEnabled || transferSubmittingRef.current) return;
    if (availableBalance === null || amountValue > availableBalance) {
      showInsufficientBalance();
      return;
    }

    transferSubmittingRef.current = true;
    setTransferSubmitting(true);
    setNotice("");
    try {
      const transferRecipientPhone = recipientId || recipientQrId ? "" : recipientPhone;
      const transferPayload = JSON.stringify({
        amountCents: Math.round(amountValue * 100),
        recipientId,
        recipientQrId,
        recipientPhone: transferRecipientPhone,
        recipientManualName: recipientName.trim(),
        destination: destinationValue,
        message,
      });
      if (transferIdempotencyRef.current?.payload !== transferPayload) {
        transferIdempotencyRef.current = {
          key: crypto.randomUUID(),
          payload: transferPayload,
        };
      }
      const response = await fetch("/api/payments/transfer", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": transferIdempotencyRef.current.key,
        },
        body: transferPayload,
        cache: "no-store",
      });
      const data = (await response.json()) as {
        balance?: number;
        movement?: {
          recipientName?: string;
          recipientReference?: string;
          securityCode?: string;
          operationNumber?: string;
          createdAt?: string;
        };
        error?: string;
      };
      if (!response.ok) {
        if (data.error === "Saldo insuficiente") {
          showInsufficientBalance();
          clearBalanceCache();
          const balanceResult = await fetchAccountBalance({ force: true });
          if (balanceResult.ok) setAvailableBalance(balanceResult.balance);
          return;
        }
        throw new Error(safeApiMessage(data.error, "No pudimos completar el yapeo."));
      }

      const completedAt = data.movement?.createdAt
        ? new Date(data.movement.createdAt)
        : new Date();
      const resolvedRecipientName =
        data.movement?.recipientName?.trim() || recipientName.trim();
      if (resolvedRecipientName) setRecipientName(resolvedRecipientName);
      const phoneKey = recipientPhone.replace(/\D/g, "");
      if (phoneKey && resolvedRecipientName) {
        setPhoneContacts((current) => {
          let changed = false;
          const next = current.map((contact) => {
            if (contact.phone.replace(/\D/g, "") !== phoneKey) return contact;
            changed = true;
            return {
              ...contact,
              name: resolvedRecipientName,
              initials: contactInitials(resolvedRecipientName),
            };
          });
          if (!changed) {
            next.unshift({
              name: resolvedRecipientName,
              phone: recipientPhone,
              initials: contactInitials(resolvedRecipientName),
            });
          }
          window.sessionStorage.setItem(contactsCacheKey, JSON.stringify(next));
          return next;
        });
      }
      setAvailableBalance(
        typeof data.balance === "number"
          ? data.balance
          : Math.max(0, availableBalance - amountValue),
      );
      setDestination(destinationValue);
      setVoucher({
        code:
          data.movement?.securityCode ||
          String(Math.floor(100 + Math.random() * 900)),
        operation:
          data.movement?.operationNumber ||
          String(Math.floor(10000000 + Math.random() * 90000000)),
        completedAt,
      });
      resetIOSViewport(getBankScrollContainer());
      setStage(processingStage);
    } catch (error) {
      setNotice(
        error instanceof Error
          ? safeClientMessage(error, "No pudimos completar el yapeo.")
          : "No pudimos completar el yapeo.",
      );
    } finally {
      transferSubmittingRef.current = false;
      setTransferSubmitting(false);
    }
  }

  function requestYapear() {
    void submitTransfer("Yape", "amount-processing");
  }

  function requestOtherBanks() {
    if (recipientQrId && !recipientId && recipientQrProvider && recipientQrProvider !== "Yape") {
      setDestination(recipientQrProvider);
      setStage("entity-loading");
      return;
    }
    setStage("entities");
  }

  function chooseEntity(entity: string) {
    setDestination(entity);
    setStage("entity-loading");
  }

  function confirmTransfer() {
    void submitTransfer(destination, "confirm-processing");
  }

  function startNewYape() {
    setStage("contact");
    setRecipientId("");
    setRecipientQrId("");
    setRecipientQrProvider("");
    setRecipientName("");
    setRecipientPhone("");
    setManualRecipientMode(false);
    setRecipientIsNewNumber(false);
    setPhoneIsEditing(false);
    setDestination("Yape");
    setNewNumber("");
    setRecipientLookupLoading(false);
    setAmount("");
    setMessage("");
    setNotice("");
    setInsufficientBalance(false);
    setVoucher(null);
    setVoucherShareFile(null);
    transferIdempotencyRef.current = null;
  }

  async function shareTransferVoucher() {
    if (!voucher) return;
    if (!voucherShareFile) {
      setNotice(
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
          recipient: voucherRecipientName,
          date: formattedDate,
          time: formattedTime,
          securityCode: voucher.code,
          phone: recipientDisplayReference,
          destination,
          operation: voucher.operation,
        }),
      });
      setNotice(result);
    } catch {
      setNotice("No se pudo compartir el comprobante.");
    }
  }

  useEffect(() => {
    if (
      (stage === "amount-processing" || stage === "confirm-processing") &&
      voucher
    ) {
      const timer = window.setTimeout(() => {
        resetIOSViewport(getBankScrollContainer());
        setStage("success");
      }, TRANSFER_LOADING_MS);
      return () => window.clearTimeout(timer);
    }
    if (stage === "entity-loading") {
      const timer = window.setTimeout(() => {
        setStage("confirm");
      }, TRANSFER_LOADING_MS);
      return () => window.clearTimeout(timer);
    }
  }, [stage, destination, voucher]);

  useLayoutEffect(() => {
    if (stage !== "success") return undefined;
    return resetIOSViewport(getBankScrollContainer());
  }, [stage]);

  const showAmountScreen = stage === "amount" || stage === "amount-processing";
  const showEntitiesScreen =
    stage === "entities" ||
    stage === "entity-loading" ||
    stage === "confirm" ||
    stage === "confirm-processing";
  const formattedDate = voucher ? formatVoucherDate(voucher.completedAt) : "";
  const formattedTime = voucher ? formatVoucherTime(voucher.completedAt) : "";
  const voucherHero = getVoucherHero(amountValue);

  return (
    <>
      {stage === "contact" ? (
        <>
          <header className="transfer-flow-header">
            <Link
              href="/inicio"
              className="transfer-header-close"
              aria-label="Cerrar"
            >
              <AssetIcon name="ic_close_yape" />
            </Link>
            <h1>Yapear</h1>
            <span className="transfer-header-spacer" aria-hidden="true" />
          </header>
          <div className="transfer-flow-content">
            {notice ? (
              <p className="inline-notice" role="status">
                {notice}
              </p>
            ) : null}
            <label className="movement-search transfer-search">
              <AssetIcon name="ic_search_yape" />
              <input
                aria-label="Busca el celular o contacto"
                placeholder="Busca el celular o contacto"
                value={contactSearch}
                onChange={(event) => setContactSearch(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="transfer-new-number-row"
              onClick={() => setStage("new-number")}
            >
              <span className="transfer-row-icon">
                <AssetIcon name="ic_smartphone_outline_yape" />
              </span>
              <strong>Nuevo número</strong>
              <AssetIcon name="ic_chevron_right_yape" />
            </button>
            {contactPickerSupported ? (
              <button
                type="button"
                className="phone-contacts-access"
                onClick={requestPhoneContacts}
                disabled={contactsLoading}
              >
                <span className="transfer-row-icon">
                  <AssetIcon name="ic_person_outline_yape" />
                </span>
                <span>
                  <strong>
                    {phoneContacts.length
                      ? "Actualizar contactos"
                      : "Usar contactos del teléfono"}
                  </strong>
                </span>
                <AssetIcon name="ic_chevron_right_yape" />
              </button>
            ) : null}
            {frequentPhoneContacts.length ? (
              <>
                <h2 className="transfer-section-title">Yaperos frecuentes</h2>
                <div className="frequent-contacts-row">
                  {frequentPhoneContacts.map((contact) => (
                    <button
                      type="button"
                      className="frequent-contact"
                      key={`frequent-${contact.phone}`}
                      onClick={() => pickContact(contact.name, contact.phone)}
                    >
                      <span className="contact-avatar">{contact.initials}</span>
                      <strong>{contact.name}</strong>
                      <small>{maskPhone(contact.phone)}</small>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <h2 className="transfer-section-title">Todos tus contactos</h2>
            <div className="all-contacts-list">
              {filteredPhoneContacts.map((contact) => (
                <button
                  type="button"
                  className="contact-row"
                  key={contact.phone}
                  onClick={() => pickContact(contact.name, contact.phone)}
                >
                  <strong>{contact.name}</strong>
                  <small>{contact.phone}</small>
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      {stage === "new-number" ? (
        <section className="transfer-new-number-screen">
          <header className="transfer-flow-header">
            <button
              type="button"
              className="transfer-header-back"
              onClick={() => setStage("contact")}
              aria-label="Volver"
            >
              <AssetIcon name="ic_back_arrow_yape" />
            </button>
            <span className="transfer-header-spacer" aria-hidden="true" />
            <span className="transfer-header-spacer" aria-hidden="true" />
          </header>
          <div className="transfer-flow-content">
            <h1 className="transfer-new-number-title">Yapear a nuevo número</h1>
            <form
              id="new-number-form"
              className="new-number-form"
              onSubmit={submitNewNumber}
            >
              <label className="phone-prefix-field">
                <span>Ingresa el número de celular</span>
                <div>
                  <b>+51</b>
                  <input
                    type="tel"
                    inputMode="numeric"
                    maxLength={11}
                    value={newNumber}
                    onChange={(event) => {
                      recipientLookupAbortRef.current?.abort();
                      recipientLookupSequenceRef.current += 1;
                      recipientLookupInFlightRef.current = false;
                      setRecipientLookupLoading(false);
                      setRecipientId("");
                      setRecipientName("");
                      setRecipientPhone("");
                      setManualRecipientMode(false);
                      setNewNumber(formatEditablePhone(event.target.value));
                    }}
                    required
                  />
                  {newNumber ? (
                    <button
                      type="button"
                      aria-label="Limpiar número"
                      onClick={() => {
                        recipientLookupAbortRef.current?.abort();
                        recipientLookupSequenceRef.current += 1;
                        recipientLookupInFlightRef.current = false;
                        setRecipientLookupLoading(false);
                        setRecipientId("");
                        setRecipientName("");
                        setRecipientPhone("");
                        setManualRecipientMode(false);
                        setNewNumber("");
                      }}
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              </label>
              {notice ? (
                <p className="inline-notice" role="status">
                  {notice}
                </p>
              ) : null}
            </form>
          </div>
          <div className="transfer-flow-footer">
            <button
              className="transfer-primary-button transfer-full-width-button"
              type="submit"
              form="new-number-form"
              disabled={
                newNumber.replace(/\D/g, "").length < 9 ||
                recipientLookupLoading
              }
            >
              Continuar
            </button>
          </div>
        </section>
      ) : null}

      {showAmountScreen ? (
        <section className="transfer-amount-screen">
          <header className="transfer-flow-header">
            <button
              type="button"
              className="transfer-header-back"
              onClick={() => setStage("contact")}
              aria-label="Volver"
            >
              <AssetIcon name="ic_back_arrow_yape" />
            </button>
            <span>Yapear a</span>
            <Link
              href="/inicio"
              className="transfer-header-close"
              aria-label="Cerrar"
            >
              <AssetIcon name="ic_close_yape" />
            </Link>
          </header>
          <div
            className="transfer-flow-content transfer-amount-content"
            aria-busy={recipientLookupLoading}
          >
            <div
              className="transfer-recipient-editor"
              aria-busy={recipientLookupLoading}
            >
              <div className="transfer-recipient-name-slot">
                {recipientLookupLoading ? (
                  <div
                    className="recipient-name-skeleton"
                    role="status"
                    aria-live="polite"
                  >
                    <span className="sr-only">
                      Consultando el titular del destinatario.
                    </span>
                  </div>
                ) : (
                  <input
                    className="transfer-recipient-name-input"
                    aria-label="Nombre del destinatario"
                    placeholder="Nombre del destinatario"
                    value={recipientName}
                    readOnly={Boolean(recipientId || recipientQrId)}
                    onChange={(event) =>
                      setRecipientName(event.target.value.slice(0, 48))
                    }
                  />
                )}
              </div>
              <input
                className="transfer-recipient-phone-input"
                aria-label="Número del destinatario"
                inputMode="numeric"
                value={
                  recipientQrId && !recipientId && !recipientPhone
                    ? recipientDisplayReference
                    : recipientId && !recipientPhone
                      ? "Destinatario verificado por QR"
                      : phoneIsEditing
                        ? formatEditablePhone(recipientPhone)
                        : maskPhone(recipientPhone)
                }
                readOnly={Boolean(recipientId || recipientQrId)}
                onFocus={(event) => {
                  if (recipientId || recipientQrId) return;
                  setPhoneIsEditing(true);
                  event.currentTarget.select();
                }}
                onBlur={() => setPhoneIsEditing(false)}
                onChange={(event) => {
                  recipientLookupAbortRef.current?.abort();
                  recipientLookupSequenceRef.current += 1;
                  recipientLookupInFlightRef.current = false;
                  setRecipientLookupLoading(false);
                  setRecipientId("");
                  setRecipientQrId("");
                  setRecipientQrProvider("");
                  setRecipientName("");
                  setManualRecipientMode(false);
                  setRecipientIsNewNumber(true);
                  setRecipientPhone(formatEditablePhone(event.target.value));
                }}
              />
            </div>
            {notice ? (
              <p className="inline-notice" role="status">
                {notice}
              </p>
            ) : null}
            <label className="transfer-amount-field">
              <span>S/</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) =>
                  setAmount(event.target.value.replace(/[^0-9.]/g, ""))
                }
                placeholder="0"
                style={{
                  width: `${Math.min(4.8, Math.max(0.58, Math.max(1, amount.length) * 0.58))}em`,
                }}
              />
            </label>
            <p className="transfer-amount-hint">
              Puedes yapear hasta S/ 500 diarios
            </p>
          </div>
          <div className="transfer-flow-footer transfer-amount-footer">
            <label className="transfer-message-field">
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Agregar mensaje"
              />
            </label>
            <div className="transfer-amount-actions">
              <button
                type="button"
                className="transfer-secondary-button"
                onClick={requestOtherBanks}
                disabled={!recipientIsValid || !amountIsInRange}
              >
                Otros bancos
              </button>
              <button
                type="button"
                className="transfer-primary-button"
                onClick={requestYapear}
                disabled={!yapearEnabled || transferSubmitting || Boolean(recipientQrId && !recipientId)}
              >
                {transferSubmitting ? "Validando…" : "Yapear"}
              </button>
            </div>
          </div>
          {stage === "amount-processing" ? (
            <LoadingOverlay text="Yapeando..." />
          ) : null}
        </section>
      ) : null}

      {showEntitiesScreen ? (
        <>
          <header className="transfer-flow-header">
            <button
              type="button"
              className="transfer-header-back"
              onClick={() => setStage("amount")}
              aria-label="Volver"
            >
              <AssetIcon name="ic_back_arrow_yape" />
            </button>
            <span className="transfer-header-spacer" aria-hidden="true" />
            <Link
              href="/inicio"
              className="transfer-header-close"
              aria-label="Cerrar"
            >
              <AssetIcon name="ic_close_yape" />
            </Link>
          </header>
          <div className="transfer-flow-content">
            <div className="entity-recipient-card">
              <span>
                <strong>{recipientName.trim() || "Número nuevo"}</strong>
                <small>
                  {recipientId ? recipientDisplayReference : recipientPhone}
                </small>
              </span>
              {isNewNumber ? (
                <button type="button" className="invite-link-button">
                  Invitar a Yape
                </button>
              ) : null}
            </div>
            <h2 className="transfer-section-title">
              Selecciona una entidad financiera
            </h2>
            <div className="entities-list">
              {externalEntities.map((entity) => (
                <button
                  type="button"
                  className="entity-row"
                  key={entity}
                  onClick={() => chooseEntity(entity)}
                >
                  <span className="entity-icon">
                    <AssetIcon name="ic_duotone_money_arrows_around" />
                  </span>
                  <strong>{entity}</strong>
                </button>
              ))}
            </div>
          </div>

          {stage === "entity-loading" ? (
            <LoadingOverlay text="Cargando..." />
          ) : null}

          {stage === "confirm" ? (
            <div
              ref={confirmDialogRef}
              className="transfer-confirm-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-confirm-title"
              tabIndex={-1}
            >
              <div className="transfer-confirm-modal">
                <span className="entity-icon confirm-modal-icon">
                  <AssetIcon name="ic_duotone_money_arrows_around" />
                </span>
                <p>Vas a yapear a:</p>
                <h2 id="transfer-confirm-title">{voucherRecipientName}</h2>
                <div className="transfer-confirm-summary">
                  <div>
                    <span>Monto</span>
                    <strong>S/ {amountValue.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Destino</span>
                    <strong>{destination}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  className="transfer-confirm-button"
                  onClick={confirmTransfer}
                  disabled={transferSubmitting}
                >
                  {transferSubmitting ? "Validando saldo…" : "Confirmar yapeo"}
                </button>
                <button
                  type="button"
                  className="transfer-confirm-cancel"
                  onClick={() => setStage("entities")}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          {stage === "confirm-processing" ? (
            <LoadingOverlay text="Yapeando..." />
          ) : null}
        </>
      ) : null}

      {stage === "success" ? (
        <section className="yape-voucher yape-success-voucher" role="status">
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
                    onClick={shareTransferVoucher}
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
                <p className="voucher-recipient">{voucherRecipientName}</p>
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
                    {(voucher?.code ?? "---").split("").map((digit, index) => (
                      <span key={index}>{digit}</span>
                    ))}
                  </div>
                </div>

                <div className="voucher-details">
                  <span className="voucher-section-label">
                    DATOS DE LA TRANSACCIÓN
                  </span>
                  {isYapeDestination(destination) ? (
                    <div>
                      <span>Nro. de celular</span>
                      <strong>{recipientDisplayReference}</strong>
                    </div>
                  ) : null}
                  <div>
                    <span>Destino</span>
                    <strong>{destination}</strong>
                  </div>
                  <div>
                    <span>Nro. de operación</span>
                    <strong>{voucher?.operation ?? ""}</strong>
                  </div>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="voucher-new-yape-button"
              onClick={startNewYape}
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
          <Link
            href="/inicio"
            className="voucher-close-button"
            aria-label="Cerrar"
          >
            <img
              src="/assets/captured/voucher/equis1.svg"
              alt=""
              aria-hidden="true"
            />
          </Link>

          {notice ? (
            <p className="inline-notice voucher-notice" role="status">
              {notice}
            </p>
          ) : null}
        </section>
      ) : null}
      {insufficientBalance ? (
        <div
          ref={insufficientDialogRef}
          className="transfer-confirm-overlay insufficient-balance-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="insufficient-balance-title"
          tabIndex={-1}
        >
          <div className="transfer-confirm-modal insufficient-balance-dialog">
            <span className="insufficient-balance-icon" aria-hidden="true">
              <AssetIcon name="ic_money_bag_soles_outline_yape_primary" />
            </span>
            <h2 id="insufficient-balance-title">Saldo insuficiente</h2>
            <p>
              No tienes saldo disponible para yapear S/ {amountValue.toFixed(2)}
              .
            </p>
            <div className="insufficient-balance-summary">
              <span>Tu saldo actual</span>
              <strong>
                {availableBalance === null
                  ? "S/ 0.00"
                  : `S/ ${availableBalance.toFixed(2)}`}
              </strong>
            </div>
            <button
              type="button"
              className="transfer-confirm-button"
              onClick={() => setInsufficientBalance(false)}
            >
              Entendido
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
