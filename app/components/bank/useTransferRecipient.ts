"use client";

import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import {
  normalizePaymentProvider,
} from "../../lib/payment-providers";
import {
  normalizeRecipientProviders,
} from "../../lib/recipient-providers";
import { QR_TRANSFER_SESSION_KEY } from "../../lib/qr-scanning";
import {
  lookupRecipientById,
  lookupRecipientByPhone,
} from "../../lib/recipient-lookup-client";
import type { Dispatch, SetStateAction } from "react";
import type { TransferStage } from "./types";

const normalizeRecipientPhone = (value: string) => value.replace(/\D/gu, "");

export function normalizeMobileNumber(value: string) {
  const digits = normalizeRecipientPhone(value);
  const localNumber = digits.length > 9 ? digits.slice(-9) : digits;
  if (localNumber.length !== 9) return "";
  return localNumber.replace(/(\d{3})(\d{3})(\d{3})/, "$1 $2 $3");
}

type UseTransferRecipientInput = {
  stage: TransferStage;
  setStage: Dispatch<SetStateAction<TransferStage>>;
  newNumber: string;
  setNotice: Dispatch<SetStateAction<string>>;
  setNewNumber: Dispatch<SetStateAction<string>>;
};

export function useTransferRecipient({
  stage,
  setStage,
  newNumber,
  setNotice,
  setNewNumber,
}: UseTransferRecipientInput) {
  const [recipientId, setRecipientId] = useState("");
  const [recipientQrId, setRecipientQrId] = useState("");
  const [recipientFromQr, setRecipientFromQr] = useState(false);
  const [recipientProviders, setRecipientProviders] = useState<string[]>(["Yape"]);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientIsNewNumber, setRecipientIsNewNumber] = useState(false);
  const [phoneIsEditing, setPhoneIsEditing] = useState(false);
  const [destination, setDestination] = useState("Yape");
  const [recipientLookupLoading, setRecipientLookupLoading] = useState(false);
  const [recipientProviderLoading, setRecipientProviderLoading] = useState(false);
  const [manualRecipientMode, setManualRecipientMode] = useState(false);
  const recipientLookupAbortRef = useRef<AbortController | null>(null);
  const recipientLookupSequenceRef = useRef(0);
  const recipientLookupInFlightRef = useRef(false);
  const frequentProviderLookupAbortRef = useRef<AbortController | null>(null);
  const frequentProviderLookupSequenceRef = useRef(0);

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
      const requestedProvider = normalizePaymentProvider(payload.provider);
      const requestedRecipientId = typeof payload.recipientId === "string"
        ? payload.recipientId.trim()
        : "";
      const requestedPhone = requestedProvider === "Yape" && typeof payload.phone === "string"
        ? normalizeRecipientPhone(payload.phone).slice(-9)
        : "";
      const requestedName = typeof payload.displayName === "string"
        ? payload.displayName.trim().slice(0, 48)
        : "";
      if (!requestedName || (!requestedQrId && !requestedRecipientId && !/^9\d{8}$/u.test(requestedPhone))) return;

      setRecipientQrId(requestedQrId);
      setRecipientFromQr(true);
      setRecipientProviders([requestedProvider]);
      setRecipientId(requestedRecipientId);
      setRecipientName(requestedName);
      setRecipientPhone(requestedPhone);
      setRecipientIsNewNumber(false);
      setManualRecipientMode(false);
      setPhoneIsEditing(false);
      setDestination(requestedProvider);
      setNotice("");
      setStage("amount");
    } catch {
      // Un payload QR corrupto no debe impedir usar la transferencia manual.
    }
  }, [setNotice, setStage]);

  useEffect(() => {
    const requestedRecipientId =
      new URLSearchParams(window.location.search).get("recipient") ?? "";
    if (!requestedRecipientId) return;

    let cancelled = false;
    lookupRecipientById(requestedRecipientId)
      .then(({ response, data }) => {
        if (
          !response.ok ||
          !data.recipient?.id ||
          !data.recipient.displayName
        ) {
          throw new Error(
            safeApiMessage(data.error, "No encontramos al destinatario de este QR."),
          );
        }
        return data.recipient as {
          id: string;
          displayName: string;
          phone?: string;
          provider?: string;
          providers?: string[];
        };
      })
      .then((recipient) => {
        if (cancelled) return;
        setRecipientQrId("");
        setRecipientFromQr(true);
        setRecipientId(recipient.id);
        setRecipientName(recipient.displayName);
        setRecipientPhone(
          recipient.phone ? normalizeMobileNumber(recipient.phone) : "",
        );
        setRecipientIsNewNumber(false);
        setManualRecipientMode(false);
        const provider = normalizePaymentProvider(recipient.provider);
        const providers = normalizeRecipientProviders(recipient.providers, provider);
        setRecipientProviders(providers);
        setDestination(providers[0]);
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
  }, [setNotice, setStage]);

  function enableManualRecipientFallback(phone: string) {
    setRecipientProviderLoading(false);
    setRecipientId("");
    setRecipientQrId("");
    setRecipientFromQr(false);
    setRecipientProviders(["Yape"]);
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

    const normalizedPhone = normalizeRecipientPhone(recipientPhone);
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
        const { response, data } = await lookupRecipientByPhone(
          normalizedPhone,
          { signal: controller.signal },
        );

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
        setRecipientFromQr(false);
        setRecipientName(data.recipient.displayName);
        setRecipientPhone(normalizeMobileNumber(data.recipient.phone));
        setManualRecipientMode(false);
        setRecipientIsNewNumber(false);
        setPhoneIsEditing(false);
        const provider = normalizePaymentProvider(data.recipient.provider);
        const providers = normalizeRecipientProviders(data.recipient.providers, provider);
        setRecipientProviders(providers);
        setDestination(providers[0]);
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
    setNotice,
  ]);

  function cancelFrequentProviderLookup() {
    frequentProviderLookupAbortRef.current?.abort();
    frequentProviderLookupAbortRef.current = null;
    frequentProviderLookupSequenceRef.current += 1;
    setRecipientProviderLoading(false);
  }

  function pickContact(name: string, phone: string) {
    const normalizedPhone = normalizeMobileNumber(phone);
    cancelFrequentProviderLookup();
    const requestSequence = frequentProviderLookupSequenceRef.current + 1;
    frequentProviderLookupSequenceRef.current = requestSequence;
    setRecipientId("");
    setRecipientQrId("");
    setRecipientFromQr(false);
    setRecipientProviders(["Yape"]);
    setRecipientName(name.trim());
    setRecipientPhone(normalizedPhone || phone);
    setManualRecipientMode(false);
    setRecipientIsNewNumber(false);
    setPhoneIsEditing(false);
    setDestination("Yape");
    setNewNumber("");
    setNotice("");
    setRecipientProviderLoading(Boolean(normalizedPhone));
    setStage("amount");

    if (!normalizedPhone) return;

    const controller = new AbortController();
    frequentProviderLookupAbortRef.current = controller;
    const lookupPhone = normalizeRecipientPhone(normalizedPhone);

    void lookupRecipientByPhone(lookupPhone, {
      configuredOnly: true,
      signal: controller.signal,
    })
      .then(({ response, data }) => {
        if (!response.ok || !data.recipient) return null;
        return data.recipient;
      })
      .then((recipient) => {
        if (
          !recipient ||
          requestSequence !== frequentProviderLookupSequenceRef.current
        ) {
          return;
        }
        const provider = normalizePaymentProvider(recipient.provider);
        const providers = normalizeRecipientProviders(recipient.providers, provider);
        setRecipientProviders(providers);
        setDestination(providers[0]);
        setNotice("");
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      })
      .finally(() => {
        if (requestSequence !== frequentProviderLookupSequenceRef.current) return;
        setRecipientProviderLoading(false);
        frequentProviderLookupAbortRef.current = null;
      });
  }

  function submitNewNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedPhone = normalizeRecipientPhone(newNumber);
    if (!/^9\d{8}$/u.test(normalizedPhone)) {
      setNotice("Ingresa un número de celular válido de 9 dígitos.");
      return;
    }
    recipientLookupAbortRef.current?.abort();
    cancelFrequentProviderLookup();
    recipientLookupSequenceRef.current += 1;
    recipientLookupInFlightRef.current = false;
    setRecipientLookupLoading(false);
    setNotice("");
    setRecipientId("");
    setRecipientQrId("");
    setRecipientFromQr(false);
    setRecipientProviders(["Yape"]);
    setRecipientName("");
    setRecipientPhone(normalizedPhone);
    setManualRecipientMode(false);
    setRecipientIsNewNumber(true);
    setPhoneIsEditing(false);
    setDestination("Yape");
    // La consulta del titular se inicia al montar la pantalla de monto.
    setStage("amount");
  }

  useEffect(() => () => {
    recipientLookupAbortRef.current?.abort();
    recipientLookupSequenceRef.current += 1;
    recipientLookupInFlightRef.current = false;
    frequentProviderLookupAbortRef.current?.abort();
    frequentProviderLookupSequenceRef.current += 1;
  }, []);

  return {
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
  };
}
