"use client";
/* eslint-disable @next/next/no-img-element -- extracted APK assets must keep their exact native proportions */

import Link from "next/link";
import {
  CSSProperties,
  KeyboardEvent,
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
import { fetchAccountBalance } from "../../lib/balance-cache";
import { AssetIcon, LottiePlayer } from "./primitives";
import { MovementVoucher } from "./MovementVoucher";
import type {
  Movement,
  MovementHistoryItem,
  PromoBanner,
  ServiceItem,
} from "./types";

const serviceItems: ServiceItem[] = [
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
  { label: "Promos", iconSrc: "/assets/icons/promos.svg" },
  {
    label: "Aprobar compras",
    iconSrc: "/assets/icons/aprobar-compras.svg",
    href: "/aprobar-compras",
  },
  {
    label: "Créditos",
    iconLottie: "ic_lending_animated_001",
    href: "/creditos",
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
  { label: "Viajar en bus", iconSrc: "/assets/icons/remesas.svg" },
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
        href: "/dolares",
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
        iconSrc: "/assets/captured/all-services/viajar-bus.jpg",
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

const HOME_BANNER_DWELL_MS = 4000;
const HOME_BANNER_TRANSITION_MS = 500;
const HOME_BANNER_CYCLE_MS = HOME_BANNER_DWELL_MS + HOME_BANNER_TRANSITION_MS;

const homeBanners: PromoBanner[] = [
  {
    id: "h-fondo-1",
    src: "/assets/captured/home/h_fondo1.jpg",
    alt: "Beneficio disponible en Yape",
  },
  {
    id: "h-fondo-2",
    src: "/assets/captured/home/h_fondo2.jpg",
    alt: "Promoción disponible en Yape",
  },
  {
    id: "h-fondo-3",
    src: "/assets/captured/home/h_fondo3.jpg",
    alt: "Compras por internet con Yape",
  },
  {
    id: "h-fondo-4",
    src: "/assets/captured/home/h_fondo4.jpg",
    alt: "Recarga con Yape",
  },
  {
    id: "h-fondo-5",
    src: "/assets/captured/home/h_fondo5.jpg",
    alt: "Cyber Yape",
  },
  {
    id: "h-fondo-6",
    src: "/assets/captured/home/h_fondo6.jpg",
    alt: "Buen Provecho en Yape",
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

  if (item.href) {
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
      className={`all-services-sheet${closing ? " is-closing" : ""}${dragging ? " is-dragging" : ""}`}
      aria-label="Todos los servicios"
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
                item.href ? (
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
  const [activeBanner, setActiveBanner] = useState(0);
  const [carouselCycle, setCarouselCycle] = useState(0);
  const [showAllServices, setShowAllServices] = useState(false);
  const [closingAllServices, setClosingAllServices] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);
  const carouselProgressRef = useRef<HTMLSpanElement>(null);
  const isAutoScrolling = useRef(false);
  const isCarouselInteracting = useRef(false);
  const carouselPosition = useRef(0);
  const carouselAnimationFrame = useRef<number | null>(null);
  const manualScrollTimer = useRef<number | null>(null);
  const carouselSnapTimer = useRef<number | null>(null);
  const carouselDragStartX = useRef(0);
  const carouselDragStartScrollLeft = useRef(0);
  const ignoreCarouselScrollUntil = useRef(0);
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") closeAllServices();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeAllServices, showAllServices]);

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

  useEffect(() => {
    const carouselNode = carouselRef.current;
    const progressNode = carouselProgressRef.current;
    if (!carouselNode || !progressNode) return;

    const startedAt = performance.now();
    const nextPosition = carouselPosition.current + 1;
    const card = carouselNode.children[nextPosition];
    const firstCard = carouselNode.children[0];
    if (!(card instanceof HTMLElement) || !(firstCard instanceof HTMLElement))
      return;

    const startLeft = carouselNode.scrollLeft;
    const targetLeft = card.offsetLeft - firstCard.offsetLeft;
    const distance = targetLeft - startLeft;
    const nextBannerIndex = nextPosition % homeBanners.length;
    let indicatorAdvanced = false;
    progressNode.style.transform = "scaleX(0)";

    const animateCycle = (currentTime: number) => {
      if (manualScrollTimer.current !== null) {
        carouselAnimationFrame.current =
          window.requestAnimationFrame(animateCycle);
        return;
      }

      const elapsed = Math.min(currentTime - startedAt, HOME_BANNER_CYCLE_MS);
      const dwellProgress = Math.min(elapsed / HOME_BANNER_DWELL_MS, 1);
      progressNode.style.transform = `scaleX(${dwellProgress})`;

      if (elapsed >= HOME_BANNER_DWELL_MS) {
        if (!indicatorAdvanced) {
          indicatorAdvanced = true;
          setActiveBanner(nextBannerIndex);
        }
        if (!isAutoScrolling.current) {
          isAutoScrolling.current = true;
          carouselNode.classList.add("is-auto-animating");
        }
        const transitionProgress =
          (elapsed - HOME_BANNER_DWELL_MS) / HOME_BANNER_TRANSITION_MS;
        carouselNode.scrollLeft = startLeft + distance * transitionProgress;
      }

      if (elapsed < HOME_BANNER_CYCLE_MS) {
        carouselAnimationFrame.current =
          window.requestAnimationFrame(animateCycle);
        return;
      }

      const wrappedToStart = nextPosition === homeBanners.length;
      carouselPosition.current = wrappedToStart ? 0 : nextPosition;
      ignoreCarouselScrollUntil.current = performance.now() + 200;
      if (wrappedToStart) carouselNode.scrollTo({ left: 0, behavior: "auto" });
      carouselNode.classList.remove("is-auto-animating");
      setCarouselCycle((current) => current + 1);
      isAutoScrolling.current = false;
      carouselAnimationFrame.current = null;
    };

    carouselAnimationFrame.current = window.requestAnimationFrame(animateCycle);

    return () => {
      if (carouselAnimationFrame.current !== null) {
        window.cancelAnimationFrame(carouselAnimationFrame.current);
        carouselAnimationFrame.current = null;
      }
      if (manualScrollTimer.current !== null) {
        window.clearTimeout(manualScrollTimer.current);
        manualScrollTimer.current = null;
      }
      if (carouselSnapTimer.current !== null) {
        window.clearTimeout(carouselSnapTimer.current);
        carouselSnapTimer.current = null;
      }
      carouselNode?.classList.remove("is-auto-animating");
      carouselNode?.classList.remove("is-user-dragging");
      isAutoScrolling.current = false;
    };
  }, [carouselCycle]);

  function handleCarouselPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    isCarouselInteracting.current = true;
    carouselDragStartX.current = event.clientX;
    carouselDragStartScrollLeft.current = event.currentTarget.scrollLeft;
    if (carouselAnimationFrame.current !== null) {
      window.cancelAnimationFrame(carouselAnimationFrame.current);
      carouselAnimationFrame.current = null;
    }
    if (manualScrollTimer.current !== null) {
      window.clearTimeout(manualScrollTimer.current);
      manualScrollTimer.current = null;
    }
    if (carouselSnapTimer.current !== null) {
      window.clearTimeout(carouselSnapTimer.current);
      carouselSnapTimer.current = null;
    }
    carouselRef.current?.classList.remove("is-auto-animating");
    carouselRef.current?.classList.add("is-user-dragging");
    isAutoScrolling.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCarouselPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isCarouselInteracting.current) return;
    const delta = event.clientX - carouselDragStartX.current;
    if (Math.abs(delta) < 2) return;
    event.preventDefault();
    event.currentTarget.scrollLeft =
      carouselDragStartScrollLeft.current - delta;
  }

  function handleCarouselInteractionEnd(
    event: ReactPointerEvent<HTMLDivElement>,
  ) {
    if (!isCarouselInteracting.current) return;
    isCarouselInteracting.current = false;
    const node = event.currentTarget;
    node.classList.remove("is-user-dragging");
    if (node.hasPointerCapture(event.pointerId))
      node.releasePointerCapture(event.pointerId);

    const firstCard = node.children[0];
    const secondCard = node.children[1];
    if (
      !(firstCard instanceof HTMLElement) ||
      !(secondCard instanceof HTMLElement)
    ) {
      setCarouselCycle((current) => current + 1);
      return;
    }

    const cardStride = secondCard.offsetLeft - firstCard.offsetLeft;
    const dragDistance = event.clientX - carouselDragStartX.current;
    const dragThreshold = node.clientWidth * 0.15;
    let nextPosition = Math.round(node.scrollLeft / cardStride);
    if (Math.abs(dragDistance) >= dragThreshold) {
      nextPosition = carouselPosition.current + (dragDistance < 0 ? 1 : -1);
    }
    nextPosition = Math.min(homeBanners.length, Math.max(0, nextPosition));

    const bannerIndex = nextPosition % homeBanners.length;
    carouselPosition.current = nextPosition;
    setActiveBanner(bannerIndex);
    isAutoScrolling.current = true;
    node.classList.add("is-auto-animating");
    ignoreCarouselScrollUntil.current =
      performance.now() + HOME_BANNER_TRANSITION_MS + 80;
    node.scrollTo({ left: nextPosition * cardStride, behavior: "smooth" });

    carouselSnapTimer.current = window.setTimeout(() => {
      if (nextPosition === homeBanners.length) {
        node.scrollTo({ left: 0, behavior: "auto" });
        carouselPosition.current = 0;
      }
      node.classList.remove("is-auto-animating");
      isAutoScrolling.current = false;
      carouselSnapTimer.current = null;
      setCarouselCycle((current) => current + 1);
    }, HOME_BANNER_TRANSITION_MS + 10);
  }

  function handleCarouselScroll() {
    const node = carouselRef.current;
    if (
      !node ||
      isCarouselInteracting.current ||
      isAutoScrolling.current ||
      performance.now() < ignoreCarouselScrollUntil.current
    )
      return;
    if (manualScrollTimer.current !== null)
      window.clearTimeout(manualScrollTimer.current);

    manualScrollTimer.current = window.setTimeout(() => {
      const firstCard = node.children[0];
      const secondCard = node.children[1];
      if (
        !(firstCard instanceof HTMLElement) ||
        !(secondCard instanceof HTMLElement)
      )
        return;

      const cardStride = secondCard.offsetLeft - firstCard.offsetLeft;
      const position = Math.min(
        homeBanners.length,
        Math.max(0, Math.round(node.scrollLeft / cardStride)),
      );
      const bannerIndex = position % homeBanners.length;

      if (position === carouselPosition.current) {
        setCarouselCycle((current) => current + 1);
        manualScrollTimer.current = null;
        return;
      }

      carouselPosition.current = position;

      if (position === homeBanners.length) {
        isAutoScrolling.current = true;
        ignoreCarouselScrollUntil.current = performance.now() + 200;
        node.scrollTo({ left: 0, behavior: "auto" });
        carouselPosition.current = 0;
        window.requestAnimationFrame(() => {
          isAutoScrolling.current = false;
        });
      }

      setActiveBanner(bannerIndex);
      setCarouselCycle((current) => current + 1);
      manualScrollTimer.current = null;
    }, 120);
  }

  function handleCarouselKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const node = carouselRef.current;
    const firstCard = node?.children[0];
    const secondCard = node?.children[1];
    if (
      !node ||
      !(firstCard instanceof HTMLElement) ||
      !(secondCard instanceof HTMLElement)
    )
      return;

    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextPosition =
      (carouselPosition.current + direction + homeBanners.length) %
      homeBanners.length;
    const cardStride = secondCard.offsetLeft - firstCard.offsetLeft;
    carouselPosition.current = nextPosition;
    setActiveBanner(nextPosition);
    node.scrollTo({ left: nextPosition * cardStride, behavior: "smooth" });
    setCarouselCycle((current) => current + 1);
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
              onUnavailable={(label) => {
                if (label === "Ver todo") openAllServices();
              }}
            />
          ))}
        </div>

        <div
          className="promo-carousel apk-banner-carousel"
          aria-label="Promociones"
          ref={carouselRef}
          tabIndex={0}
          onPointerDown={handleCarouselPointerDown}
          onPointerMove={handleCarouselPointerMove}
          onPointerUp={handleCarouselInteractionEnd}
          onPointerCancel={handleCarouselInteractionEnd}
          onKeyDown={handleCarouselKeyDown}
          onScroll={handleCarouselScroll}
        >
          {homeBanners.map((banner) => (
            <img
              key={banner.id}
              src={banner.src}
              alt={banner.alt}
              draggable={false}
            />
          ))}
          <img
            src={homeBanners[0].src}
            alt=""
            aria-hidden="true"
            draggable={false}
            data-carousel-clone="true"
          />
          <span className="carousel-end-spacer" aria-hidden="true" />
        </div>
        <div className="carousel-dots" aria-hidden="true">
          {homeBanners.map((banner, index) => (
            <i
              key={banner.id}
              className={index === activeBanner ? "is-active" : ""}
            >
              {index === activeBanner ? (
                <span key={carouselCycle} ref={carouselProgressRef} />
              ) : null}
            </i>
          ))}
        </div>
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

function HomeMainActions() {
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
