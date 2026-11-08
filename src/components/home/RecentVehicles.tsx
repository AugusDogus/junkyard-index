"use client";

import { ArrowUpRight, Car, Pause, Play } from "lucide-react";
import AutoScroll from "embla-carousel-auto-scroll";
import useEmblaCarousel from "embla-carousel-react";
import { useInView } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VehicleImage } from "~/components/search/VehicleImage";
import { Button } from "~/components/ui/button";
import type { RecentVehicle } from "~/lib/homepage-inventory";

/**
 * The visitor's reduced-motion setting, or null until the browser answers.
 * motion's useReducedMotion reads matchMedia during the first client render,
 * so a visitor who prefers reduced motion hydrated a pause button the server
 * never rendered and the page threw a hydration error.
 */
function usePrefersReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);
  return reduced;
}

export function RecentVehicles({ vehicles }: { vehicles: RecentVehicle[] }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const [autoScroll] = useState(() =>
    AutoScroll({
      speed: 0.85,
      startDelay: 0,
      playOnInit: false,
      stopOnInteraction: true,
    }),
  );
  const [viewportRef, carousel] = useEmblaCarousel(
    {
      loop: true,
      align: "start",
      dragFree: true,
      duration: reducedMotion ? 0 : 25,
    },
    [autoScroll],
  );

  useEffect(() => {
    if (!carousel) return;
    const syncPlayback = () => {
      if (inView && !paused && !hovered && reducedMotion === false) {
        autoScroll.play();
      } else {
        autoScroll.stop();
      }
    };
    const pauseForInteraction = () => setPaused(true);
    syncPlayback();
    carousel.on("reInit", syncPlayback).on("pointerDown", pauseForInteraction);
    return () => {
      carousel
        .off("reInit", syncPlayback)
        .off("pointerDown", pauseForInteraction);
      autoScroll.stop();
    };
  }, [carousel, autoScroll, inView, paused, hovered, reducedMotion]);

  return (
    <section
      ref={ref}
      aria-labelledby="recent-vehicles-title"
      aria-roledescription="carousel"
      className="bg-board text-board-ink border-ink border-y-2 py-14 sm:py-20"
    >
      <div className="shell">
        <div className="mb-8 flex items-end justify-between gap-6">
          <h2
            id="recent-vehicles-title"
            className="text-section leading-[1.02] font-extrabold"
          >
            Recently indexed vehicles
          </h2>
          {!reducedMotion && vehicles.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setPaused(!paused)}
              aria-label={
                paused ? "Play recent vehicles" : "Pause recent vehicles"
              }
              aria-pressed={paused}
              className="border-board-ink text-board-ink hover:bg-board-ink hover:text-board focus-visible:outline-figure size-12 shrink-0"
            >
              {paused ? <Play /> : <Pause />}
            </Button>
          )}
        </div>
        {vehicles.length === 0 ? (
          <p className="text-board-muted text-lead">
            No recent vehicles to show.{" "}
            <Link
              href="/search"
              className="text-board-ink focus-visible:outline-figure underline underline-offset-[0.3em] focus-visible:outline-2 focus-visible:outline-solid"
            >
              Search the inventory
            </Link>
            .
          </p>
        ) : (
          <div
            ref={viewportRef}
            className="recent-vehicles border-board-rule overflow-hidden border-l-2"
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setHovered(true);
            }}
            onPointerLeave={() => setHovered(false)}
            onFocusCapture={() => setPaused(true)}
          >
            <div className="flex touch-pan-y touch-pinch-zoom">
              {vehicles.map((vehicle, index) => {
                const title = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
                return (
                  <Link
                    key={index}
                    href={`/search?q=${encodeURIComponent(title)}`}
                    prefetch={false}
                    draggable={false}
                    className="board-step border-board-rule hover:bg-board-2 focus-visible:outline-figure group flex min-w-0 flex-[0_0_16rem] flex-col border-y-2 border-r-2 outline-none focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-solid sm:flex-[0_0_19rem]"
                  >
                    <div className="bg-board-2 border-board-rule relative flex aspect-[4/3] w-full shrink-0 items-center justify-center overflow-hidden border-b-2">
                      {vehicle.imageUrl ? (
                        <VehicleImage
                          src={vehicle.imageUrl}
                          alt=""
                          sizes="(min-width: 640px) 304px, 256px"
                        />
                      ) : (
                        <Car
                          className="text-board-muted size-10"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                      <p className="flex items-start justify-between gap-3">
                        <span className="line-clamp-2 text-base leading-snug font-extrabold">
                          {title}
                        </span>
                        <ArrowUpRight
                          className="text-board-muted group-hover:text-board-ink mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                      </p>
                      <p className="text-board-muted truncate text-sm">
                        {vehicle.city}, {vehicle.state}
                      </p>
                      <p className="text-board-muted mt-auto pt-2 text-sm">
                        Indexed{" "}
                        <time
                          dateTime={vehicle.indexedAt}
                          className="text-figure text-2xl leading-none font-extrabold tracking-[-0.03em]"
                        >
                          {new Date(vehicle.indexedAt).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                              timeZone: "UTC",
                            },
                          )}
                        </time>
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
