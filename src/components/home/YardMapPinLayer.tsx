import type { CSSProperties, ReactNode } from "react";
import {
  projectYardLocation,
  unprojectYardLocation,
  type YardMapView,
} from "~/lib/yard-map-projection";
import type { YardLocation } from "~/lib/yard-directory";

/**
 * Every yard pin in one layer, a child of Pigeon's map. Pigeon redraws each
 * overlay on every frame of a pan or pinch; with hundreds of yards that
 * cost frames on phones. Here Pigeon redraws only this layer: it passes the
 * pixel position of `view`'s center (`left`, `top`) and its live zoom
 * (`mapState`), and the layer follows with one transform. The pins inside
 * sit where they belong at `view`, so they move only when `view` changes.
 * During a pinch the pins' invisible hit boxes scale with the map; the
 * marker canvas draws what the visitor sees at a constant size.
 *
 * While the live zoom differs from `view`'s, the layer is marked zooming and
 * its pins skip paint (globals.css): each pin still painted its hit box on
 * every frame, which cost more than drawing the markers.
 */
export function YardMapPinLayer({
  view,
  left = 0,
  top = 0,
  mapState,
  children,
}: {
  /** The settled view the pins are laid out for. */
  view: YardMapView;
  /**
   * `view`'s center. Pigeon reads it to place the layer, so the layer stays
   * right while Pigeon's own center already differs from `view`'s.
   */
  anchor: [number, number];
  /** Given by Pigeon. */
  left?: number;
  top?: number;
  mapState?: { zoom: number };
  children: ReactNode;
}) {
  const scale = 2 ** ((mapState?.zoom ?? view.zoom) - view.zoom);
  const style = {
    position: "absolute",
    left: 0,
    top: 0,
    transform: `translate(${left}px, ${top}px) scale(${scale})`,
    transformOrigin: "0 0",
  } satisfies CSSProperties;
  return (
    <div
      className="yard-map-pin-layer"
      style={style}
      data-zooming={scale === 1 ? undefined : ""}
    >
      {children}
    </div>
  );
}

/** Pixels between the points the pin layer is anchored to. */
const ANCHOR_CELL_PX = 2048;

/**
 * The view the pin layer is laid out for: `view`'s zoom, centered on the
 * nearest point of a fixed grid instead of `view`'s own center. Panning
 * within a grid cell then keeps every pin's offset, so a pan restyles no
 * pins; the grid keeps offsets small at street zooms.
 */
export function yardMapPinAnchor(view: YardMapView): YardMapView {
  const center = projectYardLocation({
    lat: view.center[0],
    lng: view.center[1],
  });
  const cell = ANCHOR_CELL_PX / 2 ** (view.zoom - 2);
  return {
    center: unprojectYardLocation(
      Math.round(center.x / cell) * cell,
      Math.round(center.y / cell) * cell,
    ),
    zoom: view.zoom,
  };
}

/** Where a yard's pin sits in the layer, in pixels from `view`'s center. */
export function yardMapPinOffset(
  yard: YardLocation,
  view: YardMapView,
): { x: number; y: number } {
  const center = projectYardLocation({
    lat: view.center[0],
    lng: view.center[1],
  });
  const point = projectYardLocation(yard);
  const scale = 2 ** (view.zoom - 2);
  return {
    x: (point.x - center.x) * scale,
    y: (point.y - center.y) * scale,
  };
}
