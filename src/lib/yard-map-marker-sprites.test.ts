import { describe, expect, test } from "bun:test";
import {
  YardMapMarkerPaint,
  type YardMarkerContext,
  type YardMarkerLook,
} from "./yard-map-marker-paint";
import {
  YardMapMarkerSprites,
  type YardMarkerStampContext,
} from "./yard-map-marker-sprites";

type Circle = { x: number; y: number; radius: number; color: string };

/** A context that records the circles it fills. */
function circles() {
  const filled: Circle[] = [];
  let path: Omit<Circle, "color"> | null = null;
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
      if (path) filled.push({ ...path, color: String(context.fillStyle) });
    },
    stroke() {},
  };
  return { context, filled };
}

type Sprite = { side: number; filled: Circle[] };

/** A stamp whose sprites record their circles, and the canvas it stamps on. */
function stamper() {
  const rendered: Sprite[] = [];
  const stamp = YardMapMarkerSprites.create((side, paint) => {
    const { context, filled } = circles();
    paint(context);
    const sprite = { side, filled };
    rendered.push(sprite);
    return sprite;
  });
  const target = circles();
  const images: { sprite: Sprite; x: number; y: number; w: number }[] = [];
  const context: YardMarkerStampContext<Sprite> = {
    ...target.context,
    drawImage(sprite, x, y, w) {
      images.push({ sprite, x, y, w });
    },
  };
  return { stamp, rendered, context, images, shapes: target.filled };
}

const colors = { paper: "paper", ink: "ink", signal: "signal" };
const look = (overrides: Partial<YardMarkerLook>): YardMarkerLook => ({
  x: 100.5,
  y: 40,
  size: YardMapMarkerPaint.DOT_PX,
  emphasis: 1,
  selected: false,
  ...overrides,
});

describe("YardMapMarkerSprites", () => {
  test("stamps plain dots and pins from one sprite per size, centered on the marker", () => {
    const { stamp, rendered, context, images, shapes } = stamper();
    const density = 2;
    for (const x of [100.5, 200, 300.5]) {
      stamp(context, look({ x }), colors, density);
      stamp(context, look({ x, size: YardMapMarkerPaint.PIN_PX }), colors, 2);
    }
    expect(shapes).toEqual([]);
    expect(rendered).toHaveLength(2);
    expect(images).toHaveLength(6);
    for (const image of images) {
      // The sprite's center, in CSS pixels, lands on the marker's.
      const center = image.x + image.w / 2;
      expect([100.5, 200, 300.5]).toContain(center);
      expect(image.w).toBe(image.sprite.side / density);
      expect(image.y + image.w / 2).toBe(40);
    }
  });

  test("a sprite holds the marker's own shape, in device pixels on a pixel corner", () => {
    const { stamp, rendered, context } = stamper();
    stamp(context, look({ size: YardMapMarkerPaint.PIN_PX }), colors, 2.625);
    const [sprite] = rendered;
    if (!sprite) throw new Error("No sprite was rendered.");
    // The shape at 2.625x: a 12px paper disc and its ink 1px inside.
    const shape = circles();
    YardMapMarkerPaint.shape(
      shape.context,
      {
        x: sprite.side / 2,
        y: sprite.side / 2,
        size: 12 * 2.625,
        emphasis: 2.625,
        selected: false,
      },
      colors,
    );
    expect(sprite.filled).toEqual(shape.filled);
    expect(sprite.filled.map((circle) => circle.radius)).toEqual([
      6 * 2.625,
      5 * 2.625,
    ]);
    expect(Number.isInteger(sprite.side / 2)).toBe(true);
    // Room for the disc and its antialiasing.
    expect(sprite.side).toBeGreaterThanOrEqual(12 * 2.625 + 2);
  });

  test("hovered, open and resizing markers are drawn as shapes", () => {
    const { stamp, rendered, context, images, shapes } = stamper();
    stamp(context, look({ size: 10, emphasis: 1.25 }), colors, 2);
    stamp(
      context,
      look({ size: 16.2, emphasis: 1.35, selected: true }),
      colors,
      2,
    );
    stamp(context, look({ size: 9.3 }), colors, 2);
    expect(images).toEqual([]);
    expect(rendered).toEqual([]);
    const radii = [5, 5 - 1.25, 8.1, 8.1 - 1.35, 4.65, 4.65 - 1];
    expect(shapes).toHaveLength(radii.length);
    shapes.forEach((circle, index) =>
      expect(circle.radius).toBeCloseTo(radii[index] ?? Number.NaN),
    );
  });

  test("a new density or theme renders new sprites", () => {
    const { stamp, rendered, context } = stamper();
    stamp(context, look({}), colors, 2);
    stamp(context, look({}), colors, 3);
    stamp(context, look({}), { ...colors, ink: "light ink" }, 3);
    stamp(context, look({}), colors, 2);
    expect(rendered.map((sprite) => sprite.filled[1]?.color)).toEqual([
      "ink",
      "ink",
      "light ink",
    ]);
  });
});
