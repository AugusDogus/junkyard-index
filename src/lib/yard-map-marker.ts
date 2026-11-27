import type { YardLocation } from "./yard-directory";
import {
  projectYardLocation,
  unprojectYardLocation,
  type YardMapView,
} from "./yard-map-projection";

/**
 * How a yard's marker is drawn at one zoom. Every yard always gets its own
 * marker, so the map shows everything indexed: a small `dot` while its pin
 * would overlap a neighbor's, and the full `pin` once it stands clear.
 */
export type YardMapMarkerSize = "dot" | "pin";

/** The pin's square hit box, in pixels. Pins closer than this overlap. */
const PIN_PX = 32;

/** At most this many yards under one tap are listed; more zoom in instead. */
const CHOICE_MAX = 6;
/** From this zoom on, a tap lists its yards however many there are. */
const LIST_ALWAYS_ZOOM = 13;
/** Space kept around tapped yards when zooming in to separate them. */
const FRAME_PADDING_PX = 48;

/**
 * What a tap on `count` yards does: open the one yard, list a few to pick
 * from, or zoom in on a crowd too long to list. At street zooms it lists,
 * since yards at the same spot never separate.
 */
export type YardMapTap = "select" | "choose" | "zoom";

/** Projected units to screen pixels at `zoom` (Pigeon's 256px world at 0). */
const pixelsPerUnit = (zoom: number) => 2 ** (zoom - 2);

/** Zoom steps per level that marker sizes are worked out at. */
const SIZE_STEPS_PER_ZOOM = 8;

/**
 * The zoom step `zoom`'s marker sizes are worked out at. Every caller sizes
 * through it (`sizes`), so the server's static dots and the canvas agree, and
 * a pinch re-sizes only when it crosses a step.
 */
const sizeZoom = (zoom: number) =>
  Math.round(zoom * SIZE_STEPS_PER_ZOOM) / SIZE_STEPS_PER_ZOOM;

/**
 * Sizes `yards` at any zoom, in the same order as `yards`. The yards are
 * projected and ordered along x once; a sweep along x then compares only
 * yards less than a pin apart, so each zoom sizes hundreds of yards in well
 * under a millisecond. Each zoom step is worked out once, so a pinch back
 * and forth sizes nothing again.
 */
function sizer(
  yards: readonly YardLocation[],
): (zoom: number) => readonly YardMapMarkerSize[] {
  const points = yards.map(projectYardLocation);
  const order = points
    .map((_, index) => index)
    .sort((a, b) => (points[a]?.x ?? 0) - (points[b]?.x ?? 0));
  const known = new Map<number, YardMapMarkerSize[]>();
  return (zoom) => {
    const step = sizeZoom(zoom);
    const cached = known.get(step);
    if (cached) return cached;
    const scale = pixelsPerUnit(step);
    const crowded = new Set<number>();
    order.forEach((index, position) => {
      const point = points[index];
      if (!point) return;
      for (let next = position + 1; next < order.length; next++) {
        const otherIndex = order[next];
        const other = otherIndex === undefined ? undefined : points[otherIndex];
        if (otherIndex === undefined || !other) continue;
        if ((other.x - point.x) * scale >= PIN_PX) break;
        if (Math.abs(other.y - point.y) * scale < PIN_PX) {
          crowded.add(index);
          crowded.add(otherIndex);
        }
      }
    });
    const sized = yards.map(
      (_, index): YardMapMarkerSize => (crowded.has(index) ? "dot" : "pin"),
    );
    known.set(step, sized);
    return sized;
  };
}

/** Each yard's size at `zoom`'s step (`sizeZoom`), in the order of `yards`. */
function sizes(
  yards: readonly YardLocation[],
  zoom: number,
): readonly YardMapMarkerSize[] {
  return sizer(yards)(zoom);
}

/**
 * The markers a tap at `at` lands on, nearest first: every marker whose
 * pin-sized hit box, centered on the marker, contains the point. On stacked
 * dots that is all of them; on a pin standing clear, just that pin.
 */
function hits<Key>(
  markers: readonly { key: Key; x: number; y: number }[],
  at: { x: number; y: number },
): Key[] {
  return markers
    .map((marker) => ({
      key: marker.key,
      dx: Math.abs(marker.x - at.x),
      dy: Math.abs(marker.y - at.y),
    }))
    .filter(({ dx, dy }) => dx < PIN_PX / 2 && dy < PIN_PX / 2)
    .sort((a, b) => Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy))
    .map(({ key }) => key);
}

function tap(count: number, zoom: number): YardMapTap {
  if (count <= 1) return "select";
  return count <= CHOICE_MAX || zoom >= LIST_ALWAYS_ZOOM ? "choose" : "zoom";
}

/**
 * The view that frames `yards` in a `width` x `height` map, zoomed in at
 * least one step past `zoom` and at most to the zoom where lists take over.
 */
function frame(
  yards: readonly YardLocation[],
  zoom: number,
  width: number,
  height: number,
): YardMapView {
  const points = yards.map(projectYardLocation);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const fit = Math.min(
    Math.max(1, width - 2 * FRAME_PADDING_PX) / Math.max(right - left, 1e-9),
    Math.max(1, height - 2 * FRAME_PADDING_PX) / Math.max(bottom - top, 1e-9),
  );
  return {
    center: unprojectYardLocation((left + right) / 2, (top + bottom) / 2),
    zoom: Math.min(LIST_ALWAYS_ZOOM, Math.max(zoom + 1, 2 + Math.log2(fit))),
  };
}

export const YardMapMarker = {
  sizeZoom,
  sizer,
  sizes,
  hits,
  tap,
  frame,
} as const;
