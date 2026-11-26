import { describe, expect, test } from "bun:test";
import {
  projectYardLocation,
  unprojectYardLocation,
} from "./yard-map-projection";
import { YardMapMarker } from "./yard-map-marker";

const yard = (code: string, lat: number, lng: number) => ({
  source: "test",
  code,
  lat,
  lng,
});

const phoenix = yard("phx", 33.45, -112.07);
const mesa = yard("mesa", 33.42, -111.83);
const tucson = yard("tus", 32.22, -110.97);
const denver = yard("den", 39.74, -104.99);

describe("yard map markers", () => {
  test("yards far apart on screen stay separate pins", () => {
    const markers = YardMapMarker.group([phoenix, denver], 4, null);
    expect(markers.map((marker) => marker.kind)).toEqual(["yard", "yard"]);
  });

  test("yards that would overlap become one cluster at a low zoom", () => {
    const markers = YardMapMarker.group([phoenix, mesa, denver], 4, null);
    expect(markers).toHaveLength(2);
    const cluster = markers.find((marker) => marker.kind === "cluster");
    expect(cluster?.kind === "cluster" && cluster.yards).toEqual([
      phoenix,
      mesa,
    ]);
    expect(cluster?.key).toBe("cluster:test:phx");
  });

  test("the same yards separate once zoomed in", () => {
    const markers = YardMapMarker.group([phoenix, mesa, tucson], 11, null);
    expect(markers.every((marker) => marker.kind === "yard")).toBe(true);
  });

  test("the selected yard always keeps its own pin", () => {
    const markers = YardMapMarker.group([phoenix, mesa, tucson], 3, mesa);
    expect(markers).toContainEqual({
      kind: "yard",
      key: "test:mesa",
      yard: mesa,
    });
    expect(
      markers.some(
        (marker) => marker.kind === "cluster" && marker.yards.includes(mesa),
      ),
    ).toBe(false);
  });

  test("yards at the same spot stop clustering at street zooms", () => {
    const twin = yard("twin", phoenix.lat, phoenix.lng);
    expect(YardMapMarker.group([phoenix, twin], 12, null)).toHaveLength(1);
    expect(YardMapMarker.group([phoenix, twin], 13, null)).toHaveLength(2);
  });

  test("opening a cluster frames its yards far enough apart to pick", () => {
    const [cluster] = YardMapMarker.group([phoenix, mesa], 4, null);
    if (cluster?.kind !== "cluster") throw new Error("expected a cluster");
    const width = 360;
    const height = 280;
    const view = YardMapMarker.split(cluster, width, height);
    expect(view.zoom).toBeGreaterThan(4);
    const regrouped = YardMapMarker.group(cluster.yards, view.zoom, null);
    expect(regrouped.every((marker) => marker.kind === "yard")).toBe(true);
    // Both yards are inside the frame.
    const center = projectYardLocation({
      lat: view.center[0],
      lng: view.center[1],
    });
    const scale = 2 ** (view.zoom - 2);
    for (const member of cluster.yards) {
      const point = projectYardLocation(member);
      expect(Math.abs(point.x - center.x) * scale).toBeLessThan(width / 2);
      expect(Math.abs(point.y - center.y) * scale).toBeLessThan(height / 2);
    }
  });

  test("a cluster at one spot opens at the first zoom that separates it", () => {
    const twin = yard("twin", phoenix.lat, phoenix.lng);
    const [cluster] = YardMapMarker.group([phoenix, twin], 5, null);
    if (cluster?.kind !== "cluster") throw new Error("expected a cluster");
    const view = YardMapMarker.split(cluster, 360, 280);
    expect(view.zoom).toBe(13);
    expect(view.center[0]).toBeCloseTo(phoenix.lat, 6);
    expect(view.center[1]).toBeCloseTo(phoenix.lng, 6);
  });

  test("a group never sits under a separate pin", () => {
    // At zoom 4 one projected unit is 4px. B is 20px east of A and C is 33px
    // east of A: just clear of A, but within 32px of A and B's group, which
    // is drawn halfway between them.
    const at = (code: string, px: number) => {
      const origin = projectYardLocation(phoenix);
      const [lat, lng] = unprojectYardLocation(origin.x + px / 4, origin.y);
      return yard(code, lat, lng);
    };
    const markers = YardMapMarker.group(
      [at("a", 0), at("b", 20), at("c", 33)],
      4,
      null,
    );
    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind === "cluster" && markers[0].yards).toHaveLength(3);
  });

  test("no two drawn markers overlap at any zoom", () => {
    // A deterministic scatter, dense in places, over the lower 48.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    const yards = Array.from({ length: 300 }, (_, index) =>
      yard(String(index), 30 + next() * 15, -120 + next() ** 2 * 45),
    );
    for (const zoom of [3, 4.5, 6, 8, 10, 12]) {
      const scale = 2 ** (zoom - 2);
      const drawn = YardMapMarker.group(yards, zoom, null).map((marker) =>
        projectYardLocation(
          marker.kind === "yard"
            ? marker.yard
            : { lat: marker.center[0], lng: marker.center[1] },
        ),
      );
      drawn.forEach((a, i) =>
        drawn.slice(i + 1).forEach((b) => {
          const apart =
            Math.abs(a.x - b.x) * scale >= 32 ||
            Math.abs(a.y - b.y) * scale >= 32;
          expect(apart).toBe(true);
        }),
      );
    }
  });
});
