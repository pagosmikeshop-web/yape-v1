"use client";

/**
 * Boundary de interfaz: los detalles de una excepción se registran en el
 * servidor, nunca se renderizan en el navegador.
 */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main
      role="alert"
      style={{
        boxSizing: "border-box",
        minHeight: "100dvh",
        padding: "max(24px, env(safe-area-inset-top, 0px)) 24px max(24px, env(safe-area-inset-bottom, 0px))",
        display: "grid",
        placeItems: "center",
        background: "#742284",
        color: "#fff",
        textAlign: "center",
      }}
    >
      <section>
        <h1 style={{ margin: 0, fontSize: "clamp(1.5rem, 5vw, 2.25rem)" }}>Algo salió mal</h1>
        <p style={{ margin: "12px 0 24px", maxWidth: 420 }}>
          No pudimos cargar esta pantalla. Inténtalo nuevamente.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: 44,
            padding: "0 24px",
            border: 0,
            borderRadius: 999,
            background: "#fff",
            color: "#742284",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </section>
    </main>
  );
}
