"use client";

import { ArrowUpRight, Car, Pause, Play } from "lucide-react";
import AutoScroll from "embla-carousel-auto-scroll";
import useEmblaCarousel from "embla-carousel-react";
import { useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { VehicleImage } from "~/components/search/VehicleImage";
import { Button } from "~/components/ui/button";
import type { RecentVehicle } from "~/lib/homepage-inventory";

export function RecentVehicles({ vehicles }: { vehicles: RecentVehicle[] }) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const reducedMotion = useReducedMotion();
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
      className="border-y py-3"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-2 flex min-h-9 items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h2
              id="recent-vehicles-title"
              className="flex items-center gap-2 text-sm font-semibold text-balance"
            >
              Recently indexed vehicles
            </h2>
          </div>
          {!reducedMotion && vehicles.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setPaused(!paused)}
              aria-label={
                paused ? "Play recent vehicles" : "Pause recent vehicles"
              }
              aria-pressed={paused}
            >
              {paused ? <Play /> : <Pause />}
            </Button>
          )}
        </div>
        {vehicles.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No recent vehicles to show.{" "}
            <Link href="/search" className="underline">
              Search the inventory
            </Link>
            .
          </p>
        ) : (
          <div
            ref={viewportRef}
            className="recent-vehicles overflow-hidden"
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
                    draggable={false}
                    className="bg-card hover:border-foreground/30 focus-visible:ring-ring/50 mr-4 flex min-w-0 flex-[0_0_18rem] items-center gap-3 rounded-lg border p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    <div className="bg-muted relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md">
                      {vehicle.imageUrl ? (
                        <VehicleImage
                          src={vehicle.imageUrl}
                          alt=""
                          sizes="64px"
                        />
                      ) : (
                        <Car
                          className="text-muted-foreground size-7"
                          aria-hidden="true"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{title}</p>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {vehicle.city}, {vehicle.state}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        Indexed{" "}
                        <time dateTime={vehicle.indexedAt}>
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
                    <ArrowUpRight
                      className="text-muted-foreground size-4 shrink-0"
                      aria-hidden="true"
                    />
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
