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
  useRef,
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
  type YardMapPanel,
  type YardMapSelection,
} from "./yard-map-data";
import { YardMapChoice } from "./YardMapChoice";
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
  const [panel, setPanel] = useState<YardMapPanel | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selection = panel?.kind === "yard" ? panel.selection : null;
  const selected = selection?.yard ?? null;
  const setSelection = useCallback(
    (selection: YardMapSelection | null) =>
      setPanel(selection && { kind: "yard", selection }),
    [],
  );
  const chooseYard = useCallback(
    (yards: MapYard[]) => setPanel({ kind: "choice", yards }),
    [],
  );
  const selectFromDirectory = useCallback(
    (yard: MapYard) => setSelection({ yard, focus: "zoom" }),
    [setSelection],
  );

  // On phones the card or list opens under the map, often below the fold.
  // Bring it into view so a tap visibly does something. Not when Back
  // restores it: the browser restores the scroll position then.
  useEffect(() => {
    const element = panelRef.current;
    if (
      !element ||
      (panel?.kind === "yard" && panel.selection.focus === "keep")
    ) {
      return;
    }
    // Measure in the next frame, with the layout the browser does anyway,
    // instead of forcing the map's layout right after the tap.
    const frame = window.requestAnimationFrame(() => {
      const box = element.getBoundingClientRect();
      if (box.top >= 0 && box.bottom <= window.innerHeight) return;
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      element.scrollIntoView({
        block: "nearest",
        behavior: reduceMotion ? "auto" : "smooth",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panel]);

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
  }, [yards, setSelection]);

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
      className="border-rule-strong border"
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
            <span className="text-figure text-2xl font-medium tracking-[-0.03em] sm:text-3xl">
              {yards.length.toLocaleString("en-US")}
            </span>{" "}
            yards
          </span>
          <span>
            <span className="text-figure text-2xl font-medium tracking-[-0.03em] sm:text-3xl">
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
          "border-rule-strong grid grid-cols-[minmax(0,1fr)] overflow-hidden border-t lg:grid-cols-[minmax(0,1fr)_360px]",
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
              onChoose={chooseYard}
            />
          </div>
          {panel && (
            <div
              ref={panelRef}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setPanel(null);
                }
              }}
              className="bg-paper-3 border-rule-strong sm:shadow-card relative z-10 border-t p-4 pr-11 sm:absolute sm:top-3 sm:left-3 sm:max-w-80 sm:border"
            >
              {panel.kind === "yard" ? (
                <YardDetails yard={panel.selection.yard} />
              ) : (
                <YardMapChoice
                  yards={panel.yards}
                  onPick={(yard) => setSelection({ yard, focus: "center" })}
                />
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  panel.kind === "yard"
                    ? "Close yard details"
                    : "Close the list of yards here"
                }
                onClick={() => setPanel(null)}
                className="absolute top-2 right-2 size-8"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
          )}
          {/* Says what a tap opened, wherever the panel sits on screen. */}
          <p aria-live="polite" className="sr-only">
            {panel?.kind === "yard"
              ? `${panel.selection.yard.name}, ${panel.selection.yard.city}, ${panel.selection.yard.state}: details shown.`
              : panel?.kind === "choice"
                ? `${panel.yards.length} yards here. Pick one from the list.`
                : ""}
          </p>
        </div>
        <div className="bg-paper-3 border-rule-strong flex min-h-0 min-w-0 flex-col border-t lg:border-t-0 lg:border-l">
          <div className="flex min-h-13 items-center justify-between gap-2 px-4 py-2">
            <h3 className="flex items-center gap-2 text-[0.9375rem] font-medium tracking-normal">
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
            <div className="border-rule-strong border-b px-4 pb-3">
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
                  className="border-rule-strong h-11 border pl-9"
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

/** The open yard's card: name, address, size and its links. */
function YardDetails({ yard }: { yard: MapYard }) {
  return (
    <>
      <p className="text-signal text-[0.9375rem] font-medium text-pretty">
        {yard.name}
      </p>
      {yard.address && (
        <p className="text-ink-2 mt-1 text-sm text-pretty">{yard.address}</p>
      )}
      <p className="text-ink-2 mt-1 text-sm">
        {yard.city}, {yard.state}
      </p>
      <p className="mt-1 text-sm">
        <span className="font-medium">
          {yard.vehicleCount.toLocaleString("en-US")}
        </span>{" "}
        vehicles
      </p>
      <div className="border-rule mt-2 border-t pt-1">
        <YardLinks yard={yard} />
      </div>
    </>
  );
}
