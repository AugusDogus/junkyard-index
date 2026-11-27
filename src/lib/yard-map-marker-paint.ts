import type { YardMapMarkerSize } from "./yard-map-marker";

/** A marker's full diameter in CSS pixels, halo included. */
const DOT_PX = 8;
const PIN_PX = 12;
const HOVER_SCALE = 1.25;
const SELECTED_SCALE = 1.35;
/** --dur-micro, the size change between dot and pin. */
const GROW_MS = 120;
/** Markers this far off the canvas cannot reach it, ring included. */
const MARGIN_PX = 24;

/** The theme's marker colors. */
export type YardMarkerColors = { paper: string; ink: string; signal: string };

/** A marker's size change in progress, in CSS pixels from `start`. */
export type YardMarkerTween = { from: number; to: number; start: number };

/** The 2D canvas calls the markers draw with. */
export type YardMarkerContext = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "arc"
  | "fill"
  | "stroke"
  | "fillStyle"
  | "strokeStyle"
  | "lineWidth"
>;

/** One marker as drawn: its center and diameter, in CSS pixels. */
export type YardMarkerLook = {
  x: number;
  y: number;
  size: number;
  /** The hover or selection scale; the edges grow with it. */
  emphasis: number;
  selected: boolean;
};

/** One frame of every marker, from Pigeon's live view. */
export type YardMarkerFrame = {
  /** Each yard's key and projected location (`projectYardLocation`). */
  markers: readonly { key: string; x: number; y: number }[];
  /** Each marker's size at the live zoom, in the same order. */
  sizes: readonly YardMapMarkerSize[];
  selectedKey: string | null;
  hoveredKey: string | null;
  /** The projected map center and its pixel on the canvas. */
  center: { x: number; y: number };
  origin: readonly [number, number];
  zoom: number;
  width: number;
  height: number;
  /** Device pixels per CSS pixel; centers snap to whole device pixels. */
  density: number;
  reduceMotion: boolean;
  /** The frame's time, on the clock the tweens started on. */
  now: number;
};

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * A filled circle with a 1px paper halo, so neighbors stay apart where they
 * overlap. The open yard takes the accent fill and a 2px ring 2px outside
 * it. The only function that knows the marker's shape.
 */
function shape(
  context: YardMarkerContext,
  look: YardMarkerLook,
  colors: YardMarkerColors,
) {
  const radius = look.size / 2;
  context.fillStyle = colors.paper;
  context.beginPath();
  context.arc(look.x, look.y, radius, 0, 2 * Math.PI);
  context.fill();
  context.fillStyle = look.selected ? colors.signal : colors.ink;
  context.beginPath();
  context.arc(
    look.x,
    look.y,
    Math.max(0, radius - look.emphasis),
    0,
    2 * Math.PI,
  );
  context.fill();
  if (look.selected) {
    context.strokeStyle = colors.signal;
    context.lineWidth = 2 * look.emphasis;
    context.beginPath();
    context.arc(look.x, look.y, radius + 3 * look.emphasis, 0, 2 * Math.PI);
    context.stroke();
  }
}

/**
 * Draws every marker at a constant size on screen. A marker whose size
 * changes (dot to pin, hover, selection) eases there over `GROW_MS`; the
 * tween's progress is clamped to [0, 1], since a frame's time can precede
 * a tween started later in the same frame. Returns whether a tween is still
 * running, so the caller draws another frame.
 */
function frame(
  context: YardMarkerContext,
  view: YardMarkerFrame,
  colors: YardMarkerColors,
  tweens: Map<string, YardMarkerTween>,
): boolean {
  const scale = 2 ** (view.zoom - 2);
  const snap = (value: number) =>
    Math.round(value * view.density) / view.density;
  let animating = false;

  const paint = (index: number) => {
    const marker = view.markers[index];
    if (!marker) return;
    const x = view.origin[0] + (marker.x - view.center.x) * scale;
    const y = view.origin[1] + (marker.y - view.center.y) * scale;
    if (
      x < -MARGIN_PX ||
      y < -MARGIN_PX ||
      x > view.width + MARGIN_PX ||
      y > view.height + MARGIN_PX
    ) {
      // Unseen, it has no size to ease from: it returns at its size then.
      tweens.delete(marker.key);
      return;
    }
    const selected = marker.key === view.selectedKey;
    // The open yard stands out at full size among dots.
    const base = view.sizes[index] === "dot" && !selected ? DOT_PX : PIN_PX;
    const emphasis = selected
      ? SELECTED_SCALE
      : marker.key === view.hoveredKey
        ? HOVER_SCALE
        : 1;
    const target = base * emphasis;
    const tween = tweens.get(marker.key) ?? {
      from: target,
      to: target,
      start: 0,
    };
    const progress = view.reduceMotion
      ? 1
      : Math.max(0, Math.min(1, (view.now - tween.start) / GROW_MS));
    const size = tween.from + (tween.to - tween.from) * easeOut(progress);
    if (tween.to !== target) {
      tweens.set(marker.key, { from: size, to: target, start: view.now });
      animating ||= !view.reduceMotion;
    } else {
      tweens.set(marker.key, tween);
      if (progress < 1) animating = true;
    }
    shape(
      context,
      { x: snap(x), y: snap(y), size, emphasis, selected },
      colors,
    );
  };

  // The hovered and then the open yard sit above their neighbors.
  let hovered: number | null = null;
  let open: number | null = null;
  view.markers.forEach((marker, index) => {
    if (marker.key === view.selectedKey) open = index;
    else if (marker.key === view.hoveredKey) hovered = index;
    else paint(index);
  });
  if (hovered !== null) paint(hovered);
  if (open !== null) paint(open);
  return animating;
}

export const YardMapMarkerPaint = {
  DOT_PX,
  PIN_PX,
  HOVER_SCALE,
  SELECTED_SCALE,
  GROW_MS,
  shape,
  frame,
} as const;
