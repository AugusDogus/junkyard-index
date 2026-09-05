"use client";

import { ArrowUpRight, ChevronDown, MapPin, Search, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import YardMapCanvas from "~/components/home/YardMapCanvas";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { HomepageYard } from "~/lib/homepage-inventory";
import { useYardLocation } from "~/hooks/use-yard-location";
import { sortYardsByDistance, type YardLocation } from "~/lib/yard-directory";
import { cn } from "~/lib/utils";

export function YardMap({
  yards,
  vehicleCount,
  approximateLocation,
  compactMap,
}: {
  yards: HomepageYard[];
  vehicleCount: number;
  approximateLocation: YardLocation | null;
  compactMap: boolean;
}) {
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
      className="scroll-mt-20"
    >
      <div className="bg-card flex items-center justify-between gap-4 rounded-t-lg border border-b-0 px-4 py-3">
        <div>
          <h2 id="yard-map-title" className="text-sm font-medium text-balance">
            <span className="tabular-nums">
              {yards.length.toLocaleString("en-US")}
            </span>{" "}
            yards
            <span className="text-muted-foreground ml-3 hidden font-normal sm:inline">
              <span className="tabular-nums">
                {vehicleCount.toLocaleString("en-US")}
              </span>{" "}
              vehicles
            </span>
          </h2>
        </div>
        <Link
          href="/request-yard"
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm"
        >
          <span>
            <span className="hidden sm:inline">Missing a yard? </span>Request it
          </span>{" "}
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
      <div className="homepage-map-layout bg-card grid overflow-hidden rounded-b-lg border lg:grid-cols-[1fr_300px]">
        <div className="order-last flex min-h-0 flex-col border-t lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <MapPin className="text-muted-foreground size-4" />
              Yard directory
            </h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="lg:hidden"
              aria-expanded={directoryOpen}
              aria-controls="yard-directory"
              onClick={() => setDirectoryOpen(!directoryOpen)}
            >
              {directoryOpen ? "Hide" : "Browse"}
              <ChevronDown />
            </Button>
          </div>
          <div
            id="yard-directory"
            className={cn(
              "min-h-0 flex-1 flex-col lg:flex",
              directoryOpen ? "flex" : "hidden",
            )}
          >
            <div className="border-b px-4 pb-3">
              <label htmlFor="yard-filter" className="sr-only">
                Find a yard by name, city, or state abbreviation
              </label>
              <div className="relative">
                <Search
                  className="text-muted-foreground absolute top-3 left-3 size-4"
                  aria-hidden="true"
                />
                <Input
                  id="yard-filter"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Find a city, state, or yard"
                  className="h-10 pl-9"
                />
              </div>
            </div>
            <div className="max-h-52 min-h-0 flex-1 overflow-y-auto overscroll-contain lg:max-h-none">
              {filtered.length === 0 ? (
                <p className="text-muted-foreground p-5 text-sm">
                  No matching yards. Try another city or state abbreviation.
                </p>
              ) : (
                filtered.map((yard) => (
                  <button
                    key={`${yard.source}:${yard.code}`}
                    type="button"
                    onClick={() => setSelected(yard)}
                    aria-pressed={selected === yard}
                    className={cn(
                      "hover:bg-muted flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0",
                      selected === yard && "bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {yard.name}
                      </span>
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {yard.city}, {yard.state}
                      </span>
                    </span>
                    <span className="text-muted-foreground shrink-0 text-right text-xs tabular-nums">
                      <span className="block">
                        {yard.vehicleCount.toLocaleString("en-US")}{" "}
                      </span>
                      <span className="mt-1 block">
                        {yard.vehicleCount === 1 ? "vehicle" : "vehicles"}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="text-muted-foreground border-t px-4 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span>{location ? "Nearest first" : "By state"}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  disabled={locating}
                  onClick={requestLocation}
                >
                  {locating ? "Locating…" : "Use my location"}
                </Button>
              </div>
              {locationError && (
                <p role="status" className="mt-2 text-pretty">
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
            <div className="bg-card absolute top-3 right-16 left-3 z-10 rounded-lg border p-3 pr-10 shadow-sm sm:right-auto sm:max-w-80">
              <p className="truncate text-sm font-medium" title={selected.name}>
                {selected.name}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {selected.city}, {selected.state} ·{" "}
                {selected.vehicleCount.toLocaleString("en-US")} vehicles
              </p>
              <Button
                variant="outline"
                size="icon"
                aria-label="Close yard details"
                onClick={() => setSelected(null)}
                className="absolute top-2 right-2 size-6 border-0 shadow-none"
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
