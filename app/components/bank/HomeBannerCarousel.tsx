"use client";
/* eslint-disable @next/next/no-img-element -- banners usan assets capturados del APK */

import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PromoBanner } from "./types";

const HOME_BANNER_DWELL_MS = 4500;
const DRAG_CLICK_THRESHOLD_PX = 10;

export const homeBanners: PromoBanner[] = [
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

function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HomeBannerCarousel({
  banners = homeBanners,
}: {
  banners?: PromoBanner[];
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLElement | null>>([]);
  const progressRef = useRef<HTMLSpanElement>(null);
  const activeIndexRef = useRef(0);
  const pausedRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerStartX = useRef(0);
  const dwellStartedAt = useRef(0);
  const rafRef = useRef<number | null>(null);
  const resumeTimerRef = useRef<number | null>(null);

  const [activeIndex, setActiveIndex] = useState(0);
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const visibleBanners = banners.filter((banner) => !brokenIds.has(banner.id));
  const slideCount = visibleBanners.length;
  const showControls = slideCount > 1;
  const safeActive =
    slideCount === 0 ? 0 : Math.min(activeIndex, slideCount - 1);

  const setActive = useCallback((index: number) => {
    activeIndexRef.current = index;
    setActiveIndex(index);
    dwellStartedAt.current = performance.now();
    if (progressRef.current) progressRef.current.style.transform = "scaleX(0)";
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const track = trackRef.current;
    const slide = slideRefs.current[index];
    if (!track || !slide) return;
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    track.scrollTo({ left: slide.offsetLeft, behavior });
  }, []);

  const goTo = useCallback(
    (index: number) => {
      if (slideCount === 0) return;
      const next = ((index % slideCount) + slideCount) % slideCount;
      setActive(next);
      scrollToIndex(next);
    },
    [scrollToIndex, setActive, slideCount],
  );

  useEffect(() => {
    slideRefs.current = slideRefs.current.slice(0, slideCount);
  }, [slideCount]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track || slideCount === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        let best: { index: number; ratio: number } | null = null;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (!Number.isFinite(index)) continue;
          if (!best || entry.intersectionRatio > best.ratio) {
            best = { index, ratio: entry.intersectionRatio };
          }
        }
        if (
          best
          && best.ratio >= 0.55
          && best.index !== activeIndexRef.current
        ) {
          setActive(best.index);
        }
      },
      { root: track, threshold: [0.55, 0.7, 0.85] },
    );

    for (const slide of slideRefs.current) {
      if (slide) observer.observe(slide);
    }
    return () => observer.disconnect();
  }, [setActive, slideCount, visibleBanners]);

  useEffect(() => {
    if (!showControls || prefersReducedMotion()) return;

    dwellStartedAt.current = performance.now();

    const tick = (now: number) => {
      const paused =
        document.visibilityState === "hidden"
        || pausedRef.current
        || draggingRef.current;

      if (paused) {
        dwellStartedAt.current = now;
        if (progressRef.current) {
          progressRef.current.style.transform = "scaleX(0)";
        }
      } else {
        const elapsed = now - dwellStartedAt.current;
        const ratio = Math.min(elapsed / HOME_BANNER_DWELL_MS, 1);
        if (progressRef.current) {
          progressRef.current.style.transform = `scaleX(${ratio})`;
        }

        if (elapsed >= HOME_BANNER_DWELL_MS) {
          const next = (activeIndexRef.current + 1) % slideCount;
          setActive(next);
          scrollToIndex(next);
        }
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [scrollToIndex, setActive, showControls, slideCount]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        dwellStartedAt.current = performance.now();
        if (progressRef.current) {
          progressRef.current.style.transform = "scaleX(0)";
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (resumeTimerRef.current !== null) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  function pause() {
    pausedRef.current = true;
  }

  function resume() {
    pausedRef.current = false;
    dwellStartedAt.current = performance.now();
    if (progressRef.current) progressRef.current.style.transform = "scaleX(0)";
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!showControls) return;
    draggingRef.current = true;
    pointerStartX.current = event.clientX;
    pause();
    event.currentTarget.classList.add("is-user-dragging");
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    event.currentTarget.classList.remove("is-user-dragging");
    const dragged =
      Math.abs(event.clientX - pointerStartX.current)
      >= DRAG_CLICK_THRESHOLD_PX;

    if (resumeTimerRef.current !== null) {
      window.clearTimeout(resumeTimerRef.current);
    }

    // Tras un arrastre, el snap nativo alinea; IO actualiza el índice.
    resumeTimerRef.current = window.setTimeout(() => {
      resumeTimerRef.current = null;
      resume();
      if (!dragged) return;
      const track = trackRef.current;
      if (!track) return;
      let bestIndex = activeIndexRef.current;
      let bestDistance = Number.POSITIVE_INFINITY;
      slideRefs.current.forEach((slide, index) => {
        if (!slide) return;
        const distance = Math.abs(slide.offsetLeft - track.scrollLeft);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      if (bestIndex !== activeIndexRef.current) setActive(bestIndex);
    }, 320);
  }

  if (slideCount === 0) return null;

  return (
    <section
      className="home-banner-carousel"
      aria-label="Promociones"
    >
      <div
        ref={trackRef}
        className="promo-carousel apk-banner-carousel"
        tabIndex={showControls ? 0 : undefined}
        role={showControls ? "region" : undefined}
        aria-roledescription={showControls ? "carrusel" : undefined}
        aria-label={showControls ? "Carrusel de promociones" : undefined}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerEnter={pause}
        onPointerLeave={() => {
          if (draggingRef.current) return;
          resume();
        }}
        onKeyDown={(event) => {
          if (!showControls) return;
          if (event.key === "ArrowRight") {
            event.preventDefault();
            goTo(safeActive + 1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            goTo(safeActive - 1);
          }
        }}
      >
        {visibleBanners.map((banner, index) => (
          <figure
            key={banner.id}
            className="home-banner-slide"
            data-index={index}
            ref={(node) => {
              slideRefs.current[index] = node;
            }}
          >
            <img
              src={banner.src}
              alt={banner.alt}
              draggable={false}
              decoding="async"
              loading={index === 0 ? "eager" : "lazy"}
              fetchPriority={index === 0 ? "high" : "auto"}
              onDragStart={(event) => event.preventDefault()}
              onError={() => {
                setBrokenIds((current) => {
                  if (current.has(banner.id)) return current;
                  const next = new Set(current);
                  next.add(banner.id);
                  return next;
                });
                const current = activeIndexRef.current;
                if (current > index) {
                  activeIndexRef.current = current - 1;
                  setActiveIndex(current - 1);
                } else if (current === index) {
                  const fallback = Math.max(0, index - 1);
                  activeIndexRef.current = fallback;
                  setActiveIndex(fallback);
                }
              }}
            />
          </figure>
        ))}
        <span className="carousel-end-spacer" aria-hidden="true" />
      </div>

      {showControls ? (
        <div
          className="carousel-dots"
          role="tablist"
          aria-label="Indicadores de promociones"
        >
          {visibleBanners.map((banner, index) => {
            const active = index === safeActive;
            return (
              <button
                key={banner.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Ir a promoción ${index + 1} de ${slideCount}: ${banner.alt}`}
                className={active ? "is-active" : undefined}
                onClick={() => goTo(index)}
              >
                {active ? (
                  <span ref={progressRef} className="carousel-dot-progress" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
