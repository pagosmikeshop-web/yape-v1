"use client";

import { useEffect, useRef, useState } from "react";
import { createVoucherImage, shareVoucherImage } from "./MovementVoucher";
import type { TransferVoucher } from "./TransferStageViews";
import {
  REFERENCE_VOUCHER_MAX_SCALE,
  useVoucherScale,
} from "./useVoucherScale";
import type { Dispatch, SetStateAction } from "react";
import type { TransferStage } from "./types";

type UseTransferVoucherInput = {
  stage: TransferStage;
  setNotice: Dispatch<SetStateAction<string>>;
};

export function useTransferVoucher({
  stage,
  setNotice,
}: UseTransferVoucherInput) {
  const [voucher, setVoucher] = useState<TransferVoucher | null>(null);
  const [voucherShareFile, setVoucherShareFile] = useState<File | null>(null);
  const voucherCaptureRef = useRef<HTMLDivElement>(null);
  useVoucherScale(
    voucherCaptureRef,
    stage === "success",
    REFERENCE_VOUCHER_MAX_SCALE,
  );

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
  }, [stage, voucher, setNotice]);

  async function shareTransferVoucher() {
    if (!voucher) return;
    if (!voucherShareFile) {
      setNotice(
        "Preparando la imagen. Intenta compartir nuevamente en un momento.",
      );
      return;
    }
    try {
      await shareVoucherImage(voucherShareFile);
      setNotice("");
    } catch {
      setNotice("No se pudo compartir el comprobante.");
    }
  }

  return {
    voucher,
    setVoucher,
    voucherShareFile,
    voucherCaptureRef,
    shareTransferVoucher,
  };
}
