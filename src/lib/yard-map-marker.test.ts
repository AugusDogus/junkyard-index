import { describe, expect, test } from "bun:test";
import { projectYardLocation } from "./yard-map-projection";
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
});
