"use client";

import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import { authErrorMessage, createAuthAttemptId } from "../../lib/auth-client";
import { safeApiMessage } from "../../lib/client-error";
import { clearLocalRegistrationAnchor, hasLocalRegistrationAnchor } from "../../lib/registration-device";
import type { Notice, Screen, TelegramValidationPhase } from "./types";

const TELEGRAM_MIN_LOADING_MS = 240;
const TELEGRAM_RESOLVE_MS = 700;
const TELEGRAM_OUTCOME_SETTLE_MS = 620;

type AuthPost = (
  path: string,
  payload: Record<string, unknown>,
  attemptId?: string,
) => Promise<Record<string, unknown>>;

export function useTelegramRegistrationValidation({
  screen,
  fingerprintId,
  formRef,
  busy,
  authActionInFlightRef,
  setBusy,
  setNotice,
  post,
}: {
  screen: Screen;
  fingerprintId: string;
  formRef: RefObject<HTMLFormElement | null>;
  busy: boolean;
  authActionInFlightRef: { current: boolean };
  setBusy: Dispatch<SetStateAction<boolean>>;
  setNotice: Dispatch<SetStateAction<Notice>>;
  post: AuthPost;
}) {
  const [registerAllowed, setRegisterAllowed] = useState(false);
  const [telegramValidationPhase, setTelegramValidationPhase] = useState<TelegramValidationPhase>("idle");
  const [groupInviteUrl, setGroupInviteUrl] = useState("/api/telegram/group");
  const telegramMotionSequenceRef = useRef(0);

  useEffect(() => () => {
    telegramMotionSequenceRef.current += 1;
  }, []);

  function resetTelegramRegistrationValidation() {
    setRegisterAllowed(false);
    telegramMotionSequenceRef.current += 1;
    setTelegramValidationPhase("idle");
  }

  async function verifyTelegramForRegister() {
    if (screen !== "register" || busy || authActionInFlightRef.current || telegramValidationPhase === "success") return;
    authActionInFlightRef.current = true;
    const motionSequence = ++telegramMotionSequenceRef.current;
    const motionStartedAt = performance.now();
    const isCurrentMotion = () => motionSequence === telegramMotionSequenceRef.current;
    const waitForMotion = async (duration: number) => {
      if (duration > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, duration));
      }
      return isCurrentMotion();
    };
    const waitForMinimumLoading = () => waitForMotion(Math.max(0, TELEGRAM_MIN_LOADING_MS - (performance.now() - motionStartedAt)));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTelegramValidationPhase("loading");
    setBusy(true);
    setNotice(null);
    const attemptId = createAuthAttemptId();
    try {
      if (!fingerprintId) throw new Error("Espera la validacion del dispositivo.");
      const telegramId = String(new FormData(formRef.current ?? undefined).get("telegram-id") ?? "");
      const data = await post("/api/auth/register/status", { telegramUserId: telegramId, fingerprintId }, attemptId);
      if (!isCurrentMotion()) return;
      setGroupInviteUrl(String(data.groupInviteUrl ?? ""));
      if (!data.allowed) {
        throw new Error(safeApiMessage(data.error, "Aun no puedes registrarte."));
      }
      // Si el servidor liberó el dispositivo (p. ej. cuenta eliminada), limpia el ancla local.
      if (await hasLocalRegistrationAnchor(fingerprintId)) {
        await clearLocalRegistrationAnchor().catch(() => undefined);
      }
      if (!await waitForMinimumLoading()) return;
      if (!reducedMotion) {
        setTelegramValidationPhase("resolving");
        if (!await waitForMotion(TELEGRAM_RESOLVE_MS)) return;
      }
      if (!isCurrentMotion()) return;
      setRegisterAllowed(true);
      setTelegramValidationPhase("success");
      setNotice({ text: "Telegram confirmado. Ya puedes crear tu cuenta.", tone: "info" });
      if (!reducedMotion && !await waitForMotion(TELEGRAM_OUTCOME_SETTLE_MS)) return;
    } catch (error) {
      if (!await waitForMinimumLoading()) return;
      if (!isCurrentMotion()) return;
      if (!reducedMotion) {
        setTelegramValidationPhase("error-resolving");
        if (!await waitForMotion(TELEGRAM_RESOLVE_MS)) return;
      }
      if (!isCurrentMotion()) return;
      setRegisterAllowed(false);
      setTelegramValidationPhase("error");
      setNotice({ text: authErrorMessage(error, "No se pudo validar Telegram."), tone: "error" });
      if (!reducedMotion && !await waitForMotion(TELEGRAM_OUTCOME_SETTLE_MS)) return;
    } finally {
      authActionInFlightRef.current = false;
      if (isCurrentMotion()) setBusy(false);
    }
  }

  return {
    clearRegistrationPermission: () => setRegisterAllowed(false),
    groupInviteUrl,
    registerAllowed,
    resetTelegramRegistrationValidation,
    telegramValidationPhase,
    verifyTelegramForRegister,
  };
}
