"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import styles from "./InvitationScreen.module.css";

type RedeemResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
};

export function InvitationScreen() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [ready, setReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const hashParameters = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
    const queryParameters = new URLSearchParams(window.location.search);
    const invitationToken = hashParameters.get("token") ?? queryParameters.get("token") ?? "";

    // Remove the secret from the visible URL and browser history as soon as it
    // has been copied into component memory.
    if (window.location.hash || window.location.search) {
      window.history.replaceState(null, "", window.location.pathname);
    }

    const revealForm = window.setTimeout(() => {
      setToken(invitationToken);
      setReady(true);
    }, 0);
    return () => window.clearTimeout(revealForm);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || success) return;
    setError("");

    if (!token) {
      setError("Abre el enlace completo que te entregó tu administrador.");
      return;
    }
    if (password.length < 8 || password.length > 128) {
      setError("Usa una contraseña de 8 a 128 caracteres.");
      return;
    }
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/invitations/redeem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ token, password, confirmPassword: confirmation }),
      });
      const data = await response.json() as RedeemResponse;
      if (!response.ok || !data.ok) throw new Error(data.error || "No se pudo activar la cuenta.");

      setToken("");
      setPassword("");
      setConfirmation("");
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo activar la cuenta.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!ready) {
    return (
      <main className={styles.stage} aria-busy="true">
        <section className={styles.card}><p className={styles.status}>Preparando activación…</p></section>
      </main>
    );
  }

  return (
    <main className={styles.stage}>
      <section className={styles.card} aria-labelledby="invitation-title">
        <div className={styles.brandMark} aria-hidden="true">MB</div>
        <p className={styles.eyebrow}>Yape</p>
        <h1 id="invitation-title">{success ? "Cuenta preparada" : "Activa tu cuenta"}</h1>

        {success ? (
          <div className={styles.success} role="status">
            <span className={styles.successIcon} aria-hidden="true">✓</span>
            <p>Tu contraseña fue creada correctamente.</p>
            <small>Por seguridad, inicia sesión desde tu dispositivo. Este enlace ya no puede volver a usarse.</small>
            <Link className={styles.primaryLink} href="/">Ir a iniciar sesión</Link>
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit} noValidate>
            <p className={styles.intro}>
              Elige una contraseña personal. La invitación vence en 24 horas y funciona una sola vez.
            </p>

            {!token && (
              <p className={styles.error} role="alert">
                El enlace está incompleto. Solicita una invitación nueva.
              </p>
            )}

            <label className={styles.field}>
              <span>Nueva contraseña</span>
              <div className={styles.passwordControl}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                  disabled={submitting || !token}
                />
                <button type="button" onClick={() => setShowPassword((visible) => !visible)} disabled={submitting}>
                  {showPassword ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <small>Entre 8 y 128 caracteres.</small>
            </label>

            <label className={styles.field}>
              <span>Confirma tu contraseña</span>
              <input
                type={showPassword ? "text" : "password"}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                minLength={8}
                maxLength={128}
                autoComplete="new-password"
                required
                disabled={submitting || !token}
              />
            </label>

            {error && <p className={styles.error} role="alert">{error}</p>}

            <button className={styles.submit} type="submit" disabled={submitting || !token}>
              {submitting ? "Guardando…" : "Crear contraseña"}
            </button>
            <p className={styles.securityNote}>Yape nunca te pedirá compartir esta contraseña.</p>
          </form>
        )}
      </section>
    </main>
  );
}
