"use client";

import Link from "next/link";
import { formatAccountBalance } from "../../lib/money";
import { maskPhone } from "../../lib/masked-phone";
import type { RecipientProviderActions } from "../../lib/recipient-providers";
import {
  formatVoucherAmount,
  isYapeDestination,
  VoucherSinglePromo,
} from "./MovementVoucher";
import { APK_ASSET_ROOT, AssetIcon, LottiePlayer } from "./primitives";
import type { PhoneContact, TransferStage } from "./types";
import type { Dispatch, FormEvent, SetStateAction } from "react";
export type TransferVoucher = {
  code: string;
  operation: string;
  completedAt: Date;
};

export function financialEntityLabel(entity: string) {
  return entity.replace(/!$/u, "");
}

export function formatEditablePhone(phone: string) {
  const digits = phone.replace(/\D/g, "").slice(0, 9);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ");
}

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

type MutableValueRef<T> = { current: T };

type TransferStageViewsProps = {
  stage: TransferStage;
  showAmountScreen: boolean;
  providerActions: RecipientProviderActions;
  showEntitiesScreen: boolean;
  availableEntities: string[];
  notice: string;
  contactSearch: string;
  setContactSearch: Dispatch<SetStateAction<string>>;
  cancelFrequentProviderLookup: () => void;
  setStage: Dispatch<SetStateAction<TransferStage>>;
  contactPickerSupported: boolean;
  requestPhoneContacts: () => void | Promise<void>;
  contactsLoading: boolean;
  phoneContacts: PhoneContact[];
  frequentPhoneContacts: PhoneContact[];
  pickContact: (name: string, phone: string) => void;
  filteredPhoneContacts: PhoneContact[];
  submitNewNumber: (event: FormEvent<HTMLFormElement>) => void;
  recipientLookupAbortRef: MutableValueRef<AbortController | null>;
  recipientLookupSequenceRef: MutableValueRef<number>;
  recipientLookupInFlightRef: MutableValueRef<boolean>;
  setRecipientLookupLoading: Dispatch<SetStateAction<boolean>>;
  setRecipientId: Dispatch<SetStateAction<string>>;
  setRecipientQrId: Dispatch<SetStateAction<string>>;
  setRecipientName: Dispatch<SetStateAction<string>>;
  setRecipientPhone: Dispatch<SetStateAction<string>>;
  setManualRecipientMode: Dispatch<SetStateAction<boolean>>;
  setNewNumber: Dispatch<SetStateAction<string>>;
  newNumber: string;
  recipientProviderLoading: boolean;
  recipientLookupLoading: boolean;
  recipientId: string;
  recipientQrId: string;
  recipientName: string;
  setPhoneIsEditing: Dispatch<SetStateAction<boolean>>;
  phoneIsEditing: boolean;
  recipientPhone: string;
  recipientDisplayReference: string;
  setRecipientFromQr: Dispatch<SetStateAction<boolean>>;
  setRecipientProviders: Dispatch<SetStateAction<string[]>>;
  setRecipientIsNewNumber: Dispatch<SetStateAction<boolean>>;
  setDestination: Dispatch<SetStateAction<string>>;
  amount: string;
  setAmount: Dispatch<SetStateAction<string>>;
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  yapearEnabled: boolean;
  transferSubmitting: boolean;
  requestOtherBanks: () => void;
  requestYapear: () => void;
  isNewNumber: boolean;
  chooseEntity: (entity: string) => void;
  confirmationClosing: boolean;
  closeConfirmation: () => void;
  confirmDialogRef: MutableValueRef<HTMLDivElement | null>;
  voucherRecipientName: string;
  amountValue: number;
  destination: string;
  confirmTransfer: () => void;
  voucherCaptureRef: MutableValueRef<HTMLDivElement | null>;
  voucherShareFile: File | null;
  shareTransferVoucher: () => void | Promise<void>;
  formattedDate: string;
  formattedTime: string;
  voucherHero: string;
  hideVoucherSecurity: boolean;
  voucher: TransferVoucher | null;
  insufficientBalance: boolean;
  insufficientDialogRef: MutableValueRef<HTMLDivElement | null>;
  availableBalance: number | null;
  setInsufficientBalance: Dispatch<SetStateAction<boolean>>;
};
export function TransferStageViews({
  stage,
  showAmountScreen,
  providerActions,
  showEntitiesScreen,
  availableEntities,
  notice,
  contactSearch,
  setContactSearch,
  cancelFrequentProviderLookup,
  setStage,
  contactPickerSupported,
  requestPhoneContacts,
  contactsLoading,
  phoneContacts,
  frequentPhoneContacts,
  pickContact,
  filteredPhoneContacts,
  submitNewNumber,
  recipientLookupAbortRef,
  recipientLookupSequenceRef,
  recipientLookupInFlightRef,
  setRecipientLookupLoading,
  setRecipientId,
  setRecipientQrId,
  setRecipientName,
  setRecipientPhone,
  setManualRecipientMode,
  setNewNumber,
  newNumber,
  recipientProviderLoading,
  recipientLookupLoading,
  recipientId,
  recipientQrId,
  recipientName,
  setPhoneIsEditing,
  phoneIsEditing,
  recipientPhone,
  recipientDisplayReference,
  setRecipientFromQr,
  setRecipientProviders,
  setRecipientIsNewNumber,
  setDestination,
  amount,
  setAmount,
  message,
  setMessage,
  yapearEnabled,
  transferSubmitting,
  requestOtherBanks,
  requestYapear,
  isNewNumber,
  chooseEntity,
  confirmationClosing,
  closeConfirmation,
  confirmDialogRef,
  voucherRecipientName,
  amountValue,
  destination,
  confirmTransfer,
  voucherCaptureRef,
  voucherShareFile,
  shareTransferVoucher,
  formattedDate,
  formattedTime,
  voucherHero,
  hideVoucherSecurity,
  voucher,
  insufficientBalance,
  insufficientDialogRef,
  availableBalance,
  setInsufficientBalance,
}: TransferStageViewsProps) {
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
              onClick={() => {
                cancelFrequentProviderLookup();
                setStage("new-number");
              }}
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
                      cancelFrequentProviderLookup();
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
                        cancelFrequentProviderLookup();
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
            aria-busy={recipientLookupLoading || recipientProviderLoading}
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
                    aria-label="Nombre o razón social del destinatario"
                    placeholder="Nombre o razón social"
                    value={recipientName}
                    maxLength={80}
                    readOnly={Boolean(recipientId || recipientQrId)}
                    onChange={(event) =>
                      setRecipientName(event.target.value.slice(0, 80))
                    }
                  />
                )}
              </div>
              <input
                className="transfer-recipient-phone-input"
                aria-label="Número del destinatario"
                inputMode="numeric"
                value={
                  phoneIsEditing && !recipientId && !recipientQrId
                    ? formatEditablePhone(recipientPhone)
                    : recipientDisplayReference
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
                  cancelFrequentProviderLookup();
                  recipientLookupSequenceRef.current += 1;
                  recipientLookupInFlightRef.current = false;
                  setRecipientLookupLoading(false);
                  setRecipientId("");
                  setRecipientQrId("");
                  setRecipientFromQr(false);
                  setRecipientProviders(["Yape"]);
                  setRecipientName("");
                  setManualRecipientMode(false);
                  setRecipientIsNewNumber(true);
                  setRecipientPhone(formatEditablePhone(event.target.value));
                  setDestination("Yape");
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
            <div
              className="transfer-amount-actions"
              aria-busy={recipientProviderLoading}
            >
              {providerActions.showOtherBanks ||
              recipientLookupLoading ||
              recipientProviderLoading ? (
                <button
                  type="button"
                  className="transfer-secondary-button"
                  onClick={requestOtherBanks}
                  disabled={
                    !yapearEnabled ||
                    recipientProviderLoading ||
                    transferSubmitting
                  }
                >
                  Otros bancos
                </button>
              ) : null}
              {providerActions.directYapear ? (
                <button
                  type="button"
                  className="transfer-primary-button transfer-full-width-button"
                  onClick={requestYapear}
                  disabled={
                    !yapearEnabled ||
                    recipientProviderLoading ||
                    transferSubmitting
                  }
                >
                  {transferSubmitting ? "Validando…" : "Yapear"}
                </button>
              ) : null}
            </div>
          </div>
          {stage === "amount-processing" ? (
            <LoadingOverlay text="Yapeando..." />
          ) : null}
        </section>
      ) : null}

      {showEntitiesScreen ? (
        <section className="transfer-entities-screen">
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
            <h1 className="entity-screen-title">Yapear a</h1>
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
            <div className="entity-screen-divider" aria-hidden="true" />
            <h2 className="transfer-section-title">
              Selecciona una entidad financiera
            </h2>
            <div className="entities-list">
              {availableEntities.length > 0 ? (
                availableEntities.map((entity) => (
                  <button
                    type="button"
                    className="entity-row"
                    key={entity}
                    onClick={() => chooseEntity(entity)}
                  >
                    <span className="entity-icon">
                      <AssetIcon name="ic_duotone_money_arrows_around" />
                    </span>
                    <strong>{financialEntityLabel(entity)}</strong>
                  </button>
                ))
              ) : (
                <p className="empty-state">
                  No hay otros bancos configurados para este número.
                </p>
              )}
            </div>
          </div>

          {stage === "confirm" ? (
            <div
              className={`transfer-confirm-overlay${
                confirmationClosing ? " is-closing" : ""
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="transfer-confirm-title"
              onClick={(event) => {
                if (event.target === event.currentTarget) closeConfirmation();
              }}
            >
              <div
                ref={confirmDialogRef}
                className="transfer-confirm-modal"
                tabIndex={-1}
              >
                <span className="entity-icon confirm-modal-icon">
                  <AssetIcon name="ic_duotone_money_arrows_around" />
                </span>
                <p>Vas a yapear a:</p>
                <h2 id="transfer-confirm-title">{voucherRecipientName}</h2>
                <div className="transfer-confirm-warning">
                  <span className="transfer-confirm-warning-icon">i</span>
                  <span>
                    Este tipo de yapeo puede necesitar más tiempo para llegar a
                    la entidad destino.
                  </span>
                </div>
                <div className="transfer-confirm-summary">
                  <div>
                    <span>Monto:</span>
                    <strong>S/ {amountValue.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Destino:</span>
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
                  onClick={closeConfirmation}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}

          {stage === "confirm-processing" ? (
            <LoadingOverlay text="Yapeando..." />
          ) : null}
        </section>
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

                {hideVoucherSecurity ? (
                  <div
                    className="voucher-divider voucher-divider-izipay"
                    aria-hidden="true"
                  />
                ) : null}

                {!hideVoucherSecurity ? <div className="voucher-security">
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
                </div> : null}

                <div className="voucher-details">
                  <span className="voucher-section-label">
                    DATOS DE LA TRANSACCIÓN
                  </span>
                  {isYapeDestination(destination) && recipientDisplayReference ? (
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
                  : `S/ ${formatAccountBalance(availableBalance)}`}
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
