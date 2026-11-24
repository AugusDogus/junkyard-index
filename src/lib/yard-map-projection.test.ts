import { describe, expect, test } from "bun:test";
import {
  getYardMapBounds,
  getYardMapView,
  hasMapCoordinates,
  projectYardLocation,
  type YardMapView,
} from "./yard-map-projection";

/** Where a location lands in a viewport showing `view`, in pixels. */
function onScreen(
  view: YardMapView,
  location: { lat: number; lng: number },
  width: number,
  height: number,
) {
  const center = projectYardLocation({
    lat: view.center[0],
    lng: view.center[1],
  });
  const point = projectYardLocation(location);
  const scale = 2 ** (view.zoom - 2);
  return {
    x: width / 2 + (point.x - center.x) * scale,
    y: height / 2 + (point.y - center.y) * scale,
  };
}

describe("yard map projection", () => {
  test("uses Web Mercator coordinates and keeps the poles finite", () => {
    expect(projectYardLocation({ lat: 0, lng: 0 })).toEqual({ x: 512, y: 512 });
    expect(projectYardLocation({ lat: 0, lng: -90 })).toEqual({
      x: 256,
      y: 512,
    });
    expect(projectYardLocation({ lat: 85.05112878, lng: 180 }).y).toBeCloseTo(
      0,
    );
    expect(Number.isFinite(projectYardLocation({ lat: -90, lng: 0 }).y)).toBe(
      true,
    );
  });

  test("fits every valid yard, including locations outside the initial coverage", () => {
    const locations = [
      { lat: 61.2, lng: -149.9 },
      { lat: 21.3, lng: -157.8 },
      { lat: 47.6, lng: -52.7 },
    ];
    const bounds = getYardMapBounds(locations);
    for (const location of locations) {
      const point = projectYardLocation(location);
      expect(point.x).toBeGreaterThan(bounds.left);
      expect(point.x).toBeLessThan(bounds.left + bounds.width);
      expect(point.y).toBeGreaterThan(bounds.top);
      expect(point.y).toBeLessThan(bounds.top + bounds.height);
    }
  });

  test("fits all yards inside desktop viewports", () => {
    const locations = [
      { lat: 61.2, lng: -149.9 },
      { lat: 25.8, lng: -80.2 },
    ];
    const width = 916;
    const height = 512;
    const view = getYardMapView(locations, width, height);
    for (const location of locations) {
      const point = onScreen(view, location, width, height);
      expect(point.x).toBeGreaterThan(12);
      expect(point.x).toBeLessThan(width - 12);
      expect(point.y).toBeGreaterThan(12);
      expect(point.y).toBeLessThan(height - 12);
    }
  });

  test("phones fit the lower 48 and Canada clear of the controls, leaving Alaska and Hawaii to panning", () => {
    const anchorage = { lat: 61.2, lng: -149.9 };
    const honolulu = { lat: 21.3, lng: -157.8 };
    const shown = [
      { lat: 44.34, lng: -69.66 }, // Maine
      { lat: 25.8, lng: -80.2 }, // Miami
      { lat: 32.7, lng: -117.1 }, // San Diego
      { lat: 53.57, lng: -113.65 }, // Edmonton
    ];
    const width = 356;
    const height = 285;
    const view = getYardMapView([anchorage, honolulu, ...shown], width, height);
    for (const location of shown) {
      const point = onScreen(view, location, width, height);
      expect(point.x).toBeGreaterThan(12);
      // The zoom and fullscreen buttons take the right edge.
      expect(point.x).toBeLessThan(width - 56);
      expect(point.y).toBeGreaterThan(12);
      expect(point.y).toBeLessThan(height - 12);
    }
    // Alaska no longer shrinks the map to a corner.
    expect(onScreen(view, anchorage, width, height).x).toBeLessThan(0);
    expect(getYardMapBounds([anchorage, ...shown], true)).toEqual(
      getYardMapBounds(shown, true),
    );
  });

  test("ignores missing-coordinate sentinels and invalid locations", () => {
    const invalid = [
      { lat: 0, lng: 0 },
      { lat: 91, lng: -80 },
      { lat: 40, lng: NaN },
      { lat: 40, lng: 181 },
    ];
    expect(invalid.some(hasMapCoordinates)).toBe(false);
    expect(getYardMapBounds(invalid)).toEqual(getYardMapBounds([]));
  });
});
