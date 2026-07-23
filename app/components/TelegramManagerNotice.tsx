export function TelegramManagerNotice({ role }: { role: "admin" | "seller" }) {
  return (
    <main className="telegram-manager-page">
      <section className="telegram-manager-card" aria-labelledby="telegram-manager-title">
        <span className="telegram-manager-badge">Manager seguro</span>
        <h1 id="telegram-manager-title">La gestion se realiza desde Telegram</h1>
        <p>
          {role === "admin"
            ? "Desde el bot puedes crear vendedores y clientes, asignar creditos, activar cuentas y aprobar restablecimientos."
            : "Desde el bot puedes crear y activar tus clientes, consultar creditos y aprobar sus restablecimientos."}
        </p>
        <div className="telegram-manager-help">
          Abre un chat privado con el bot y envia <strong>/start</strong> para ver los comandos disponibles.
        </div>
        <a href="/inicio" className="telegram-manager-back">Volver a la aplicacion</a>
      </section>
    </main>
  );
}
