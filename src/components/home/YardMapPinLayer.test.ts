import { expect, test } from "bun:test";
import {
  projectYardLocation,
  unprojectYardLocation,
  type YardMapView,
} from "~/lib/yard-map-projection";
import { yardMapPinAnchor, yardMapPinOffset } from "./YardMapPinLayer";

/** `view` panned by `dx`, `dy` screen pixels. */
const pan = (view: YardMapView, dx: number, dy: number): YardMapView => {
  const center = projectYardLocation({
    lat: view.center[0],
    lng: view.center[1],
  });
  const scale = 2 ** (view.zoom - 2);
  return {
    center: unprojectYardLocation(center.x + dx / scale, center.y + dy / scale),
    zoom: view.zoom,
  };
};

const yard = { lat: 35.2, lng: -80.8 };

test("panning within a grid cell keeps every pin's offset", () => {
  for (const zoom of [4, 7.3, 12, 18]) {
    const view = pan(yardMapPinAnchor({ center: [35, -81], zoom }), 300, -200);
    const anchor = yardMapPinAnchor(view);
    expect(yardMapPinAnchor(pan(view, 120, 80))).toEqual(anchor);
    expect(yardMapPinAnchor(pan(view, -150, 40))).toEqual(anchor);
    expect(anchor.zoom).toBe(zoom);
  }
});

test("pins anchored to the grid land where the view puts them", () => {
  for (const zoom of [4, 9.5, 18]) {
    const view: YardMapView = { center: [35.21, -80.79], zoom };
    const anchor = yardMapPinAnchor(view);
    // The anchor's offset from the view's center, plus the pin's from the
    // anchor, is the pin's offset from the center.
    const fromCenter = yardMapPinOffset(yard, view);
    const anchorFromCenter = yardMapPinOffset(
      { lat: anchor.center[0], lng: anchor.center[1] },
      view,
    );
    const fromAnchor = yardMapPinOffset(yard, anchor);
    expect(anchorFromCenter.x + fromAnchor.x).toBeCloseTo(fromCenter.x, 3);
    expect(anchorFromCenter.y + fromAnchor.y).toBeCloseTo(fromCenter.y, 3);
    // Within a cell of the view, so offsets stay small at street zooms.
    expect(Math.abs(anchorFromCenter.x)).toBeLessThanOrEqual(1024);
    expect(Math.abs(anchorFromCenter.y)).toBeLessThanOrEqual(1024);
  }
});
