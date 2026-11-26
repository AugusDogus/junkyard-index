"use client";

import { ArrowUpRight, ChevronDown, MapPin, Search, X } from "lucide-react";
import Link from "next/link";
import {
  lazy,
  Suspense,
  useDeferredValue,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { YardLocationFooter } from "./YardLocationFooter";
import YardMapCanvas from "~/components/home/YardMapCanvas";
import { YardLinks } from "~/components/home/YardLinks";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  yardMapLayoutClasses,
  type MapYard,
  type YardMapLayout,
  type YardMapSelection,
} from "./yard-map-data";
import { YardDirectory } from "./YardDirectory";
import { useApproximateLocation } from "~/hooks/use-approximate-location";
import { useYardMapUrlWrite } from "~/hooks/use-yard-map-url-write";
import { sortYardsByDistance, type YardLocation } from "~/lib/yard-directory";
import { cn } from "~/lib/utils";
import { YardMapUrl } from "~/lib/yard-map-url";
import { YardPath } from "~/lib/yard-path";
const YardLocationControls = lazy(() => import("./YardLocationControls"));

type YardMapProps = {
  yards: MapYard[];
  vehicleCount: number;
  layout: YardMapLayout;
};

export function YardMap({ yards, vehicleCount, layout }: YardMapProps) {
  const [filter, setFilter] = useState("");
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [selection, setSelection] = useState<YardMapSelection | null>(null);
  const selected = selection?.yard ?? null;
  const selectFromDirectory = useCallback(
    (yard: MapYard) => setSelection({ yard, focus: "zoom" }),
    [],
  );

  // Back and shared links reopen the yard. With a saved view the map is
  // already there; a link with only the yard zooms to it.
  useLayoutEffect(() => {
    const key = YardMapUrl.yard(window.location.search);
    const yard = key && yards.find((yard) => YardPath.key(yard) === key);
    if (!yard) return;
    setSelection({
      yard,
      focus: YardMapUrl.view(window.location.search) ? "keep" : "zoom",
    });
  }, [yards]);

  const selectedKey = selected && YardPath.key(selected);
  useYardMapUrlWrite(
    useCallback(
      (search) => YardMapUrl.withYard(search, selectedKey),
      [selectedKey],
    ),
  );
  const approximateLocation = useApproximateLocation();
  // The location controls report the visitor's chosen location, which falls
  // back to the approximate one; until they load, the approximate one sorts.
  const [chosenLocation, setLocation] = useState<YardLocation | null>(null);
  const location = chosenLocation ?? approximateLocation;
  // The IP location arrives after hydration and only reorders the directory,
  // so the visitor keeps their scroll and focus. A location they chose (saved
  // or shared) differs from it and starts the directory from the top.
  const chosenKey =
    chosenLocation &&
    (chosenLocation.lat !== approximateLocation?.lat ||
      chosenLocation.lng !== approximateLocation.lng)
      ? `${chosenLocation.lat}:${chosenLocation.lng}`
      : "approximate";
  const [locationMode, setLocationMode] = useState<
    "deferred" | "ready" | "request"
  >("deferred");

  // A closed phone directory does not need account lookup, tRPC, or toasts.
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const loadDesktopLocation = () => {
      if (media.matches)
        setLocationMode((mode) => (mode === "deferred" ? "ready" : mode));
    };
    loadDesktopLocation();
    media.addEventListener("change", loadDesktopLocation);
    return () => media.removeEventListener("change", loadDesktopLocation);
  }, []);

  const deferredFilter = useDeferredValue(filter.trim().toLowerCase());
  const sorted = useMemo(
    () => sortYardsByDistance(yards, location),
    [yards, location],
  );
  const filtered = useMemo(
    () =>
      sorted.filter((yard) =>
        `${yard.name} ${yard.city} ${yard.state}`
          .toLowerCase()
          .includes(deferredFilter),
      ),
    [sorted, deferredFilter],
  );

  return (
    <section
      id="yards"
      aria-labelledby="yard-map-title"
      className="border-ink border-2"
    >
      <a
        href="#recent-vehicles"
        className="focus:outline-focus sr-only focus:not-sr-only focus:block focus:p-4 focus:outline-2"
      >
        Skip map
      </a>
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
      <div
        className={cn(
          "border-ink grid grid-cols-[minmax(0,1fr)] overflow-hidden border-t-2 lg:grid-cols-[minmax(0,1fr)_360px]",
          yardMapLayoutClasses[layout].layout,
        )}
      >
        {/* Phones show the yard card under the map, not over the pin. */}
        <div className="relative isolate flex min-w-0 flex-col">
          <div
            className={cn(
              "relative min-w-0",
              yardMapLayoutClasses[layout].canvas,
            )}
          >
            <YardMapCanvas
              yards={yards}
              selection={selection}
              onSelect={setSelection}
            />
          </div>
          {selected && (
            <div
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setSelection(null);
                }
              }}
              className="bg-paper-3 border-ink sm:shadow-card relative z-10 border-t-2 p-4 pr-11 sm:absolute sm:top-3 sm:left-3 sm:max-w-80 sm:border-2"
            >
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
                onClick={() => setSelection(null)}
                className="absolute top-2 right-2 size-8"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        <div className="bg-paper-3 border-ink flex min-h-0 min-w-0 flex-col border-t-2 lg:border-t-0 lg:border-l-2">
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
              onClick={() => {
                setDirectoryOpen(!directoryOpen);
                setLocationMode((mode) =>
                  mode === "deferred" ? "ready" : mode,
                );
              }}
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
              "min-h-0 min-w-0 flex-1 flex-col lg:flex",
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
            <YardDirectory
              key={`${deferredFilter}:${chosenKey}`}
              yards={filtered}
              selected={selected}
              onSelect={selectFromDirectory}
            />
            <Suspense
              fallback={
                <YardLocationFooter
                  location={location}
                  requestLocation={() => setLocationMode("request")}
                  locating={false}
                  locationError={null}
                />
              }
            >
              {locationMode === "deferred" ? (
                <YardLocationFooter
                  location={location}
                  requestLocation={() => setLocationMode("request")}
                  locating={false}
                  locationError={null}
                />
              ) : (
                <YardLocationControls
                  approximateLocation={approximateLocation}
                  onLocation={setLocation}
                  requestOnMount={locationMode === "request"}
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>
    </section>
  );
}
