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
 * Screen-space grouping: any two markers whose square hit boxes, centered
 * where they are drawn, would overlap merge into one group drawn at its
 * yards' average position, until no two overlap. Checking the drawn
 * position, not the first yard's, keeps a group from landing under a
 * neighboring pin. `keep`, the selected yard, always keeps its own pin so
 * the open yard card points at it.
 */
function group<Yard extends MarkerYard>(
  yards: readonly Yard[],
  zoom: number,
  keep: Yard | null,
): YardMapMarker<Yard>[] {
  const scale = pixelsPerUnit(zoom);
  type Group = { members: number[]; x: number; y: number; kept: boolean };
  const groups: Group[] = yards.map((yard, index) => {
    const point = projectYardLocation(yard);
    return {
      members: [index],
      x: point.x,
      y: point.y,
      kept: yard === keep,
    };
  });
  const overlaps = (a: Group, b: Group) =>
    !a.kept &&
    !b.kept &&
    Math.abs(a.x - b.x) * scale < CLUSTER_PX &&
    Math.abs(a.y - b.y) * scale < CLUSTER_PX;

  // A merge moves its group, which can bring it over a group already
  // checked, so repeat until a full pass merges nothing.
  let merged = zoom < UNCLUSTERED_ZOOM;
  while (merged) {
    merged = false;
    for (let i = 0; i < groups.length; i++) {
      const target = groups[i];
      if (!target) continue;
      for (let j = i + 1; j < groups.length; j++) {
        const other = groups[j];
        if (!other || !overlaps(target, other)) continue;
        const count = target.members.length + other.members.length;
        target.x =
          (target.x * target.members.length + other.x * other.members.length) /
          count;
        target.y =
          (target.y * target.members.length + other.y * other.members.length) /
          count;
        target.members.push(...other.members);
        groups.splice(j, 1);
        merged = true;
        // The group moved: check every later group again.
        j = i;
      }
    }
  }

  // Every group holds at least one yard, so none is dropped here.
  return groups.flatMap((group): YardMapMarker<Yard>[] => {
    const members = [...group.members]
      .sort((a, b) => a - b)
      .flatMap((index) => yards[index] ?? []);
    const [first] = members;
    if (!first) return [];
    if (members.length === 1) {
      return [{ kind: "yard", key: YardPath.key(first), yard: first }];
    }
    return [
      {
        kind: "cluster",
        key: `cluster:${YardPath.key(first)}`,
        yards: members,
        center: unprojectYardLocation(group.x, group.y),
      },
    ];
  });
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
