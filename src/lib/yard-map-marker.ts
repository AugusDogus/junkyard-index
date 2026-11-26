import type { YardLocation } from "./yard-directory";
import { YardPath } from "./yard-path";
import {
  projectYardLocation,
  unprojectYardLocation,
  type YardMapView,
} from "./yard-map-projection";

type MarkerYard = YardLocation & { source: string; code: string };

/**
 * What the yard map draws at one zoom: a yard's own pin, or a numbered
 * cluster of yards whose pins would overlap. Clusters keep dense areas
 * tappable; opening one zooms in until its yards separate.
 */
export type YardMapMarker<Yard extends MarkerYard> =
  | { kind: "yard"; key: string; yard: Yard }
  | {
      kind: "cluster";
      key: string;
      yards: Yard[];
      center: [number, number];
    };

/** Pins whose square hit boxes, this many pixels wide, would overlap share a cluster. */
const CLUSTER_PX = 32;
/** From this zoom on, every yard gets its own pin, even at the same spot. */
const UNCLUSTERED_ZOOM = 13;
/** Space kept around a cluster's yards when it opens. */
const SPLIT_PADDING_PX = 48;

/** Projected units to screen pixels at `zoom` (Pigeon's 256px world at 0). */
const pixelsPerUnit = (zoom: number) => 2 ** (zoom - 2);

/**
 * Greedy screen-space grouping in input order: each yard not yet placed
 * gathers the later yards whose pins would overlap its pin. `keep`, the selected
 * yard, always keeps its own pin so the open yard card points at it.
 */
function group<Yard extends MarkerYard>(
  yards: readonly Yard[],
  zoom: number,
  keep: Yard | null,
): YardMapMarker<Yard>[] {
  const scale = pixelsPerUnit(zoom);
  const points = yards.map(projectYardLocation);
  const placed = new Set<number>();
  const markers: YardMapMarker<Yard>[] = [];
  yards.forEach((seed, seedIndex) => {
    if (placed.has(seedIndex)) return;
    placed.add(seedIndex);
    const seedPoint = points[seedIndex];
    const members = [seedIndex];
    if (seed !== keep && seedPoint && zoom < UNCLUSTERED_ZOOM) {
      for (let index = seedIndex + 1; index < yards.length; index++) {
        const point = points[index];
        if (placed.has(index) || yards[index] === keep || !point) continue;
        // Square hit boxes overlap when both offsets are under their size.
        if (
          Math.abs(point.x - seedPoint.x) * scale < CLUSTER_PX &&
          Math.abs(point.y - seedPoint.y) * scale < CLUSTER_PX
        ) {
          placed.add(index);
          members.push(index);
        }
      }
    }
    if (members.length === 1) {
      markers.push({ kind: "yard", key: YardPath.key(seed), yard: seed });
      return;
    }
    const memberPoints = members.flatMap((index) => points[index] ?? []);
    const x =
      memberPoints.reduce((total, point) => total + point.x, 0) /
      memberPoints.length;
    const y =
      memberPoints.reduce((total, point) => total + point.y, 0) /
      memberPoints.length;
    markers.push({
      kind: "cluster",
      key: `cluster:${YardPath.key(seed)}`,
      yards: members.flatMap((index) => yards[index] ?? []),
      center: unprojectYardLocation(x, y),
    });
  });
  return markers;
}

/** The view that frames a cluster's yards in a `width` x `height` map. */
function split<Yard extends MarkerYard>(
  cluster: Extract<YardMapMarker<Yard>, { kind: "cluster" }>,
  width: number,
  height: number,
): YardMapView {
  const points = cluster.yards.map(projectYardLocation);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const fit = Math.min(
    Math.max(1, width - 2 * SPLIT_PADDING_PX) / Math.max(right - left, 1e-9),
    Math.max(1, height - 2 * SPLIT_PADDING_PX) / Math.max(bottom - top, 1e-9),
  );
  return {
    center: unprojectYardLocation((left + right) / 2, (top + bottom) / 2),
    zoom: Math.max(1, Math.min(UNCLUSTERED_ZOOM, 2 + Math.log2(fit))),
  };
}

export const YardMapMarker = { group, split } as const;
