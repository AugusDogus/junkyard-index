import { hasFiniteCoordinates } from "~/lib/location-preferences";
import type { YardLocation } from "~/lib/yard-directory";

// Web Mercator in a 1024-unit world. Clamp polar latitudes to its finite extent.
export function projectYardLocation({ lat, lng }: YardLocation) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: ((lng + 180) / 360) * 1024,
    y:
      ((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) *
      1024,
  };
}

/** The inverse of `projectYardLocation`, as a `[lat, lng]` map center. */
export function unprojectYardLocation(x: number, y: number): [number, number] {
  return [
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 1024))) * 180) / Math.PI,
    (x / 1024) * 360 - 180,
  ];
}

export function hasMapCoordinates(location: YardLocation) {
  return (
    hasFiniteCoordinates(location) && (location.lat !== 0 || location.lng !== 0)
  );
}

/**
 * Below this width, the map frames the lower 48 for phones. The map's
 * `@max-[640px]` container query must match it.
 */
const NARROW_WIDTH = 640;
// The zoom and fullscreen buttons' column at the map's right edge.
const NARROW_CONTROLS = 56;

/** Whether a map this wide frames the lower 48 instead of every yard. */
function isNarrowYardMap(width: number): boolean {
  return width < NARROW_WIDTH;
}

/** Pixels at the right edge the overview keeps pins out of, for the controls. */
function yardMapControlsInset(width: number): number {
  return isNarrowYardMap(width) ? NARROW_CONTROLS : 0;
}

/**
 * The projected area the overview frames. Wide maps fit every yard; narrow
 * maps fit the lower 48 and Canada and leave Alaska and Hawaii, far to the
 * west, to panning, so the dense East is not squeezed into a corner.
 */
export function getYardMapBounds(
  locations: readonly YardLocation[],
  narrow = false,
) {
  const points = locations
    .filter(hasMapCoordinates)
    .filter((location) => !narrow || location.lng >= -130)
    .map(projectYardLocation);
  const northwest = projectYardLocation(
    narrow ? { lat: 49, lng: -124 } : { lat: 55, lng: -125 },
  );
  const southeast = projectYardLocation(
    narrow ? { lat: 25, lng: -67 } : { lat: 25, lng: -70 },
  );
  const left = Math.min(northwest.x, ...points.map((point) => point.x)) - 1;
  const top = Math.min(northwest.y, ...points.map((point) => point.y)) - 1;
  const right = Math.max(southeast.x, ...points.map((point) => point.x)) + 1;
  const bottom = Math.max(southeast.y, ...points.map((point) => point.y)) + 1;
  return { left, top, width: right - left, height: bottom - top };
}

/** A CSS scale and offset for a map drawn at one view to show another. */
export type YardMapFitCss = { scale: string; x: string; y: string };

/**
 * CSS that makes a map drawn at `drawn`, the view for a guessed size, show
 * the narrow or wide overview `getYardMapView` gives the map's real size.
 * It reads that size from the container (`--yard-map-width` and
 * `--yard-map-height`, from `cqw` and `cqh` in globals.css), so it is right
 * before any script measures it. The offset applies after the scale.
 */
export function getYardMapFitCss(
  locations: readonly YardLocation[],
  drawn: YardMapView,
  narrow: boolean,
): YardMapFitCss {
  const bounds = getYardMapBounds(locations, narrow);
  const controls = narrow ? NARROW_CONTROLS : 0;
  // Pixels per projected unit, as getYardMapView's clamped zoom gives them.
  // tan(atan2(a, b)) is a / b as a plain number. Dividing one length by
  // another directly needs Safari 26, so iOS 18 dropped the whole fit.
  // Safari 18 also reads relative units inside atan2 wrong, so the
  // container's size comes in px from registered properties (globals.css).
  const fit = `clamp(0.5, min(tan(atan2(var(--yard-map-width) - ${32 + controls}px, ${bounds.width}px)), tan(atan2(var(--yard-map-height) - 32px, ${bounds.height}px))), 32)`;
  const center = projectYardLocation({
    lat: drawn.center[0],
    lng: drawn.center[1],
  });
  const dx = center.x - (bounds.left + bounds.width / 2);
  const dy = center.y - (bounds.top + bounds.height / 2);
  return {
    scale: `calc(${fit} / ${2 ** (drawn.zoom - 2)})`,
    x: `calc(${dx}px * ${fit} - ${controls / 2}px)`,
    y: `calc(${dy}px * ${fit})`,
  };
}

export type YardMapView = { center: [number, number]; zoom: number };

export function getYardMapView(
  locations: readonly YardLocation[],
  width: number,
  height: number,
): YardMapView {
  const narrow = isNarrowYardMap(width);
  const bounds = getYardMapBounds(locations, narrow);
  const controls = yardMapControlsInset(width);
  // Pigeon uses a 256px world at zoom 0. Reserve 16px around the pins.
  const zoom = Math.max(
    1,
    Math.min(
      7,
      2 +
        Math.log2(
          Math.min(
            Math.max(1, width - 32 - controls) / bounds.width,
            Math.max(1, height - 32) / bounds.height,
          ),
        ),
    ),
  );
  // Center the pins in the area left of the controls.
  const x = bounds.left + bounds.width / 2 + controls / 2 / 2 ** (zoom - 2);
  const y = bounds.top + bounds.height / 2;
  return { center: unprojectYardLocation(x, y), zoom };
}
