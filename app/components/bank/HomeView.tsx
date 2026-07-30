"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  fetchStoredMovements,
  HISTORY_CLEARED_EVENT,
  MOVEMENT_HISTORY_CLEARED_KEY,
  movements,
  SimpleMovementList,
} from "../BankApp";
import { useModalLayer } from "../../hooks/useModalLayer";
import { fetchAccountBalance } from "../../lib/balance-cache";
import { HomeBannerCarousel } from "./HomeBannerCarousel";
import { AssetIcon, LottiePlayer } from "./primitives";
import { MovementVoucher } from "./MovementVoucher";
import type {
  Movement,
  MovementHistoryItem,
  ServiceItem,
} from "./types";

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

const allServicesSections: Array<{ title: string; items: ServiceItem[] }> = [
  {
    title: "Yapeos",
    items: [
      {
        label: "Recargar celular",
        iconSrc: "/assets/icons/recargar-celular.svg",
        href: "/recargar",
      },
      {
        label: "Yapear servicios",
        iconSrc: "/assets/icons/yapear-servicios.svg",
        href: "/servicios",
      },
      {
        label: "Código de aprobación",
        iconSrc: "/assets/icons/aprobar-compras.svg",
        href: "/aprobar-compras",
      },
      {
        label: "Giro/retiro de efectivo",
        iconSrc: "/assets/captured/all-services/giro-retiro.jpg",
      },
      {
        label: "Dólares",
        iconSrc: "/assets/icons/dolares.svg",
      },
    ],
  },
  {
    title: "Finanzas",
    items: [
      {
        label: "Créditos",
        iconSrc: "/assets/captured/all-services/credito.svg",
        href: "/creditos",
      },
      {
        label: "Seguros",
        iconSrc: "/assets/captured/all-services/seguros.svg",
      },
      {
        label: "SOAT",
        iconSrc: "/assets/icons/soat.svg",
        href: "/seguro-vehicular",
      },
      { label: "Remesas", iconSrc: "/assets/icons/remesas.svg" },
      {
        label: "Aprende con Yape",
        iconSrc: "/assets/captured/all-services/aprende-yape.svg",
      },
    ],
  },
  {
    title: "Compras",
    items: [
      {
        label: "Viajar en bus",
        iconSrc: VIAJAR_BUS_ICON,
        href: "/recargar-transportes",
      },
      { label: "Tienda", iconSrc: "/assets/icons/tienda.svg" },
      {
        label: "Entradas",
        iconSrc: "/assets/captured/all-services/entradas.jpg",
      },
      { label: "Gaming", iconSrc: "/assets/captured/all-services/gaming.jpg" },
      { label: "Promos", iconSrc: "/assets/icons/promos.svg" },
      {
        label: "Delivery",
        iconSrc: "/assets/captured/all-services/delivery.jpg",
      },
      {
        label: "Pedir gas",
        iconSrc: "/assets/captured/all-services/pedir-gas.jpg",
      },
    ],
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

function AllServicesSheet({
  closing,
  onClose,
}: {
  closing: boolean;
  onClose: () => void;
}) {
  const dragStartY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dialogRef = useModalLayer<HTMLElement>(true, onClose);

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const shouldClose = dragOffset > 70;
    dragStartY.current = null;
    setDragging(false);
    setDragOffset(0);
    if (shouldClose) onClose();
  }

  function itemContent(item: ServiceItem) {
    return (
      <>
        <span className="all-services-item-icon" aria-hidden="true">
          {item.iconLottie ? (
            <LottiePlayer name={item.iconLottie} />
          ) : (
            <img src={item.iconSrc} alt="" />
          )}
        </span>
        <strong>{item.label}</strong>
      </>
    );
  }

  return (
    <section
      ref={dialogRef}
      className={`all-services-sheet${closing ? " is-closing" : ""}${dragging ? " is-dragging" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Todos los servicios"
      tabIndex={-1}
      style={{ "--all-services-drag": `${dragOffset}px` } as CSSProperties}
    >
      <button
        className="all-services-drag-handle"
        type="button"
        aria-label="Deslizar para cerrar todos los servicios"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStartY.current = event.clientY;
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (dragStartY.current === null) return;
          setDragOffset(Math.max(0, event.clientY - dragStartY.current));
        }}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <span />
      </button>
      <div className="all-services-content">
        {allServicesSections.map((section) => (
          <section className="all-services-section" key={section.title}>
            <h2>{section.title}</h2>
            <div className="all-services-grid">
              {section.items.map((item) =>
                item.href && !DISABLED_SERVICE_HREFS.has(item.href) ? (
                  <Link
                    className="all-services-item"
                    href={item.href}
                    key={item.label}
                  >
                    {itemContent(item)}
                  </Link>
                ) : (
                  <button
                    className="all-services-item"
                    type="button"
                    key={item.label}
                  >
                    {itemContent(item)}
                  </button>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

export function HomeView() {
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
  const [showAllServices, setShowAllServices] = useState(false);
  const [closingAllServices, setClosingAllServices] = useState(false);
  const allServicesCloseTimer = useRef<number | null>(null);

  const closeAllServices = useCallback(() => {
    if (closingAllServices) return;
    setClosingAllServices(true);
    allServicesCloseTimer.current = window.setTimeout(() => {
      setShowAllServices(false);
      setClosingAllServices(false);
      allServicesCloseTimer.current = null;
    }, 650);
  }, [closingAllServices]);

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

  useEffect(() => {
    if (!showAllServices) return;
    const scrollArea = document.querySelector(
      ".mobile-bank-shell.view-home .bank-scroll-area",
    ) as HTMLElement | null;
    const previousScrollTop = scrollArea?.scrollTop ?? 0;
    if (scrollArea) scrollArea.scrollTop = 0;
    return () => {
      if (scrollArea) scrollArea.scrollTop = previousScrollTop;
    };
  }, [showAllServices]);

  useEffect(
    () => () => {
      if (allServicesCloseTimer.current !== null)
        window.clearTimeout(allServicesCloseTimer.current);
    },
    [],
  );

  function openAllServices() {
    if (allServicesCloseTimer.current !== null)
      window.clearTimeout(allServicesCloseTimer.current);
    setClosingAllServices(false);
    setShowAllServices(true);
  }

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
    <div className="reference-home">
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
      {showAllServices ? (
        <AllServicesSheet
          closing={closingAllServices}
          onClose={closeAllServices}
        />
      ) : null}
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
