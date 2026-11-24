"use client";

import { nextYardPin } from "~/lib/yard-map-focus";
import { YardPath } from "~/lib/yard-path";
import { Minus, Plus, Scan } from "lucide-react";
import { Map, Overlay } from "pigeon-maps";
import { YardMapTile, YardMapTilesReady } from "./YardMapTile";
import { yardTileProvider } from "~/lib/yard-map-tiles";
import { useYardMapView } from "~/hooks/use-yard-map-view";
import { YardMapPin } from "./YardMapPin";
import {
  type CSSProperties,
  memo,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import type { MapYard } from "./yard-map-data";
import {
  getYardMapView,
  getYardMapBounds,
  hasMapCoordinates,
  isNarrowYardMap,
  yardMapControlsInset,
} from "~/lib/yard-map-projection";

const YardMapCanvas = memo(function YardMapCanvas({
  yards,
  selected,
  onSelect,
}: {
  yards: MapYard[];
  selected: MapYard | null;
  onSelect: (yard: MapYard | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pins = useMemo(() => yards.filter(hasMapCoordinates), [yards]);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const pinRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
  const activeKey = pins.some((yard) => YardPath.key(yard) === focusedKey)
    ? focusedKey
    : pins[0]
      ? YardPath.key(pins[0])
      : null;
  const mapRef = useRef<Map>(null);
  // An estimate until the layout effect measures the canvas. The page is
  // served from the CDN, so it can't depend on the visitor's device; the fit
  // scale below frames the same bounds on a phone until then.
  const [size, setSize] = useState({ width: 900, height: 400 });
  const [tileError, setTileError] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let frame: number | undefined;
    // Paint the hero in its final font before starting the decorative tile requests.
    void document.fonts.ready.then(() => {
      if (cancelled) return;
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => {
          if (!cancelled) setTilesReady(true);
        });
      });
    });
    return () => {
      cancelled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);
  const overview = useMemo(
    () => getYardMapView(yards, size.width, size.height),
    [yards, size.width, size.height],
  );
  const { view, requestView, syncView, loading, loadError } = useYardMapView(
    overview,
    size.width,
    size.height,
  );
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowLoading(false);
      return;
    }
    const timeout = window.setTimeout(() => setShowLoading(true), 200);
    return () => window.clearTimeout(timeout);
  }, [loading]);

  const current = view ?? overview;
  const narrow = isNarrowYardMap(size.width);
  const bounds = useMemo(
    () => getYardMapBounds(yards, narrow),
    [yards, narrow],
  );
  // Match getYardMapView's geographic fit before the actual size is known.
  // Scaling the estimated viewport instead changes the framing on hydration.
  const controls = yardMapControlsInset(size.width);
  const fitScale = `calc(clamp(0.5, min(calc((100cqw - ${32 + controls}px) / ${bounds.width}px), calc((100cqh - 32px) / ${bounds.height}px)), 32) / ${2 ** (overview.zoom - 2)})`;
  const mapStyle = {
    width: size.width,
    height: size.height,
    translate: "-50% -50%",
    scale: "var(--yard-map-scale)",
    "--yard-map-scale": view ? "1" : fitScale,
  } satisfies CSSProperties & { "--yard-map-scale": string };

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setSize({ width: container.clientWidth, height: container.clientHeight });
    const observer = new ResizeObserver(([entry]) => {
      if (
        entry &&
        entry.contentRect.width > 0 &&
        entry.contentRect.height > 0
      ) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    requestView(
      selected && hasMapCoordinates(selected)
        ? { center: [selected.lat, selected.lng], zoom: 9 }
        : null,
    );
  }, [selected, requestView]);

  const zoomBy = (amount: number) => {
    requestView((pending) => {
      const target = pending ?? overview;
      return {
        ...target,
        zoom: Math.max(1, Math.min(18, target.zoom + amount)),
      };
    });
  };

  return (
    <div
      ref={containerRef}
      className="yard-map focus-visible:outline-focus relative h-full overflow-hidden outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
      style={{ containerType: "size" }}
      role="region"
      tabIndex={pins.length === 0 ? 0 : -1}
      aria-label="Map of indexed junkyard locations"
      aria-description="Use arrow keys to move between yard pins, Enter to select, Shift and arrow keys to pan, plus and minus to zoom, and Home to show all yards."
      onErrorCapture={() => setTileError(true)}
      onKeyDown={(event) => {
        const pinIndex = pins.findIndex(
          (yard) => pinRefs.current.get(YardPath.key(yard)) === event.target,
        );
        if (event.target !== event.currentTarget && pinIndex < 0) return;
        const next = !event.shiftKey
          ? nextYardPin(pinIndex, pins.length, event.key)
          : null;
        const yard = next === null ? undefined : pins[next];
        if (yard) {
          event.preventDefault();
          const key = YardPath.key(yard);
          setFocusedKey(key);
          requestView({ ...current, center: [yard.lat, yard.lng] });
          pinRefs.current.get(key)?.focus({ preventScroll: true });
          return;
        }
        const offsets: Record<string, [number, number]> = {
          ArrowLeft: [-80, 0],
          ArrowRight: [80, 0],
          ArrowUp: [0, -80],
          ArrowDown: [0, 80],
        };
        const offset = offsets[event.key];
        if (offset) {
          event.preventDefault();
          const center = mapRef.current?.pixelToLatLng([
            size.width / 2 + offset[0],
            size.height / 2 + offset[1],
          ]);
          if (center) requestView({ ...current, center });
        } else if (
          event.key === "+" ||
          event.key === "=" ||
          event.key === "-"
        ) {
          event.preventDefault();
          zoomBy(event.key === "-" ? -1 : 1);
        } else if (event.key === "Home") {
          event.preventDefault();
          onSelect(null);
          requestView(null);
        }
      }}
    >
      <div
        className="absolute top-1/2 left-1/2"
        style={mapStyle}
        aria-busy={loading}
      >
        <YardMapTilesReady.Provider value={tilesReady}>
          <Map
            ref={mapRef}
            width={size.width}
            height={size.height}
            center={current.center}
            zoom={current.zoom}
            provider={yardTileProvider}
            tileComponent={YardMapTile}
            boxClassname="yard-map-tiles"
            animate={false}
            zoomSnap={false}
            metaWheelZoom
            metaWheelZoomWarning="Hold Ctrl or ⌘ while scrolling to zoom"
            twoFingerDrag
            onBoundsChanged={({ center, zoom, initial }) => {
              if (
                !initial &&
                (Math.abs(zoom - current.zoom) > 0.000001 ||
                  Math.abs(center[0] - current.center[0]) > 0.000001 ||
                  Math.abs(center[1] - current.center[1]) > 0.000001)
              ) {
                syncView({ center, zoom });
              }
            }}
            attribution={false}
          >
            {pins.map((yard) => (
              <Overlay
                key={`${yard.source}:${yard.code}`}
                anchor={[yard.lat, yard.lng]}
                offset={[12, 12]}
                className="yard-map-marker"
              >
                <YardMapPin
                  yard={yard}
                  tabIndex={YardPath.key(yard) === activeKey ? 0 : -1}
                  buttonRef={(button) => {
                    const key = YardPath.key(yard);
                    if (button) pinRefs.current.set(key, button);
                    else pinRefs.current.delete(key);
                  }}
                  onFocus={() => setFocusedKey(YardPath.key(yard))}
                  selected={selected === yard}
                  onSelect={() => onSelect(yard)}
                />
              </Overlay>
            ))}
          </Map>
        </YardMapTilesReady.Provider>
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="bg-paper-3 text-ink-2 hover:text-signal focus-visible:outline-focus absolute right-0 bottom-0 px-1.5 py-0.5 text-[11px] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid"
      >
        © OpenStreetMap contributors
      </a>
      <div className="absolute right-3 bottom-7 flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="bg-paper-3 hover:bg-ink"
          aria-label="Show all yards on the map"
          title="Show all yards"
          onClick={() => {
            onSelect(null);
            requestView(null);
          }}
        >
          <Scan aria-hidden="true" />
        </Button>
        <div className="bg-paper-3 border-ink flex flex-col border-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hover:bg-ink hover:text-paper size-8"
            aria-label="Zoom in"
            disabled={current.zoom >= 18}
            onClick={() => zoomBy(1)}
          >
            <Plus aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hover:bg-ink hover:text-paper border-t-ink size-8 border-t-2"
            aria-label="Zoom out"
            disabled={current.zoom <= 1}
            onClick={() => zoomBy(-1)}
          >
            <Minus aria-hidden="true" />
          </Button>
        </div>
      </div>
      {(loading ? showLoading : tileError || loadError) && (
        <p
          role="status"
          className="bg-paper-3 border-ink absolute bottom-3 left-3 max-w-60 border-2 p-3 text-xs"
        >
          {loading
            ? "Loading map…"
            : loadError
              ? "This map area could not load. Your previous view is preserved. Try zooming again or choose another yard."
              : "Map tiles could not load. You can still browse every yard in the location list."}
        </p>
      )}
    </div>
  );
});

export default YardMapCanvas;
