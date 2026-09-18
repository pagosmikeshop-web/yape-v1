"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearSessionCache, setOptimisticUnlock } from "../../lib/session-cache";
import { AssetIcon, LottiePlayer } from "./primitives";

function ProfileMenuItem({
  icon,
  animatedIcon,
  label,
  href,
  badge,
  onClick,
  disabled = false,
}: {
  icon?: string;
  animatedIcon?: string;
  label: string;
  href?: string;
  badge?: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const content = (
    <>
      <span className="profile-row-icon">
        {animatedIcon ? (
          <LottiePlayer
            name={animatedIcon}
            className="profile-row-lottie"
            loop
            autoplay
          />
        ) : icon ? (
          <AssetIcon name={icon} />
        ) : null}
      </span>
      <strong>{label}</strong>
      {badge ? <small className="profile-row-badge">{badge}</small> : null}
    </>
  );
  return href ? (
    <Link className="profile-menu-row" href={href}>
      {content}
    </Link>
  ) : (
    <button
      className="profile-menu-row"
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      {content}
    </button>
  );
}

export function ProfileView() {
  const router = useRouter();

  async function logout() {
    clearSessionCache();
    setOptimisticUnlock(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
  }

  return (
    <div className="reference-profile">
      <div className="profile-safe-strip" />
      <header className="profile-heading">
        <Link
          href="/inicio"
          className="profile-back"
          aria-label="Volver al inicio"
        >
          <AssetIcon name="ic_arrow_left_yape" />
        </Link>
        <div>
          <h1>Mi Perfil</h1>
        </div>
        <Link className="profile-help-link" href="/ayuda">
          <AssetIcon name="ic_headphone_outline_yape" />
          <span>Ayuda</span>
        </Link>
      </header>

      <section className="profile-menu-section">
        <h2>Mi cuenta</h2>
        <ProfileMenuItem
          icon="ic_dni_outline_yape_primary"
          label="Mis datos"
          href="/datos-cuenta"
        />
        <ProfileMenuItem
          icon="ic_qrcode_r_yape_primary"
          label="Mi QR"
          href="/mi-qr"
        />
        <ProfileMenuItem
          icon="ic_location_r_yape_primary"
          label="Mis direcciones"
          onClick={() => undefined}
        />
        <ProfileMenuItem
          icon="ic_broken_heart_outline_yape_primary"
          label="Eliminar mi cuenta"
          disabled
        />
      </section>

      <section className="profile-menu-section profile-settings-section">
        <h2>Ajustes</h2>
        <ProfileMenuItem
          icon="ic_lock_outline_yape_primary"
          label="Biometría digital"
          href="/biometria"
        />
        <ProfileMenuItem
          icon="ic_credit_card_outline_yape_primary"
          label="Compras por internet y POS"
          onClick={() => undefined}
        />
        <ProfileMenuItem
          icon="ic_info_outline_yape_primary"
          label="Confirmación de yapeo alto"
          onClick={() => undefined}
        />
        <ProfileMenuItem
          icon="ic_bar_chart_outline_yape_primary"
          label="Límites Transaccionales"
          onClick={() => undefined}
        />
        <ProfileMenuItem
          icon="ic_bell_r_yape_primary"
          label="Notificaciones por yapeo"
          onClick={() => undefined}
        />
      </section>

      <footer className="profile-footer">
        <p>
          <strong>Versión Yape:</strong> 3.66.1
        </p>
        <p>
          <strong>Tipo de cuenta:</strong> Yape con BCP
        </p>
        <p>
          <strong>Banco de Crédito del Perú</strong>
        </p>
        <p>
          <strong>RUC:</strong> 20100047218
        </p>
        <button type="button">
          <AssetIcon name="ic_document_outline_yape_primary" />
          Términos y condiciones
        </button>
        <button type="button">
          <AssetIcon name="ic_lock_outline_yape_primary" />
          Política de privacidad
        </button>
        <button type="button" onClick={logout}>
          <AssetIcon name="ic_sign_out_r_yape_primary" />
          Cerrar sesión
        </button>
      </footer>
    </div>
  );
}
