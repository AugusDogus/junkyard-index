"use client";

import { Minus, Plus, Scan } from "lucide-react";
import { Map, Overlay } from "pigeon-maps";
import { YardMapTile, yardTileProvider } from "./YardMapTile";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import type { HomepageYard } from "~/lib/homepage-inventory";
import {
  getYardMapView,
  getYardMapBounds,
  hasMapCoordinates,
  type YardMapView,
} from "~/lib/yard-map-projection";

export default function YardMapCanvas({
  yards,
  compact,
  selected,
  onSelect,
}: {
  yards: HomepageYard[];
  compact: boolean;
  selected: HomepageYard | null;
  onSelect: (yard: HomepageYard | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map>(null);
  const [size, setSize] = useState(
    compact ? { width: 360, height: 240 } : { width: 900, height: 400 },
  );
  const [view, setView] = useState<YardMapView | null>(null);
  const [tileError, setTileError] = useState(false);
  const overview = getYardMapView(yards, size.width, size.height);
  const current = view ?? overview;
  const bounds = getYardMapBounds(yards);
  // Match getYardMapView's geographic fit before the actual size is known.
  // Scaling the estimated viewport instead changes the framing on hydration.
  const fitScale = `calc(clamp(0.5, min(calc((100cqw - 32px) / ${bounds.width}px), calc((100cqh - 32px) / ${bounds.height}px)), 32) / ${2 ** (overview.zoom - 2)})`;
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
    setView(
      selected && hasMapCoordinates(selected)
        ? { center: [selected.lat, selected.lng], zoom: 9 }
        : null,
    );
  }, [selected]);

  const zoomBy = (amount: number) => {
    setView({
      ...current,
      zoom: Math.max(1, Math.min(18, current.zoom + amount)),
    });
  };

  return (
    <div
      ref={containerRef}
      className="yard-map focus-visible:ring-foreground relative h-full overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset"
      style={{ containerType: "size" }}
      role="region"
      tabIndex={0}
      aria-label="Map of indexed junkyard locations"
      aria-description="Use arrow keys to pan, plus and minus to zoom, and Home to show all yards."
      onErrorCapture={() => setTileError(true)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
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
          if (center) setView({ ...current, center });
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
          setView(null);
        }
      }}
    >
      <div className="absolute top-1/2 left-1/2" style={mapStyle}>
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
              setView({ center, zoom });
            }
          }}
          attribution={false}
        >
          {yards.filter(hasMapCoordinates).map((yard) => (
            <Overlay
              key={`${yard.source}:${yard.code}`}
              anchor={[yard.lat, yard.lng]}
              offset={[12, 12]}
              className="yard-map-marker"
            >
              <button
                type="button"
                className="yard-map-pin"
                aria-label={`${yard.name}, ${yard.city}, ${yard.state}`}
                aria-pressed={selected === yard}
                title={`${yard.name} · ${yard.vehicleCount.toLocaleString("en-US")} vehicles`}
                onClick={() => onSelect(yard)}
              >
                <span aria-hidden="true" />
              </button>
            </Overlay>
          ))}
        </Map>
      </div>
      <a
        href="https://www.openstreetmap.org/copyright"
        target="_blank"
        rel="noreferrer"
        className="bg-background text-muted-foreground absolute right-0 bottom-0 px-1.5 py-0.5 text-[10px]"
      >
        © OpenStreetMap contributors
      </a>
      <div className="absolute right-3 bottom-7 flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="bg-background dark:bg-background shadow-sm"
          aria-label="Show all yards on the map"
          title="Show all yards"
          onClick={() => {
            onSelect(null);
            setView(null);
          }}
        >
          <Scan aria-hidden="true" />
        </Button>
        <div className="bg-background flex flex-col overflow-hidden rounded-md border shadow-sm">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-none"
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
            className="rounded-none border-t"
            aria-label="Zoom out"
            disabled={current.zoom <= 1}
            onClick={() => zoomBy(-1)}
          >
            <Minus aria-hidden="true" />
          </Button>
        </div>
      </div>
      {tileError && (
        <p
          role="status"
          className="bg-card absolute top-3 left-3 max-w-60 rounded-md border p-3 text-xs"
        >
          Map tiles could not load. You can still browse every yard in the
          location list.
        </p>
      )}
    </div>
  );
}
