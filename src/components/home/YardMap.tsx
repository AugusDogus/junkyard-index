"use client";

import { ArrowUpRight, ChevronDown, MapPin, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import YardMapCanvas from "~/components/home/YardMapCanvas";
import { YardLinks } from "~/components/home/YardLinks";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { HomepageYard } from "~/lib/homepage-inventory";
import { useYardLocation } from "~/hooks/use-yard-location";
import { sortYardsByDistance, type YardLocation } from "~/lib/yard-directory";
import { cn } from "~/lib/utils";
import { EnsureAppProviders } from "~/components/AppProviders";

type YardMapProps = {
  yards: HomepageYard[];
  vehicleCount: number;
  approximateLocation: YardLocation | null;
  compactMap: boolean;
};

/** The yard map; its saved-location lookup needs the app providers. */
export function YardMap(props: YardMapProps) {
  return (
    <EnsureAppProviders>
      <YardMapContent {...props} />
    </EnsureAppProviders>
  );
}

function YardMapContent({
  yards,
  vehicleCount,
  approximateLocation,
  compactMap,
}: YardMapProps) {
  const [filter, setFilter] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [selected, setSelected] = useState<HomepageYard | null>(null);
  const { location, requestLocation, locating, locationError } =
    useYardLocation(approximateLocation);
  const filtered = sortYardsByDistance(yards, location).filter((yard) =>
    `${yard.name} ${yard.city} ${yard.state}`
      .toLowerCase()
      .includes(filter.trim().toLowerCase()),
  );

  return (
    <section
      id="yards"
      aria-labelledby="yard-map-title"
      className="border-ink border-2"
    >
      <div className="bg-board text-board-ink flex min-h-16 items-center justify-between gap-4 px-4 py-2 sm:px-5">
        <h2
          id="yard-map-title"
          className="flex flex-wrap items-baseline gap-x-6 gap-y-0 text-sm font-medium tracking-normal"
        >
          <span>
            <span className="text-figure text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
              {yards.length.toLocaleString("en-US")}
            </span>{" "}
            yards
          </span>
          <span>
            <span className="text-figure text-2xl font-extrabold tracking-[-0.03em] sm:text-3xl">
              {vehicleCount.toLocaleString("en-US")}
            </span>{" "}
            vehicles
          </span>
        </h2>
        <Link
          href="/request-yard"
          className="board-step focus-visible:outline-figure flex min-h-11 items-center gap-2 text-sm whitespace-nowrap underline decoration-1 underline-offset-[0.3em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-solid"
        >
          <span>
            <span className="hidden sm:inline">Missing a yard? </span>Request it
          </span>
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="homepage-map-layout border-ink grid overflow-hidden border-t-2 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="bg-paper-3 border-ink order-last flex min-h-0 flex-col border-t-2 lg:border-t-0 lg:border-l-2">
          <div className="flex min-h-13 items-center justify-between gap-2 px-4 py-2">
            <h3 className="flex items-center gap-2 text-[0.9375rem] font-extrabold tracking-normal">
              <MapPin className="size-4" aria-hidden="true" />
              Yard directory
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="lg:hidden"
              aria-expanded={directoryOpen}
              aria-controls="yard-directory"
              onClick={() => setDirectoryOpen(!directoryOpen)}
            >
              {directoryOpen ? "Hide" : "Browse"}
              <ChevronDown
                className={cn(directoryOpen && "rotate-180")}
                aria-hidden="true"
              />
            </Button>
          </div>
          <div
            id="yard-directory"
            className={cn(
              "min-h-0 flex-1 flex-col lg:flex",
              directoryOpen ? "flex" : "hidden",
            )}
          >
            <div className="border-ink border-b-2 px-4 pb-3">
              <label htmlFor="yard-filter" className="sr-only">
                Find a yard by name, city, or state abbreviation
              </label>
              <div className="relative">
                <Search
                  className="text-ink-3 absolute top-3.5 left-3 size-4"
                  aria-hidden="true"
                />
                <Input
                  id="yard-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Find a city, state, or yard"
                  className="border-ink h-11 border-2 pl-9"
                />
              </div>
            </div>
            <div className="max-h-64 min-h-0 flex-1 overflow-y-auto overscroll-contain lg:max-h-none">
              {filtered.length === 0 ? (
                <p className="text-ink-2 p-5 text-sm">
                  No matching yards. Try another city or state abbreviation.
                </p>
              ) : (
                filtered.map((yard) => (
                  <div
                    key={`${yard.source}:${yard.code}`}
                    className={cn(
                      "board-step border-rule hover:bg-paper-2 focus-within:bg-paper-2 relative border-b last:border-b-0",
                      selected === yard && "bg-paper-2",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(yard)}
                      aria-pressed={selected === yard}
                      className="focus-visible:after:outline-focus block w-full px-4 pt-3 pb-1 text-left outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-solid"
                    >
                      <span className="block min-w-0">
                        <span
                          className={cn(
                            "block truncate text-[0.9375rem] font-medium",
                            selected === yard && "text-signal font-extrabold",
                          )}
                          title={yard.name}
                        >
                          {yard.name}
                        </span>
                        <span className="text-ink-3 mt-0.5 flex items-center justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            {yard.city}, {yard.state}
                          </span>
                          <span className="text-ink shrink-0 whitespace-nowrap">
                            <span className="font-extrabold">
                              {yard.vehicleCount.toLocaleString("en-US")}
                            </span>{" "}
                            {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
                          </span>
                        </span>
                      </span>
                    </button>
                    <div className="px-4 pb-2">
                      <YardLinks yard={yard} />
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="border-ink text-ink-2 border-t-2 px-4 py-1.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span>{location ? "Nearest first" : "By state"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2"
                  disabled={locating}
                  onClick={requestLocation}
                >
                  {locating ? "Locating…" : "Use my location"}
                </Button>
              </div>
              {locationError && (
                <p role="status" className="mt-2 mb-1 text-pretty">
                  {locationError}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className="homepage-map-canvas relative isolate">
          <YardMapCanvas
            compact={compactMap}
            yards={yards}
            selected={selected}
            onSelect={setSelected}
          />
          {selected && (
            <div className="bg-paper-3 border-ink shadow-card absolute top-3 right-16 left-3 z-10 border-2 p-4 pr-11 sm:right-auto sm:max-w-80">
              <p className="text-signal text-[0.9375rem] font-extrabold text-pretty">
                {selected.name}
              </p>
              {selected.address && (
                <p className="text-ink-2 mt-1 text-sm text-pretty">
                  {selected.address}
                </p>
              )}
              <p className="text-ink-2 mt-1 text-sm">
                {selected.city}, {selected.state}
              </p>
              <p className="mt-1 text-sm">
                <span className="font-extrabold">
                  {selected.vehicleCount.toLocaleString("en-US")}
                </span>{" "}
                vehicles
              </p>
              <div className="border-rule mt-2 border-t pt-1">
                <YardLinks yard={selected} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close yard details"
                onClick={() => setSelected(null)}
                className="absolute top-2 right-2 size-8"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
