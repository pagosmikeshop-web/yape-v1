"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { safeApiMessage, safeClientMessage } from "../../lib/client-error";
import { PAYMENT_PROVIDERS, type PaymentProvider } from "../../lib/payment-providers";
import { AssetIcon } from "./primitives";
import { GlobalDirectoryTermsDialog } from "./GlobalDirectoryTermsDialog";

const GLOBAL_DIRECTORY_TERMS_VERSION = "global-recipient-v1";

type RecipientContact = {
  id: string;
  phone: string;
  displayName: string;
  provider: PaymentProvider;
  source: "manual" | "qr";
  status: "active" | "revoked";
  updatedAt: string;
};

const INVALID_PHONE_MESSAGE = "El número de celular es obligatorio y debe tener 9 dígitos.";

function normalizePhoneInput(value: string) {
  return value
    .replace(/\D/gu, "")
    .replace(/^51(?=9)/u, "")
    .slice(0, 9);
}

export function RecipientContactsView() {
  const [contacts, setContacts] = useState<RecipientContact[]>([]);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<PaymentProvider>("Yape");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/account/recipient-contacts", { cache: "no-store" });
      const data = (await response.json()) as {
        contacts?: RecipientContact[];
        error?: string;
      };
      if (!response.ok || !Array.isArray(data.contacts)) {
        throw new Error(safeApiMessage(data.error, "No pudimos cargar tu autocompletado."));
      }
      setContacts(data.contacts);
    } catch (error) {
      setMessage(safeClientMessage(error, "No pudimos cargar tu autocompletado."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadContacts();
  }, [loadContacts]);

  function requestPublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    if (!/^9\d{8}$/u.test(phone)) {
      setMessage(INVALID_PHONE_MESSAGE);
      return;
    }
    if (name.trim().length < 2) {
      setMessage("Ingresa el nombre del destinatario.");
      return;
    }
    setMessage("");
    setTermsOpen(true);
  }

  async function publishContact() {
    if (saving) return;
    if (!/^9\d{8}$/u.test(phone)) {
      setTermsOpen(false);
      setMessage(INVALID_PHONE_MESSAGE);
      return;
    }
    setTermsOpen(false);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/account/recipient-contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          phone,
          name,
          provider,
          termsAccepted: true,
          termsVersion: GLOBAL_DIRECTORY_TERMS_VERSION,
        }),
      });
      const data = (await response.json()) as {
        contact?: RecipientContact;
        error?: string;
      };
      if (!response.ok || !data.contact) {
        throw new Error(safeApiMessage(data.error, "No pudimos registrar el autocompletado."));
      }
      setPhone("");
      setName("");
      setProvider("Yape");
      setMessage("Autocompletado registrado.");
      await loadContacts();
    } catch (error) {
      setMessage(safeClientMessage(error, "No pudimos registrar el autocompletado."));
    } finally {
      setSaving(false);
    }
  }

  async function removeContact(contact: RecipientContact) {
    if (!window.confirm(`¿Retirar el registro de ${contact.displayName}?`)) return;
    setMessage("");
    try {
      const response = await fetch(
        `/api/account/recipient-contacts/${encodeURIComponent(contact.id)}`,
        { method: "DELETE" },
      );
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(safeApiMessage(data.error, "No pudimos retirar el registro."));
      }
      setContacts((current) => current.filter((item) => item.id !== contact.id));
      setMessage("Registro retirado.");
    } catch (error) {
      setMessage(safeClientMessage(error, "No pudimos retirar el registro."));
    }
  }

  return (
    <div className="account-details-screen account-payment-only-screen recipient-contacts-screen">
      <header className="account-details-topbar">
        <Link href="/datos-cuenta" aria-label="Volver a Mis datos">
          <AssetIcon name="ic_arrow_left_yape" />
        </Link>
        <div>
          <small>PARA YAPEAR</small>
          <strong>Autocompletado Free</strong>
        </div>
        <span className="account-details-lock">
          <AssetIcon name="ic_person_outline_yape" />
        </span>
      </header>

      <section className="account-payment-only-hero">
        <div>
          <h1>Registrar Autocompletado</h1>
        </div>
        <span className="account-details-hero-icon">
          <AssetIcon name="ic_person_outline_yape" />
        </span>
      </section>

      <section className="account-details-block recipient-contact-block">
        <div className="account-details-block-title">
          <span>NUEVO REGISTRO</span>
          <h2>Agregar teléfono y nombre</h2>
        </div>
        <form className="account-payment-data-card" onSubmit={requestPublish} noValidate>
          <div className="account-payment-data-fields">
            <label className="account-details-field">
              <span>Número de celular</span>
              <div>
                <AssetIcon name="ic_phone_outline_yape_primary" />
                <input
                  value={phone}
                  onChange={(event) => setPhone(normalizePhoneInput(event.target.value))}
                  inputMode="numeric"
                  placeholder="9XXXXXXXX"
                  autoComplete="tel"
                  maxLength={9}
                  required
                />
              </div>
            </label>
            <label className="account-details-field">
              <span>Nombre del destinatario</span>
              <div>
                <AssetIcon name="ic_person_outline_yape" />
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 80))}
                  placeholder="Ej. Laura Quispe"
                  autoComplete="name"
                  required
                  minLength={2}
                />
              </div>
            </label>
            <label className="account-details-field recipient-provider-field">
              <span>App / Banco de destino</span>
              <div>
                <AssetIcon name="ic_duotone_money_arrows_around" />
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as PaymentProvider)}
                  aria-label="App o banco de destino"
                >
                  {PAYMENT_PROVIDERS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </label>
          </div>
          <div className="account-payment-data-actions">
            <button type="submit" disabled={saving}>
              {saving ? "Registrando…" : "Registrar"}
            </button>
          </div>
        </form>
      </section>

      <section className="account-details-block recipient-qr-block">
        <div className="account-details-block-title">
          <span>CÓDIGO QR</span>
          <h2>Añadir un QR con cámara</h2>
        </div>
        <article className="account-payment-data-card recipient-qr-card">
          <div className="account-payment-data-heading">
            <span className="account-setting-icon is-teal">
              <AssetIcon name="ic_qrcode_r_yape_primary" />
            </span>
            <div>
              <strong>Escanea y registra un QR</strong>
            </div>
          </div>
          <Link className="recipient-qr-link" href="/mi-qr">
            <AssetIcon name="ic_add_photo_outline_yape" />
            Abrir cámara para añadir QR
          </Link>
        </article>
      </section>

      <section className="account-details-block recipient-contact-list-block" aria-labelledby="recipient-list-title">
        <div className="account-details-block-title">
          <span>TUS REGISTROS</span>
          <h2 id="recipient-list-title">Autocompletados registrados</h2>
        </div>
        {loading ? <p className="recipient-contact-empty">Cargando registros…</p> : null}
        {!loading && contacts.length === 0 ? (
          <p className="recipient-contact-empty">Aún no tienes registros.</p>
        ) : null}
        <div className="recipient-contact-list">
          {contacts.map((contact) => (
            <article className="recipient-contact-item" key={contact.id}>
              <div>
                <strong>{contact.displayName}</strong>
                <span>
                  {contact.phone} · {contact.provider} · {contact.status === "active" ? "Activo" : "Retirado"}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void removeContact(contact)}
                aria-label={`Retirar registro de ${contact.displayName}`}
              >
                Retirar
              </button>
            </article>
          ))}
        </div>
      </section>

      {message ? (
        <p className="account-payment-data-message recipient-contact-message" role="status">
          {message}
        </p>
      ) : null}

      <GlobalDirectoryTermsDialog
        open={termsOpen}
        onCancel={() => setTermsOpen(false)}
        onAccept={() => void publishContact()}
      />
    </div>
  );
}
