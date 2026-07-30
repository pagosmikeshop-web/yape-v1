"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fetchStoredMovements,
  HISTORY_CLEARED_EVENT,
  MOVEMENT_HISTORY_CLEARED_KEY,
  movements,
  SimpleMovementList,
} from "../BankApp";
import { fetchAccountBalance } from "../../lib/balance-cache";
import { settleIOSViewport } from "../../lib/ios-viewport";
import { HomeBannerCarousel } from "./HomeBannerCarousel";
import { AssetIcon, LottiePlayer } from "./primitives";
import { MovementVoucher } from "./MovementVoucher";
import type { Movement, MovementHistoryItem, ServiceItem } from "./types";

const VIAJAR_BUS_ICON = "/assets/captured/all-services/viajar-bus.jpg";

// Estas secciones permanecen visibles en el inicio, pero están pausadas hasta
// que se configure su contenido. Conservamos las rutas para no romper enlaces
// existentes fuera de esta pantalla.
const DISABLED_SERVICE_HREFS = new Set([
  "/recargar",
  "/servicios",
  "/aprobar-compras",
  "/creditos",
  "/dolares",
  "/seguro-vehicular",
  "/recargar-transportes",
]);

const serviceItems: ServiceItem[] = [
  {
    label: "Recargar celular",
    iconSrc: "/assets/icons/recargar-celular.svg",
  },
  {
    label: "Yapear servicios",
    iconSrc: "/assets/icons/yapear-servicios.svg",
  },
  { label: "Promos", iconSrc: "/assets/icons/promos.svg" },
  {
    label: "Aprobar compras",
    iconSrc: "/assets/icons/aprobar-compras.svg",
  },
  {
    label: "Créditos",
    iconLottie: "ic_lending_animated_001",
    fullTile: true,
  },
  { label: "Gaming", iconSrc: "/assets/icons/gaming.svg", badge: "Juega" },
  { label: "Dólares", iconSrc: "/assets/icons/dolares.svg", href: "/dolares" },
  { label: "Remesas", iconSrc: "/assets/icons/remesas.svg" },
  {
    label: "SOAT",
    iconSrc: "/assets/icons/soat.svg",
    href: "/seguro-vehicular",
  },
  {
    label: "Tienda",
    iconLottie: "ic_tienda_cyber_animated_001",
    fullTile: true,
  },
  { label: "Viajar en bus", iconSrc: VIAJAR_BUS_ICON, href: "/recargar-transportes" },
  {
    label: "Ver todo",
    iconSrc: "/assets/icons/ver-todo.svg",
    fullTile: true,
    frameless: true,
  },
];

function ServiceTile({
  item,
  onUnavailable,
}: {
  item: ServiceItem;
  onUnavailable: (label: string) => void;
}) {
  const [showLottie, setShowLottie] = useState(false);
  const hasVisual = Boolean(item.iconSrc || item.iconLottie || item.sticker);

  useEffect(() => {
    if (!item.iconLottie) return;
    let cancelled = false;
    const start = () => {
      if (!cancelled) setShowLottie(true);
    };
    let idleId: number | undefined;
    let timeoutId: number | undefined;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(start, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(start, 400);
    }
    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [item.iconLottie]);

  const content = (
    <>
      <span
        className={`service-icon home-menu-icon${item.fullTile ? " is-full-tile" : ""}${item.frameless ? " is-frameless" : ""}${hasVisual ? "" : " is-missing"}`}
        aria-hidden="true"
      >
        {item.iconLottie && showLottie ? (
          <LottiePlayer name={item.iconLottie} />
        ) : null}
        {item.iconSrc && !item.iconLottie ? (
          <img src={item.iconSrc} alt="" decoding="async" loading="lazy" />
        ) : null}
        {item.iconLottie && !showLottie && item.iconSrc ? (
          <img src={item.iconSrc} alt="" decoding="async" />
        ) : null}
        {item.sticker ? (
          <span className="home-menu-sticker">{item.sticker}</span>
        ) : null}
        {item.badge ? <small>{item.badge}</small> : null}
      </span>
      <strong>{item.label}</strong>
    </>
  );

  if (item.href && !DISABLED_SERVICE_HREFS.has(item.href)) {
    return (
      <Link className="home-service" href={item.href}>
        {content}
      </Link>
    );
  }

  return (
    <button
      className="home-service"
      type="button"
      onClick={() => onUnavailable(item.label)}
    >
      {content}
    </button>
  );
}

export function HomeView() {
  const homeRootRef = useRef<HTMLDivElement>(null);
  const [showBalance, setShowBalance] = useState(false);
  const [showMovements, setShowMovements] = useState(false);
  const [accountBalance, setAccountBalance] = useState<number | null>(null);
  const [historyCleared, setHistoryCleared] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(MOVEMENT_HISTORY_CLEARED_KEY) === "1",
  );
  const [storedMovements, setStoredMovements] = useState<MovementHistoryItem[]>(
    [],
  );
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(
    null,
  );

  useLayoutEffect(() => {
    const scrollContainer =
      homeRootRef.current?.closest<HTMLElement>(".bank-scroll-area") ?? null;

    return settleIOSViewport(scrollContainer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchAccountBalance().then((result) => {
      if (!cancelled && result.ok) setAccountBalance(result.balance);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    function refreshMovements() {
      void fetchStoredMovements()
        .then((result) => {
          if (cancelled) return;
          setHistoryCleared(result.historyCleared);
          setStoredMovements(result.movements);
          window.localStorage.setItem(
            MOVEMENT_HISTORY_CLEARED_KEY,
            result.historyCleared ? "1" : "0",
          );
        })
        .catch(() => undefined);
    }
    refreshMovements();
    window.addEventListener(HISTORY_CLEARED_EVENT, refreshMovements);
    return () => {
      cancelled = true;
      window.removeEventListener(HISTORY_CLEARED_EVENT, refreshMovements);
    };
  }, []);

  if (selectedMovement) {
    return (
      <MovementVoucher
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
      />
    );
  }

  const visibleHomeMovements: Movement[] = [
    ...storedMovements,
    ...(historyCleared ? [] : movements),
  ].slice(0, 5);

  return (
    <div className="reference-home" ref={homeRootRef}>
      <section className="home-purple-zone">
        <header className="reference-home-header">
          <Link
            href="/perfil"
            className="round-header-action"
            aria-label="Abrir mi perfil"
          >
            <AssetIcon name="ic_person_solid_yape_on_primary" />
          </Link>
          <form
            className="home-search"
            onSubmit={(event) => event.preventDefault()}
          >
            <AssetIcon name="ic_search_yape_on_primary" />
            <input aria-label="Buscar en Yape" placeholder="Buscar en Yape" />
          </form>
          <Link
            className="round-header-action"
            href="/ayuda"
            aria-label="Ayuda"
          >
            <AssetIcon name="ic_headphone_solid_yape_on_primary" />
          </Link>
          <Link
            href="/notificaciones"
            className="round-header-action"
            aria-label="Notificaciones"
          >
            <AssetIcon name="ic_bell_b_yape_on_primary" />
          </Link>
        </header>

        <div className="home-services-grid" aria-label="Servicios de Yape">
          {serviceItems.map((item) => (
            <ServiceTile
              item={item}
              key={item.label}
              onUnavailable={() => undefined}
            />
          ))}
        </div>

        <HomeBannerCarousel />
      </section>

      <section className="home-account-sheet">
        <div className={`account-disclosure${showBalance ? " is-open" : ""}`}>
          <button
            type="button"
            aria-expanded={showBalance}
            onClick={() => setShowBalance((current) => !current)}
          >
            <AssetIcon
              name={
                showBalance
                  ? "ic_eye_slash_b_yape_primary"
                  : "ic_eye_b_yape_primary"
              }
            />
            <strong>{showBalance ? "Ocultar saldo" : "Mostrar saldo"}</strong>
            {showBalance ? (
              <span>
                {accountBalance === null
                  ? ""
                  : `S/ ${accountBalance.toFixed(2)}`}
              </span>
            ) : null}
          </button>
        </div>

        <div
          className={`account-disclosure movements-disclosure${showMovements ? " is-open" : ""}`}
        >
          <button
            type="button"
            aria-expanded={showMovements}
            onClick={() => setShowMovements((current) => !current)}
          >
            <AssetIcon name="ic_list_b_yape" />
            <strong>
              {showMovements ? "Ocultar movimientos" : "Mostrar movimientos"}
            </strong>
            <AssetIcon
              name="ic_chevron_down_yape"
              className="disclosure-chevron"
            />
          </button>
          <div className="disclosure-content" aria-hidden={!showMovements}>
            {visibleHomeMovements.length === 0 ? (
              <div className="cleared-movements-empty">
                <AssetIcon name="ic_list_b_yape" />
                <span>No tienes yapeos guardados.</span>
              </div>
            ) : (
              <>
                <SimpleMovementList
                  items={visibleHomeMovements}
                  onSelect={setSelectedMovement}
                />
                <Link className="all-movements-link" href="/movimientos">
                  Ver todos
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
      <HomeMainActions />
    </div>
  );
}

export function HomeMainActions() {
  return (
    <div className="home-main-actions" role="navigation" aria-label="Acciones principales">
      <Link href="/escanear-qr" className="outline-teal-action">
        <AssetIcon name="ic_qr_code_outline_yape_secondary" />
        Escanear QR
      </Link>
      <Link href="/transferir" className="solid-teal-action">
        <AssetIcon name="ic_send_outline_yape_on_secondary" />
        Yapear
      </Link>
    </div>
  );
}
