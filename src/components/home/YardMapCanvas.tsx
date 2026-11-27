"use client";

import { nextYardPin } from "~/lib/yard-map-focus";
import { YardMapMarker } from "~/lib/yard-map-marker";
import { YardMapUrl } from "~/lib/yard-map-url";
import { YardPath } from "~/lib/yard-path";
import { Minus, Plus, Scan } from "lucide-react";
import { Map } from "pigeon-maps";
import { YardMapTile, YardMapTilesReady } from "./YardMapTile";
import { yardTileProvider } from "~/lib/yard-map-tiles";
import { useYardMapUrlWrite } from "~/hooks/use-yard-map-url-write";
import { useYardMapView } from "~/hooks/use-yard-map-view";
import { YardMapMarkerCanvas } from "./YardMapMarkerCanvas";
import { YardMapPin } from "./YardMapPin";
import {
  YardMapPinLayer,
  yardMapPinAnchor,
  yardMapPinOffset,
} from "./YardMapPinLayer";
import { YardMapStaticDots } from "./YardMapStaticDots";
import {
  type CSSProperties,
  type MouseEvent,
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "~/components/ui/button";
import type { MapYard, YardMapSelection } from "./yard-map-data";
import {
  getYardMapFitCss,
  getYardMapView,
  hasMapCoordinates,
  projectYardLocation,
  type YardMapView,
} from "~/lib/yard-map-projection";

/**
 * Interactive pins mounted per task once the map has its real size. Mounting
 * all 450 in one task blocked the main thread past a long task on a phone;
 * the canvas draws every yard meanwhile.
 */
const PIN_BATCH = 64;

const YardMapCanvas = memo(function YardMapCanvas({
  yards,
  selection,
  onSelect,
  onChoose,
}: {
  yards: MapYard[];
  selection: YardMapSelection | null;
  onSelect: (selection: YardMapSelection | null) => void;
  /** A tap landed on several stacked dots; offer these yards to pick from. */
  onChoose: (yards: MapYard[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pins = useMemo(() => yards.filter(hasMapCoordinates), [yards]);
  const selected = selection?.yard ?? null;
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // The canvas draws the markers once it has run; until then, and without
  // script, plain static dots stand in.
  const [markersDrawn, setMarkersDrawn] = useState(false);
  const onMarkersDrawn = useCallback(() => setMarkersDrawn(true), []);
  const hoverYard = useCallback((key: string, hovered: boolean) => {
    setHoveredKey((current) =>
      hovered ? key : current === key ? null : current,
    );
  }, []);
  const markerRefs = useRef(new globalThis.Map<string, HTMLButtonElement>());
  // A mouse click in the map lets the plain wheel zoom until the pointer
  // leaves; until then the wheel scrolls the page past the map.
  const [wheelZoom, setWheelZoom] = useState(false);
  const mapRef = useRef<Map>(null);
  // An estimate until the layout effect measures the canvas. The page is
  // served from the CDN, so it can't depend on the visitor's device; the fit
  // scale below frames the same bounds on a phone until then.
  const [size, setSize] = useState({
    width: 900,
    height: 400,
    measured: false,
  });
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
  // Pins move only when the zoom or the anchor's grid cell changes.
  const {
    center: [anchorLat, anchorLng],
    zoom: anchorZoom,
  } = yardMapPinAnchor(current);
  const liveAnchor = useMemo(
    (): YardMapView => ({ center: [anchorLat, anchorLng], zoom: anchorZoom }),
    [anchorLat, anchorLng, anchorZoom],
  );
  // A zoom's first frame draws the map and the marker canvas; the pins
  // follow in a background render, and their layer keeps them aligned with
  // the map until then.
  const anchor = useDeferredValue(liveAnchor);
  const points = useMemo(() => pins.map(projectYardLocation), [pins]);
  const activeKey = pins.some((yard) => YardPath.key(yard) === focusedKey)
    ? focusedKey
    : pins[0]
      ? YardPath.key(pins[0])
      : null;

  /**
   * A pointer tap selects the yard under it. On stacked dots it lists the
   * few yards the tap covers, or zooms in on a crowd too long to list.
   * Keyboard activation picks the focused yard.
   */
  // The latest values `activate` reads, so it can stay one function: a new
  // one would redraw every memoized pin on each zoom and on first measure.
  const tapContext = useRef({ pins, points, zoom: current.zoom, size });
  useLayoutEffect(() => {
    tapContext.current = { pins, points, zoom: current.zoom, size };
  });
  const activate = useCallback(
    (yard: MapYard, event: MouseEvent<HTMLButtonElement>) => {
      const { pins, points, zoom, size } = tapContext.current;
      // Other pins are placed from the tapped one by projection: reading
      // each pin's box would lay out hundreds of them on every tap.
      const box = event.currentTarget.getBoundingClientRect();
      const origin = projectYardLocation(yard);
      const scale = 2 ** (zoom - 2);
      const tapped =
        event.detail === 0
          ? [yard]
          : YardMapMarker.hits(
              pins.flatMap((pin, index) => {
                const point = points[index];
                return point
                  ? [
                      {
                        key: pin,
                        x:
                          box.left +
                          box.width / 2 +
                          (point.x - origin.x) * scale,
                        y:
                          box.top +
                          box.height / 2 +
                          (point.y - origin.y) * scale,
                      },
                    ]
                  : [];
              }),
              { x: event.clientX, y: event.clientY },
            );
      const [first, ...others] = tapped.length > 0 ? tapped : [yard];
      if (!first) return;
      const action = YardMapMarker.tap(1 + others.length, zoom);
      if (action === "select") onSelect({ yard: first, focus: "center" });
      else if (action === "choose") onChoose([first, ...others]);
      else {
        requestView(
          YardMapMarker.frame(
            [first, ...others],
            zoom,
            size.width,
            size.height,
          ),
        );
      }
    },
    // onSelect, onChoose and requestView are stable callbacks.
    [onSelect, onChoose, requestView],
  );
  const registerPin = useCallback(
    (key: string, button: HTMLButtonElement | null) => {
      if (button) markerRefs.current.set(key, button);
      else markerRefs.current.delete(key);
    },
    [],
  );
  const placed = useMemo(
    () =>
      pins.map((yard) => ({
        yard,
        key: YardPath.key(yard),
        ...yardMapPinOffset(yard, anchor),
      })),
    [pins, anchor],
  );
  // Built once per settled view, so Pigeon's per-frame redraws of the
  // layer reuse these elements; a tap redraws only the pins it changes.
  const pinElements = useMemo(
    () =>
      placed.map(({ yard, key, x, y }) => (
        <YardMapPin
          key={key}
          yard={yard}
          x={x}
          y={y}
          tabIndex={key === activeKey ? 0 : -1}
          register={registerPin}
          onFocusYard={setFocusedKey}
          onHoverYard={hoverYard}
          selected={selected === yard}
          onSelect={activate}
        />
      )),
    [placed, selected, activeKey, activate, registerPin, hoverYard],
  );

  const [mountedPins, setMountedPins] = useState(0);
  useEffect(() => {
    if (!size.measured || mountedPins >= pins.length) return;
    const timeout = window.setTimeout(() =>
      startTransition(() => setMountedPins((count) => count + PIN_BATCH)),
    );
    return () => window.clearTimeout(timeout);
  }, [size.measured, mountedPins, pins.length]);
  const mountedPinElements = useMemo(
    () => pinElements.slice(0, mountedPins),
    [pinElements, mountedPins],
  );

  // Back and shared links return to the same view. Before paint, so a
  // client-side Back never shows the overview first.
  useLayoutEffect(() => {
    const restored = YardMapUrl.view(window.location.search);
    if (restored) syncView(restored);
  }, [syncView]);

  useYardMapUrlWrite(
    useCallback((search) => YardMapUrl.withView(search, view), [view]),
  );
  // Match getYardMapView's narrow or wide overview before the actual size is
  // known. A container query picks the frame, so a wrong size guess does
  // not change the framing on hydration.
  const fit = useMemo(
    () =>
      view
        ? null
        : {
            wide: getYardMapFitCss(yards, overview, false),
            narrow: getYardMapFitCss(yards, overview, true),
          },
    [yards, overview, view],
  );
  const mapStyle = {
    width: size.width,
    height: size.height,
    translate: "calc(-50% + var(--yard-map-x)) calc(-50% + var(--yard-map-y))",
    scale: "var(--yard-map-scale)",
    "--yard-map-wide-scale": fit?.wide.scale ?? "1",
    "--yard-map-wide-x": fit?.wide.x ?? "0px",
    "--yard-map-wide-y": fit?.wide.y ?? "0px",
    "--yard-map-narrow-scale": fit?.narrow.scale ?? "1",
    "--yard-map-narrow-x": fit?.narrow.x ?? "0px",
    "--yard-map-narrow-y": fit?.narrow.y ?? "0px",
  } satisfies CSSProperties & Record<`--yard-map-${string}`, string>;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setSize({
      width: container.clientWidth,
      height: container.clientHeight,
      measured: true,
    });
    const observer = new ResizeObserver(([entry]) => {
      if (
        entry &&
        entry.contentRect.width > 0 &&
        entry.contentRect.height > 0
      ) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
          measured: true,
        });
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Closing the yard card keeps the view; only the overview control resets it.
  useEffect(() => {
    if (!selection || !hasMapCoordinates(selection.yard)) return;
    const { yard, focus } = selection;
    if (focus === "zoom") {
      requestView({ center: [yard.lat, yard.lng], zoom: 9 });
    } else if (focus === "center") {
      requestView((pending) => ({
        zoom: (pending ?? overview).zoom,
        center: [yard.lat, yard.lng],
      }));
    }
    // Not on `overview`: it changes with the map's size, which must not
    // re-center the map.
  }, [selection, requestView]);

  const showOverview = () => {
    onSelect(null);
    requestView(null);
  };

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
      aria-description="Use arrow keys to move between yard pins, Enter to select, Shift and arrow keys to pan, plus and minus to zoom, and Home to return to the overview."
      onErrorCapture={() => setTileError(true)}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") setWheelZoom(true);
      }}
      onPointerLeave={() => setWheelZoom(false)}
      onKeyDown={(event) => {
        const pinIndex = pins.findIndex(
          (yard) => markerRefs.current.get(YardPath.key(yard)) === event.target,
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
          markerRefs.current.get(key)?.focus({ preventScroll: true });
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
          showOverview();
        }
      }}
    >
      <div
        // 640px is the narrow width in yard-map-projection.
        className="yard-map-frame absolute top-1/2 left-1/2 [--yard-map-scale:var(--yard-map-wide-scale)] [--yard-map-x:var(--yard-map-wide-x)] [--yard-map-y:var(--yard-map-wide-y)] @max-[640px]:[--yard-map-scale:var(--yard-map-narrow-scale)] @max-[640px]:[--yard-map-x:var(--yard-map-narrow-x)] @max-[640px]:[--yard-map-y:var(--yard-map-narrow-y)]"
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
            metaWheelZoom={!wheelZoom}
            metaWheelZoomWarning="Click the map or hold Ctrl or ⌘ to zoom"
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
            <YardMapMarkerCanvas
              pins={pins}
              selectedKey={selected ? YardPath.key(selected) : null}
              hoveredKey={hoveredKey}
              measured={size.measured}
              onDrawn={onMarkersDrawn}
            />
            <YardMapPinLayer anchor={anchor.center} view={anchor}>
              {markersDrawn ? null : (
                <YardMapStaticDots pins={pins} view={anchor} />
              )}
              {/* Interactive pins mount in batches at the map's real
              size, so the server's HTML, hydration and the first style
              pass stay light. */}
              {mountedPinElements}
            </YardMapPinLayer>
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
          className="bg-paper-3"
          aria-label="Return to the map overview"
          title="Map overview"
          onClick={showOverview}
        >
          <Scan aria-hidden="true" />
        </Button>
        <div className="bg-paper-3 border-rule-strong flex flex-col border">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
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
            className="border-t-rule-strong size-8 border-t"
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
          className="bg-paper-3 border-rule-strong absolute bottom-3 left-3 max-w-60 border p-3 text-xs"
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
