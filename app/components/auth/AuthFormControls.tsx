"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthAssetIcon } from "./AuthVisuals";
import type { Screen } from "./types";

export function Field({
  id,
  label,
  type = "text",
  autoComplete = "off",
  inputMode,
  maxLength,
  minLength,
  pattern,
  sanitize,
  required = true,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "email" | "numeric" | "text";
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  sanitize?: (value: string) => string;
  required?: boolean;
}) {
  return (
    <div className="field">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        autoCapitalize="none"
        spellCheck="false"
        placeholder={label}
        maxLength={maxLength}
        minLength={minLength}
        pattern={pattern}
        onInput={sanitize ? (event) => {
          const sanitized = sanitize(event.currentTarget.value);
          if (sanitized !== event.currentTarget.value) event.currentTarget.value = sanitized;
        } : undefined}
        required={required}
      />
    </div>
  );
}

export function PasswordField({ id, label, autoComplete }: { id: string; label: string; autoComplete: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="field password-field">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        placeholder={label}
        minLength={6}
        required
      />
      <button
        className="password-toggle"
        type="button"
        aria-controls={id}
        aria-label={visible ? `Ocultar ${label}` : `Mostrar ${label}`}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}

export function AuthHeader({ screen, onRefresh }: { screen: Screen; onRefresh: () => void }) {
  return (
    <header className="login-header">
      {screen === "login" ? <span className="header-spacer" aria-hidden="true" /> : (
        <Link className="back-button" href="/" aria-label="Volver a iniciar sesión"><AuthAssetIcon name="ic_arrow_left_yape_on_primary" /></Link>
      )}
      {screen === "login" ? (
        <button className="refresh-button" type="button" onClick={onRefresh} aria-label="Actualizar formulario"><AuthAssetIcon name="ic_refresh_yape_on_primary" /></button>
      ) : <span className="header-spacer" aria-hidden="true" />}
    </header>
  );
}
