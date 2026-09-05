import { describe, expect, test } from "bun:test";
import {
  getYardMapOverview,
  hasMapCoordinates,
  projectYardLocation,
} from "./yard-map-projection";

describe("yard map overview", () => {
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
    const bounds = getYardMapOverview(locations);
    for (const location of locations) {
      const point = projectYardLocation(location);
      expect(point.x).toBeGreaterThan(bounds.left);
      expect(point.x).toBeLessThan(bounds.left + bounds.width);
      expect(point.y).toBeGreaterThan(bounds.top);
      expect(point.y).toBeLessThan(bounds.top + bounds.height);
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
    expect(getYardMapOverview(invalid)).toEqual(getYardMapOverview([]));
  });
});
