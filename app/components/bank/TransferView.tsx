"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useModalLayer } from "../../hooks/useModalLayer";
import { fetchAccountBalance, clearBalanceCache } from "../../lib/balance-cache";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import { fetchSession } from "../../lib/session-cache";
import { resetIOSViewport } from "../../lib/ios-viewport";
import { maskPhone } from "../../lib/masked-phone";
import {
  getRecipientProviderActions,
} from "../../lib/recipient-providers";
import { submitTransferRequest } from "../../lib/transfer-submission";
import {
  formatVoucherDate,
  formatVoucherTime,
  getVoucherHero,
  isIzipayDestination,
} from "./MovementVoucher";
import { TransferStageViews } from "./TransferStageViews";
import {
  normalizeMobileNumber,
  useTransferRecipient,
} from "./useTransferRecipient";
import { useTransferVoucher } from "./useTransferVoucher";
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

const DAILY_YAPE_LIMIT = 500;
export { maskPhone } from "../../lib/masked-phone";

export function TransferView() {
  const [stage, setStage] = useState<TransferStage>("contact");
  const [newNumber, setNewNumber] = useState("");
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
  const transferSubmittingRef = useRef(false);
  const transferIdempotencyRef = useRef<{
    key: string;
    payload: string;
  } | null>(null);
  const confirmDialogRef = useRef<HTMLDivElement>(null);
  const confirmationCloseTimerRef = useRef<number | null>(null);
  const confirmationReturnFocusRef = useRef<HTMLElement | null>(null);
  const [confirmationClosing, setConfirmationClosing] = useState(false);
  const insufficientDialogRef = useModalLayer<HTMLDivElement>(
    insufficientBalance,
    () => setInsufficientBalance(false),
  );
  const recipient = useTransferRecipient({
    stage,
    setStage,
    newNumber,
    setNotice,
    setNewNumber,
  });
  const {
    recipientId,
    setRecipientId,
    recipientQrId,
    setRecipientQrId,
    recipientFromQr,
    setRecipientFromQr,
    recipientProviders,
    setRecipientProviders,
    recipientName,
    setRecipientName,
    recipientPhone,
    setRecipientPhone,
    recipientIsNewNumber,
    setRecipientIsNewNumber,
    phoneIsEditing,
    setPhoneIsEditing,
    destination,
    setDestination,
    recipientLookupLoading,
    setRecipientLookupLoading,
    recipientProviderLoading,
    manualRecipientMode,
    setManualRecipientMode,
    recipientLookupAbortRef,
    recipientLookupSequenceRef,
    recipientLookupInFlightRef,
    pickContact,
    submitNewNumber,
    cancelFrequentProviderLookup,
  } = recipient;
  const {
    voucher,
    setVoucher,
    voucherShareFile,
    voucherCaptureRef,
    shareTransferVoucher,
  } = useTransferVoucher({ stage, setNotice });

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
    if (confirmationCloseTimerRef.current !== null) {
      window.clearTimeout(confirmationCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (stage !== "confirm") return undefined;
    const frame = window.requestAnimationFrame(() => {
      confirmDialogRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [stage]);

  useEffect(() => {
    const confirmationOpen =
      stage === "confirm" || stage === "confirm-processing";
    if (!confirmationOpen) return undefined;

    const scrollContainer = document.querySelector<HTMLElement>(
      ".mobile-bank-shell.view-transfer .bank-scroll-area",
    );
    const previousBodyOverflow = document.body.style.overflow;
    const previousContainerOverflow = scrollContainer?.style.overflow ?? "";
    document.body.style.overflow = "hidden";
    if (scrollContainer) scrollContainer.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (scrollContainer) scrollContainer.style.overflow = previousContainerOverflow;
    };
  }, [stage]);

  const amountValue = Number(amount || "0");
  const isNewNumber = recipientIsNewNumber;
  const amountIsInRange =
    amount !== "" && amountValue > 0 && amountValue <= DAILY_YAPE_LIMIT;
  const recipientIsValid =
    recipientName.trim().length >= 2 &&
    (Boolean(recipientId) || Boolean(recipientQrId) || (
      Boolean(normalizeMobileNumber(recipientPhone))
    ));
  const yapearEnabled = recipientIsValid && amountIsInRange;
  const voucherRecipientName = recipientName;
  // Un QR de banco no tiene celular que mostrar: dejamos el campo vacío en
  // lugar de inventar una referencia visual.
  const recipientDisplayReference = recipientPhone ? maskPhone(recipientPhone) : "";
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
      const { response, data } = await submitTransferRequest({
        amountValue,
        recipientId,
        recipientQrId,
        recipientPhone,
        recipientName,
        destination: destinationValue,
        message,
        idempotencyRef: transferIdempotencyRef,
      });
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
    const { primaryProvider } = getRecipientProviderActions(
      recipientProviders,
      recipientFromQr,
    );
    void submitTransfer(primaryProvider, "amount-processing");
  }

  function requestOtherBanks() {
    if (!yapearEnabled) return;
    if (availableEntities.length > 0) {
      setDestination(availableEntities[0]);
    }
    setConfirmationClosing(false);
    setStage("entities");
  }

  function chooseEntity(entity: string) {
    confirmationReturnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setDestination(entity);
    setConfirmationClosing(false);
    setStage("confirm");
  }

  function closeConfirmation() {
    if (confirmationClosing) return;
    setConfirmationClosing(true);
    if (confirmationCloseTimerRef.current !== null) {
      window.clearTimeout(confirmationCloseTimerRef.current);
    }
    confirmationCloseTimerRef.current = window.setTimeout(() => {
      confirmationCloseTimerRef.current = null;
      setConfirmationClosing(false);
      setStage("entities");
      confirmationReturnFocusRef.current?.focus();
      confirmationReturnFocusRef.current = null;
    }, 300);
  }

  function confirmTransfer() {
    void submitTransfer(destination, "confirm-processing");
  }

  useEffect(() => {
    if (stage !== "entity-loading") return undefined;
    const timer = window.setTimeout(() => setStage("confirm"), TRANSFER_LOADING_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

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
  }, [stage, destination, voucher]);

  useLayoutEffect(() => {
    if (stage !== "success") return undefined;
    return resetIOSViewport(getBankScrollContainer());
  }, [stage]);

  const showAmountScreen = stage === "amount" || stage === "amount-processing";
  const providerActions = getRecipientProviderActions(
    recipientProviders,
    recipientFromQr,
  );
  const showEntitiesScreen =
    stage === "entities" ||
    stage === "entity-loading" ||
    stage === "confirm" ||
    stage === "confirm-processing";
  const availableEntities = providerActions.otherProviders;
  const formattedDate = voucher ? formatVoucherDate(voucher.completedAt) : "";
  const formattedTime = voucher ? formatVoucherTime(voucher.completedAt) : "";
  const voucherHero = getVoucherHero(amountValue);
  const hideVoucherSecurity = isIzipayDestination(destination);

  return (
    <TransferStageViews
      stage={stage}
      showAmountScreen={showAmountScreen}
      providerActions={providerActions}
      showEntitiesScreen={showEntitiesScreen}
      availableEntities={availableEntities}
      notice={notice}
      contactSearch={contactSearch}
      setContactSearch={setContactSearch}
      cancelFrequentProviderLookup={cancelFrequentProviderLookup}
      setStage={setStage}
      contactPickerSupported={contactPickerSupported}
      requestPhoneContacts={requestPhoneContacts}
      contactsLoading={contactsLoading}
      phoneContacts={phoneContacts}
      frequentPhoneContacts={frequentPhoneContacts}
      pickContact={pickContact}
      filteredPhoneContacts={filteredPhoneContacts}
      submitNewNumber={submitNewNumber}
      recipientLookupAbortRef={recipientLookupAbortRef}
      recipientLookupSequenceRef={recipientLookupSequenceRef}
      recipientLookupInFlightRef={recipientLookupInFlightRef}
      setRecipientLookupLoading={setRecipientLookupLoading}
      setRecipientId={setRecipientId}
      setRecipientQrId={setRecipientQrId}
      setRecipientName={setRecipientName}
      setRecipientPhone={setRecipientPhone}
      setManualRecipientMode={setManualRecipientMode}
      setNewNumber={setNewNumber}
      newNumber={newNumber}
      recipientProviderLoading={recipientProviderLoading}
      recipientLookupLoading={recipientLookupLoading}
      recipientId={recipientId}
      recipientQrId={recipientQrId}
      recipientName={recipientName}
      setPhoneIsEditing={setPhoneIsEditing}
      phoneIsEditing={phoneIsEditing}
      recipientPhone={recipientPhone}
      recipientDisplayReference={recipientDisplayReference}
      setRecipientFromQr={setRecipientFromQr}
      setRecipientProviders={setRecipientProviders}
      setRecipientIsNewNumber={setRecipientIsNewNumber}
      setDestination={setDestination}
      amount={amount}
      setAmount={setAmount}
      message={message}
      setMessage={setMessage}
      yapearEnabled={yapearEnabled}
      transferSubmitting={transferSubmitting}
      requestOtherBanks={requestOtherBanks}
      requestYapear={requestYapear}
      isNewNumber={isNewNumber}
      chooseEntity={chooseEntity}
      confirmationClosing={confirmationClosing}
      closeConfirmation={closeConfirmation}
      confirmDialogRef={confirmDialogRef}
      voucherRecipientName={voucherRecipientName}
      amountValue={amountValue}
      destination={destination}
      confirmTransfer={confirmTransfer}
      voucherCaptureRef={voucherCaptureRef}
      voucherShareFile={voucherShareFile}
      shareTransferVoucher={shareTransferVoucher}
      formattedDate={formattedDate}
      formattedTime={formattedTime}
      voucherHero={voucherHero}
      hideVoucherSecurity={hideVoucherSecurity}
      voucher={voucher}
      insufficientBalance={insufficientBalance}
      insufficientDialogRef={insufficientDialogRef}
      availableBalance={availableBalance}
      setInsufficientBalance={setInsufficientBalance}
    />
  );
}
