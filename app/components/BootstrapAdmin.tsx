"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function BootstrapAdmin() {
  const router = useRouter();
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: data.get("secret"),
        sellerCode: data.get("sellerCode"),
        username: data.get("username"),
        displayName: data.get("displayName"),
        email: data.get("email"),
        password: data.get("password"),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      setMessage(String(payload.error ?? "No se pudo crear el administrador."));
      return;
    }
    sessionStorage.setItem("yape-unlocked", "1");
    router.replace("/api/admin/portal");
  }

  return (
    <main className="management-stage">
      <section className="management-card">
        <h1>Configurar administrador</h1>
        <p>Este paso se usa una sola vez. Tu Telegram ID sera el ID administrador y el ID vendedor principal.</p>
        <form onSubmit={submit} className="management-form">
          <input name="secret" placeholder="Clave de configuracion" type="password" required />
          <input name="sellerCode" placeholder="Telegram ID administrador" autoComplete="off" inputMode="numeric" pattern="[0-9]{4,20}" required />
          <input name="username" placeholder="Usuario" defaultValue="admin" required />
          <input name="displayName" placeholder="Nombre visible" defaultValue="Administrador" required />
          <input name="email" placeholder="Correo" type="email" />
          <input name="password" placeholder="Codigo de 6 digitos" type="password" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required />
          <button type="submit">Crear administrador</button>
        </form>
        {message ? <p className="management-alert">{message}</p> : null}
      </section>
    </main>
  );
}
