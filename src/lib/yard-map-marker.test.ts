import { describe, expect, test } from "bun:test";
import {
  projectYardLocation,
  unprojectYardLocation,
} from "./yard-map-projection";
import { YardMapMarker } from "./yard-map-marker";

const yard = (lat: number, lng: number) => ({ lat, lng });
const phoenix = yard(33.45, -112.07);
const mesa = yard(33.42, -111.83);
const denver = yard(39.74, -104.99);

/** A location `px` pixels east of `origin` at `zoom`. */
const east = (
  origin: { lat: number; lng: number },
  px: number,
  zoom: number,
) => {
  const point = projectYardLocation(origin);
  const [lat, lng] = unprojectYardLocation(
    point.x + px / 2 ** (zoom - 2),
    point.y,
  );
  return yard(lat, lng);
};

describe("yard map marker sizes", () => {
  test("yards whose pins would overlap are dots, lone yards are pins", () => {
    expect(YardMapMarker.sizes([phoenix, mesa, denver], 4)).toEqual([
      "dot",
      "dot",
      "pin",
    ]);
  });

  test("dots grow into pins once zoomed in far enough to separate", () => {
    expect(YardMapMarker.sizes([phoenix, mesa, denver], 11)).toEqual([
      "pin",
      "pin",
      "pin",
    ]);
  });

  test("pins separate at the full pin size", () => {
    const zoom = 6;
    expect(
      YardMapMarker.sizes([phoenix, east(phoenix, 31, zoom)], zoom),
    ).toEqual(["dot", "dot"]);
    expect(
      YardMapMarker.sizes([phoenix, east(phoenix, 33, zoom)], zoom),
    ).toEqual(["pin", "pin"]);
  });

  test("yards at the same spot stay dots at every zoom", () => {
    expect(YardMapMarker.sizes([phoenix, phoenix], 18)).toEqual(["dot", "dot"]);
  });

  test("sizing compares only nearby yards, not every pair", () => {
    // 50,000 yards over the lower 48 at a zoom where few are near each other.
    // The sweep takes tens of milliseconds; comparing every pair (over a
    // billion comparisons) takes many seconds, so the generous limit only
    // fails on a quadratic regression, not on a slow machine.
    let seed = 11;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const yards = Array.from({ length: 50_000 }, () =>
      yard(30 + next() * 15, -120 + next() * 45),
    );
    const started = performance.now();
    expect(YardMapMarker.sizes(yards, 10)).toHaveLength(50_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("yard map taps", () => {
  const markers = [
    { key: "a", x: 100, y: 100 },
    { key: "b", x: 106, y: 103 },
    { key: "c", x: 118, y: 100 },
    { key: "d", x: 200, y: 200 },
  ];

  test("a tap on stacked dots hits every marker under it, nearest first", () => {
    expect(YardMapMarker.hits(markers, { x: 104, y: 102 })).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("a tap on a lone pin hits only that pin", () => {
    expect(YardMapMarker.hits(markers, { x: 205, y: 190 })).toEqual(["d"]);
  });

  test("a tap away from every marker hits nothing", () => {
    expect(YardMapMarker.hits(markers, { x: 160, y: 150 })).toEqual([]);
  });
});

describe("what a tap does", () => {
  test("one yard opens, a few are listed, a crowd zooms in", () => {
    expect(YardMapMarker.tap(1, 4)).toBe("select");
    expect(YardMapMarker.tap(2, 4)).toBe("choose");
    expect(YardMapMarker.tap(6, 4)).toBe("choose");
    expect(YardMapMarker.tap(7, 4)).toBe("zoom");
  });

  test("at street zooms a crowd is listed, since it may never separate", () => {
    expect(YardMapMarker.tap(30, 13)).toBe("choose");
  });

  test("zooming in on a crowd frames its yards past the current zoom", () => {
    const crowd = [phoenix, mesa, east(phoenix, 10, 4)];
    const view = YardMapMarker.frame(crowd, 4, 360, 280);
    expect(view.zoom).toBeGreaterThan(5);
    expect(view.zoom).toBeLessThanOrEqual(13);
    const center = projectYardLocation({
      lat: view.center[0],
      lng: view.center[1],
    });
    const scale = 2 ** (view.zoom - 2);
    for (const yard of crowd) {
      const point = projectYardLocation(yard);
      expect(Math.abs(point.x - center.x) * scale).toBeLessThan(180);
      expect(Math.abs(point.y - center.y) * scale).toBeLessThan(140);
    }
  });

  test("a crowd at one spot zooms straight to street level, where it is listed", () => {
    expect(YardMapMarker.frame([phoenix, phoenix], 4, 360, 280).zoom).toBe(13);
    expect(YardMapMarker.frame([phoenix, mesa], 12.5, 360, 280).zoom).toBe(13);
  });
});
