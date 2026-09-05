import { describe, expect, test } from "bun:test";
import {
  getYardMapBounds,
  getYardMapView,
  hasMapCoordinates,
  projectYardLocation,
} from "./yard-map-projection";

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

  test("fits all yards inside mobile and desktop viewports", () => {
    const locations = [
      { lat: 61.2, lng: -149.9 },
      { lat: 25.8, lng: -80.2 },
    ];
    for (const { width, height } of [
      { width: 343, height: 203 },
      { width: 916, height: 512 },
    ]) {
      const view = getYardMapView(locations, width, height);
      const center = projectYardLocation({
        lat: view.center[0],
        lng: view.center[1],
      });
      for (const location of locations) {
        const point = projectYardLocation(location);
        const scale = 2 ** (view.zoom - 2);
        expect(Math.abs(point.x - center.x) * scale).toBeLessThan(
          width / 2 - 12,
        );
        expect(Math.abs(point.y - center.y) * scale).toBeLessThan(
          height / 2 - 12,
        );
      }
    }
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
