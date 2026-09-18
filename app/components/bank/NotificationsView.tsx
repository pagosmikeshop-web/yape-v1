import { InnerHeader } from "./InnerHeader";
import { AssetIcon, AssetIllustration } from "./primitives";

export function NotificationsView() {
  return (
    <div className="notifications-view">
      <InnerHeader title="Notificaciones" compact />
      <section className="notification-group">
        <h2>Yape para ti</h2>
        <article>
          <AssetIllustration name="sp_fullcolor_bell_disable" />
          <div>
            <strong>Aún no tenemos novedades para ti.</strong>
          </div>
        </article>
      </section>
      <section className="notification-group">
        <h2>Consejos</h2>
        <article>
          <AssetIcon name="ic_eye_r_yape_primary" />
          <div>
            <strong>Ordena mejor tu dinero</strong>
            <span>¡Descubre cómo hacerlo!</span>
          </div>
        </article>
      </section>
      <section className="notification-group">
        <h2>Comunicados</h2>
        <article>
          <AssetIcon name="ic_star_outline_yape_primary" />
          <div>
            <strong>Conoce Buen Provecho</strong>
            <span>Historias con sazón aquí</span>
          </div>
        </article>
      </section>
    </div>
  );
}
