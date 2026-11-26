import { describe, expect, test } from "bun:test";
import type { YardMapMarkerSize } from "./yard-map-marker";
import {
  YardMapMarkerPaint,
  type YardMarkerContext,
  type YardMarkerFrame,
  type YardMarkerTween,
} from "./yard-map-marker-paint";

type Arc = {
  x: number;
  y: number;
  radius: number;
  paint: "fill" | "stroke";
  color: string;
  lineWidth: number;
};

/** A 2D context that records each circle it fills or strokes. */
function recordingContext() {
  const arcs: Arc[] = [];
  let path: Omit<Arc, "paint" | "color" | "lineWidth"> | null = null;
  const context: YardMarkerContext = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    beginPath() {
      path = null;
    },
    arc(x, y, radius) {
      path = { x, y, radius };
    },
    fill() {
      if (path) {
        arcs.push({
          ...path,
          paint: "fill",
          color: String(context.fillStyle),
          lineWidth: 0,
        });
      }
    },
    stroke() {
      if (path) {
        arcs.push({
          ...path,
          paint: "stroke",
          color: String(context.strokeStyle),
          lineWidth: context.lineWidth,
        });
      }
    },
  };
  return { context, arcs };
}

const colors = { paper: "paper", ink: "ink", signal: "signal" };

/** Three yards in a row 100 projected units apart, around the map center. */
const view = (
  sizes: readonly YardMapMarkerSize[],
  overrides: Partial<YardMarkerFrame> = {},
): YardMarkerFrame => ({
  markers: [
    { key: "a", x: 400, y: 300 },
    { key: "b", x: 500, y: 300 },
    { key: "c", x: 600, y: 300 },
  ],
  sizes,
  selectedKey: null,
  hoveredKey: null,
  center: { x: 500, y: 300 },
  origin: [200, 150],
  // One pixel per projected unit.
  zoom: 2,
  width: 400,
  height: 300,
  density: 2,
  reduceMotion: false,
  now: 1000,
  ...overrides,
});

const outer = (arcs: readonly Arc[]) =>
  arcs.filter((arc) => arc.paint === "fill" && arc.color === "paper");

describe("YardMapMarkerPaint.frame", () => {
  test("places each yard from the live center and zoom at a constant size", () => {
    const { context, arcs } = recordingContext();
    YardMapMarkerPaint.frame(
      context,
      view(["pin", "dot", "pin"], { center: { x: 500, y: 250 }, zoom: 2 }),
      colors,
      new Map(),
    );
    expect(outer(arcs)).toEqual([
      expect.objectContaining({ x: 100, y: 200, radius: 6 }),
      expect.objectContaining({ x: 200, y: 200, radius: 4 }),
      expect.objectContaining({ x: 300, y: 200, radius: 6 }),
    ]);
    // A 1px paper halo around the ink.
    expect(arcs.filter((arc) => arc.color === "ink")).toEqual([
      expect.objectContaining({ radius: 5 }),
      expect.objectContaining({ radius: 3 }),
      expect.objectContaining({ radius: 5 }),
    ]);

    // Zoomed in one step: twice as far apart, the same size.
    const zoomed = recordingContext();
    YardMapMarkerPaint.frame(
      zoomed.context,
      view(["pin", "dot", "pin"], { zoom: 3 }),
      colors,
      new Map(),
    );
    expect(outer(zoomed.arcs).map(({ x, radius }) => [x, radius])).toEqual([
      [0, 6],
      [200, 4],
      [400, 6],
    ]);
  });

  test("snaps centers to device pixels and skips yards off the canvas", () => {
    const { context, arcs } = recordingContext();
    YardMapMarkerPaint.frame(
      context,
      view(["pin", "pin", "pin"], {
        origin: [200.3, 150.2],
        // `a` is 1000px left of the canvas.
        zoom: 2 + Math.log2(10),
        width: 4000,
      }),
      colors,
      new Map(),
    );
    expect(outer(arcs).map(({ x, y }) => [x, y])).toEqual([
      [200.5, 150],
      [1200.5, 150],
    ]);
  });

  test("draws the hovered and then the open yard on top, larger, the open one ringed", () => {
    const { context, arcs } = recordingContext();
    YardMapMarkerPaint.frame(
      context,
      view(["dot", "dot", "dot"], {
        selectedKey: "a",
        hoveredKey: "b",
        reduceMotion: true,
      }),
      colors,
      new Map(),
    );
    const rounded = (value: number) => Math.round(value * 1000) / 1000;
    expect(outer(arcs).map(({ x, radius }) => [x, rounded(radius)])).toEqual([
      [300, 4],
      // Hovered: the dot at 1.25x.
      [200, 5],
      // Open: full size at 1.35x, even where crowded.
      [100, 8.1],
    ]);
    const [, fill, ring] = arcs.slice(-3);
    expect(fill?.color).toBe("signal");
    expect(fill?.radius).toBeCloseTo(8.1 - 1.35);
    expect(ring).toMatchObject({ paint: "stroke", color: "signal" });
    expect(ring?.radius).toBeCloseTo(8.1 + 3 * 1.35);
    expect(ring?.lineWidth).toBeCloseTo(2 * 1.35);
  });

  test("eases a size change and asks for frames until it ends", () => {
    const tweens = new Map<string, YardMarkerTween>();
    const draw = (sizes: readonly YardMapMarkerSize[], now: number) => {
      const { context, arcs } = recordingContext();
      const animating = YardMapMarkerPaint.frame(
        context,
        view(sizes, { now }),
        colors,
        tweens,
      );
      return { animating, radius: outer(arcs)[1]?.radius };
    };
    expect(draw(["dot", "dot", "dot"], 1000)).toEqual({
      animating: false,
      radius: 4,
    });
    expect(draw(["dot", "pin", "dot"], 1000)).toEqual({
      animating: true,
      radius: 4,
    });
    const halfway = draw(["dot", "pin", "dot"], 1060);
    expect(halfway.animating).toBe(true);
    expect(halfway.radius).toBeGreaterThan(4);
    expect(halfway.radius).toBeLessThan(6);
    expect(draw(["dot", "pin", "dot"], 1120)).toEqual({
      animating: false,
      radius: 6,
    });
  });

  test("a frame timed before its tween started stays between the two sizes", () => {
    // A tween starts in a layout effect with performance.now(); the next
    // requestAnimationFrame can carry an earlier timestamp. Unclamped, the
    // easing ran backwards and drew markers past either size, or inverted.
    for (const [from, to] of [
      ["dot", "pin"],
      ["pin", "dot"],
    ] as const) {
      const tweens = new Map<string, YardMarkerTween>();
      const { context } = recordingContext();
      YardMapMarkerPaint.frame(
        context,
        view([from, from, from]),
        colors,
        tweens,
      );
      YardMapMarkerPaint.frame(context, view([to, to, to]), colors, tweens);
      for (const early of [1, 16, 100, 1000]) {
        const drawn = recordingContext();
        YardMapMarkerPaint.frame(
          drawn.context,
          view([to, to, to], { now: 1000 - early }),
          colors,
          tweens,
        );
        for (const arc of drawn.arcs) {
          if (arc.paint !== "fill") continue;
          expect(arc.radius).toBeGreaterThanOrEqual(0);
        }
        for (const arc of outer(drawn.arcs)) {
          expect(arc.radius).toBeGreaterThanOrEqual(4);
          expect(arc.radius).toBeLessThanOrEqual(6);
        }
      }
    }
  });
});
