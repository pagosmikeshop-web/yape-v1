"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ManagerRole = "admin" | "seller";

type ManagedClient = {
  id: string;
  seller_code: string;
  username: string;
  display_name: string;
  email: string;
  phone_e164: string | null;
  status: "pending" | "active" | "disabled";
  created_at: string;
  activated_at: string | null;
  referral_code: string | null;
  access_expires_at: string | null;
  owner_id: string | null;
};

type ManagedSeller = {
  id: string;
  seller_code: string;
  username: string;
  display_name: string;
  email: string;
  status: "pending" | "active" | "disabled";
  credits: number;
  created_at: string;
};

type ClientsResponse = {
  clients?: ManagedClient[];
  credits?: number;
  error?: string;
};

type UsersResponse = {
  users?: Array<ManagedSeller & { role: "admin" | "seller" | "client" }>;
  error?: string;
};

type InvitationDetails = {
  activationUrl: string;
  expiresAt: string;
};

async function responseData<T>(response: Response) {
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo completar la operación.");
  return data;
}

function displayPhone(value: string | null) {
  const digits = (value ?? "").replace(/\D/g, "").slice(-9);
  return digits.length === 9 ? digits.replace(/(\d{3})(\d{3})(\d{3})/u, "$1 $2 $3") : "Sin número";
}

function displayDate(value: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

export function ClientManager({ role }: { role: ManagerRole }) {
  const router = useRouter();
  const [clients, setClients] = useState<ManagedClient[]>([]);
  const [sellers, setSellers] = useState<ManagedSeller[]>([]);
  const [credits, setCredits] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null);
  const [permanentToken, setPermanentToken] = useState<{ token: string; clientName: string } | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [data, usersData] = await Promise.all([
        responseData<ClientsResponse>(await fetch("/api/seller/clients", { cache: "no-store" })),
        role === "admin"
          ? responseData<UsersResponse>(await fetch("/api/admin/users", { cache: "no-store" }))
          : Promise.resolve<UsersResponse>({ users: [] }),
      ]);
      setClients(data.clients ?? []);
      setCredits(Number(data.credits ?? 0));
      setSellers((usersData.users ?? []).filter((user) => user.role === "seller"));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "No se pudo cargar la lista de clientes.";
      setError(message);
      if (/autorizado|sesión|session/iu.test(message)) router.replace("/");
    } finally {
      setLoading(false);
    }
  }, [role, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadClients(), 0);
    return () => window.clearTimeout(timer);
  }, [loadClients]);

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusyId("create");
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const data = await responseData<{ message?: string; invitation?: InvitationDetails }>(await fetch("/api/seller/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellerCode: String(formData.get("sellerCode") ?? ""),
          username: String(formData.get("username") ?? ""),
          displayName: String(formData.get("displayName") ?? ""),
          email: String(formData.get("email") ?? ""),
          phone: String(formData.get("phone") ?? ""),
        }),
      }));
      setNotice(data.message || "Cliente creado correctamente.");
      setInvitation(data.invitation ?? null);
      form.reset();
      await loadClients();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo crear el cliente.");
    } finally {
      setBusyId("");
    }
  }

  async function createSeller(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusyId("create-seller");
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const data = await responseData<{ message?: string; invitation?: InvitationDetails }>(await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sellerCode: String(formData.get("sellerCode") ?? ""),
          username: String(formData.get("username") ?? ""),
          displayName: String(formData.get("displayName") ?? ""),
          email: String(formData.get("email") ?? ""),
        }),
      }));
      setNotice(data.message || "Vendedor creado correctamente.");
      setInvitation(data.invitation ?? null);
      form.reset();
      await loadClients();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "No se pudo crear el vendedor.");
    } finally {
      setBusyId("");
    }
  }

  async function addCredits(event: FormEvent<HTMLFormElement>, seller: ManagedSeller) {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = Number(new FormData(form).get("amount") ?? 0);
    setBusyId(`credits-${seller.id}`);
    setError("");
    setNotice("");
    try {
      const data = await responseData<{ message?: string }>(await fetch(`/api/admin/sellers/${seller.id}/credits`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ amount }),
      }));
      setNotice(data.message || "Créditos asignados.");
      form.reset();
      await loadClients();
    } catch (creditError) {
      setError(creditError instanceof Error ? creditError.message : "No se pudieron asignar los créditos.");
    } finally {
      setBusyId("");
    }
  }

  async function activateClient(client: ManagedClient) {
    setBusyId(client.id);
    setError("");
    setNotice("");
    try {
      const data = await responseData<{ message?: string; credits?: number }>(await fetch(`/api/seller/clients/${client.id}/activate`, {
        method: "POST",
      }));
      setNotice(data.message || "Cliente activado.");
      if (typeof data.credits === "number") setCredits(data.credits);
      await loadClients();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "No se pudo activar el cliente.");
    } finally {
      setBusyId("");
    }
  }

  async function issuePermanentToken(client: ManagedClient) {
    setBusyId(`token-${client.id}`);
    setError("");
    setNotice("");
    setPermanentToken(null);
    try {
      const data = await responseData<{ token: string; clientName: string; credits: number; message?: string }>(await fetch("/api/seller/access-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      }));
      setPermanentToken({ token: data.token, clientName: data.clientName });
      setCredits(Number(data.credits));
      setNotice(data.message || "Token permanente creado.");
      await loadClients();
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : "No se pudo crear el token permanente.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <main className="client-manager-page">
      <section className="client-manager-shell">
        <header className="client-manager-header">
          <div><span>YAPE</span><h1>Gestión de clientes</h1></div>
          <div className="client-manager-header-actions">
            {role === "seller" ? <strong>{credits} créditos</strong> : <strong>Administrador</strong>}
            <Link href="/inicio">Volver</Link>
          </div>
        </header>

        {role === "admin" ? (
          <section className="client-manager-section" aria-labelledby="seller-management-title">
            <form className="client-manager-form" onSubmit={createSeller}>
              <div className="client-manager-form-title">
                <h2 id="seller-management-title">Nuevo vendedor</h2>
                <p>El vendedor podrá registrar clientes y definirá su propia contraseña mediante una invitación privada.</p>
              </div>
              <label>Telegram ID del vendedor<input name="sellerCode" required inputMode="numeric" pattern="[0-9]{4,20}" maxLength={20} /></label>
              <label>Usuario<input name="username" required minLength={3} maxLength={40} autoComplete="off" /></label>
              <label>Nombre completo<input name="displayName" required minLength={2} maxLength={80} autoComplete="name" /></label>
              <label>Correo opcional<input name="email" type="email" autoComplete="email" /></label>
              <button type="submit" disabled={busyId === "create-seller"}>{busyId === "create-seller" ? "Creando..." : "Crear vendedor"}</button>
            </form>

            <section className="client-manager-list seller-manager-list">
              <div className="client-manager-list-heading"><h2>Vendedores</h2><span>{sellers.length} registrados</span></div>
              {sellers.length === 0 ? <p className="client-manager-empty">Todavía no hay vendedores registrados.</p> : null}
              {sellers.map((seller) => (
                <article className="client-manager-item seller-manager-item" key={seller.id}>
                  <span className="client-manager-avatar">{seller.display_name.trim().slice(0, 2).toUpperCase()}</span>
                  <div>
                    <strong>{seller.display_name}</strong>
                    <small>{seller.seller_code} · @{seller.username}</small>
                  </div>
                  <strong className="seller-credit-balance">{seller.credits} créditos</strong>
                  <form className="seller-credit-form" onSubmit={(event) => void addCredits(event, seller)}>
                    <input name="amount" type="number" min={1} max={10000} step={1} placeholder="Cantidad" aria-label={`Créditos para ${seller.display_name}`} required />
                    <button type="submit" disabled={Boolean(busyId)}>{busyId === `credits-${seller.id}` ? "Asignando..." : "Asignar"}</button>
                  </form>
                </article>
              ))}
            </section>
          </section>
        ) : null}

        <form className="client-manager-form" onSubmit={createClient}>
          <div className="client-manager-form-title"><h2>Nuevo cliente</h2><p>El número registrado permitirá mostrar su nombre al transferir y generar su QR personal.</p></div>
          {role === "admin" ? <label>Telegram ID del vendedor<input name="sellerCode" required inputMode="numeric" pattern="[0-9]{4,20}" minLength={4} maxLength={20} /></label> : null}
          <label>Usuario<input name="username" required minLength={3} maxLength={40} autoComplete="off" /></label>
          <label>Nombre completo<input name="displayName" required minLength={2} maxLength={80} autoComplete="name" /></label>
          <label>Número celular<input name="phone" required inputMode="numeric" pattern="9[0-9]{8}" maxLength={9} placeholder="900000000" /></label>
          <label>Correo opcional<input name="email" type="email" autoComplete="email" /></label>
          <button type="submit" disabled={busyId === "create"}>{busyId === "create" ? "Creando..." : "Crear cliente"}</button>
        </form>

        {notice ? <p className="client-manager-notice is-success" role="status">{notice}</p> : null}
        {error ? <p className="client-manager-notice is-error" role="alert">{error}</p> : null}
        {invitation ? (
          <section className="client-invitation" aria-labelledby="client-invitation-title">
            <div>
              <strong id="client-invitation-title">Invitación de un solo uso</strong>
              <small>Compártela por un canal privado. No contiene ninguna contraseña y vence en 24 horas.</small>
            </div>
            <input value={invitation.activationUrl} readOnly aria-label="Enlace de invitación" />
            <button type="button" onClick={() => void navigator.clipboard.writeText(invitation.activationUrl)}>Copiar enlace</button>
          </section>
        ) : null}

        {permanentToken ? (
          <section className="client-invitation" aria-labelledby="permanent-token-title">
            <div>
              <strong id="permanent-token-title">Token permanente para {permanentToken.clientName}</strong>
              <small>Se muestra una sola vez. Entrégalo únicamente a este cliente.</small>
            </div>
            <input value={permanentToken.token} readOnly aria-label="Token de acceso permanente" />
            <button type="button" onClick={() => void navigator.clipboard.writeText(permanentToken.token)}>Copiar token</button>
          </section>
        ) : null}

        <section className="client-manager-list" aria-busy={loading}>
          <div className="client-manager-list-heading"><h2>Clientes</h2><button type="button" onClick={() => void loadClients()} disabled={loading}>Actualizar</button></div>
          {loading ? <p className="client-manager-empty">Cargando clientes...</p> : null}
          {!loading && clients.length === 0 ? <p className="client-manager-empty">Todavía no hay clientes registrados.</p> : null}
          {clients.map((client) => (
            <article className="client-manager-item" key={client.id}>
              <span className="client-manager-avatar">{client.display_name.trim().slice(0, 2).toUpperCase()}</span>
              <div>
                <strong>{client.display_name}</strong>
                {client.referral_code ? <small>Codigo: {client.referral_code}</small> : null}
                {client.status === "active" ? <small>{client.access_expires_at ? `Acceso hasta: ${displayDate(client.access_expires_at)}` : "Acceso permanente"}</small> : null}
                <small>{displayPhone(client.phone_e164)} · @{client.username}</small>
                {role === "admin" ? <small>Vendedor: {client.seller_code}</small> : null}
              </div>
              <span className={`client-status is-${client.status}`}>{client.status === "active" ? "Activo" : client.status === "pending" ? "Pendiente" : "Deshabilitado"}</span>
              {client.status === "pending" ? <button type="button" onClick={() => void activateClient(client)} disabled={Boolean(busyId)}>{busyId === client.id ? "Activando..." : "Activar"}</button> : null}
              {client.status === "active" && client.access_expires_at ? <button type="button" onClick={() => void issuePermanentToken(client)} disabled={Boolean(busyId)}>{busyId === `token-${client.id}` ? "Creando..." : "Crear token"}</button> : null}
            </article>
          ))}
        </section>

      </section>
    </main>
  );
}
