"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { YardMapMarker } from "~/lib/yard-map-marker";
import { projectYardLocation } from "~/lib/yard-map-projection";
import { YardPath } from "~/lib/yard-path";
import type { MapYard } from "./yard-map-data";

type Point = [number, number];

/** The square's full size in CSS pixels, as the DOM pin drew it. */
const DOT_PX = 9;
const PIN_PX = 15;
const HOVER_SCALE = 1.25;
const SELECTED_SCALE = 1.35;
/** --dur-micro, the size change between dot and pin. */
const GROW_MS = 120;
/** Live zoom steps the dot and pin sizes are worked out at. */
const SIZE_STEPS_PER_ZOOM = 8;

type Tween = { from: number; to: number; start: number };
type Colors = { paper: string; ink: string; signal: string; scrim: string };

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/**
 * Every yard's square, drawn on one canvas from Pigeon's live view. Pigeon
 * redraws its children on each frame of a pan, pinch or wheel zoom, so the
 * squares follow the map at a constant size on screen, and there is nothing
 * to restyle when the gesture ends. The pin buttons above it stay in the
 * page, invisible, for taps, focus, titles and screen readers; until the
 * canvas first draws, they draw their own squares.
 */
export function YardMapMarkerCanvas({
  pins,
  selectedKey,
  hoveredKey,
  measured,
  onDrawn,
  latLngToPixel,
  mapState,
}: {
  pins: readonly MapYard[];
  selectedKey: string | null;
  hoveredKey: string | null;
  /** Whether the map has its real size, not the server's guess. */
  measured: boolean;
  /** Called once the canvas has drawn, so the pins' own squares can hide. */
  onDrawn: () => void;
  /** Given by Pigeon. */
  latLngToPixel?: (latLng: Point) => Point;
  mapState?: { zoom: number; width: number; height: number; center: Point };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tweens = useRef(new Map<string, Tween>());
  const colors = useRef<{ theme: string; value: Colors } | null>(null);
  const frame = useRef<number | null>(null);
  const points = useMemo(() => pins.map(projectYardLocation), [pins]);
  const sizeZoom = mapState
    ? Math.round(mapState.zoom * SIZE_STEPS_PER_ZOOM) / SIZE_STEPS_PER_ZOOM
    : null;
  const sizes = useMemo(
    () => (sizeZoom === null ? [] : YardMapMarker.sizes(pins, sizeZoom)),
    [pins, sizeZoom],
  );

  /** Draws the current view; false when there is nothing to draw on yet. */
  const draw = useRef<(now: number) => boolean>(() => false);
  draw.current = (now) => {
    frame.current = null;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !latLngToPixel || !mapState) return false;
    const { width, height, zoom, center } = mapState;
    const density = window.devicePixelRatio;
    const pixelWidth = Math.round(width * density);
    const pixelHeight = Math.round(height * density);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, width, height);
    const palette = readColors(canvas, colors);
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const origin = latLngToPixel(center);
    const originPoint = projectYardLocation({ lat: center[0], lng: center[1] });
    const scale = 2 ** (zoom - 2);
    // Whole device pixels keep the squares' edges crisp.
    const snap = (value: number) => Math.round(value * density) / density;
    let animating = false;

    const paint = (index: number) => {
      const yard = pins[index];
      const point = points[index];
      if (!yard || !point) return;
      const key = YardPath.key(yard);
      const x = origin[0] + (point.x - originPoint.x) * scale;
      const y = origin[1] + (point.y - originPoint.y) * scale;
      if (x < -24 || y < -24 || x > width + 24 || y > height + 24) return;
      // The open yard stands out at full size among dots.
      const base =
        sizes[index] === "dot" && key !== selectedKey ? DOT_PX : PIN_PX;
      const emphasis =
        key === selectedKey
          ? SELECTED_SCALE
          : key === hoveredKey
            ? HOVER_SCALE
            : 1;
      const target = base * emphasis;
      const tween = tweens.current.get(key) ?? {
        from: target,
        to: target,
        start: 0,
      };
      const progress = reduceMotion
        ? 1
        : Math.max(0, Math.min(1, (now - tween.start) / GROW_MS));
      const size = tween.from + (tween.to - tween.from) * easeOut(progress);
      if (tween.to !== target) {
        tweens.current.set(key, { from: size, to: target, start: now });
        animating = !reduceMotion;
      } else {
        tweens.current.set(key, tween);
        if (progress < 1) animating = true;
      }
      // A dot has a 1px edge and a pin 2px; the hover and selection scales
      // grow the edge with the square, as the CSS transform did.
      const plain = size / emphasis;
      const line =
        (1 + Math.max(0, Math.min(1, (plain - DOT_PX) / (PIN_PX - DOT_PX)))) *
        emphasis;
      const left = snap(x - size / 2);
      const top = snap(y - size / 2);
      // Pins cast the DOM pin's `0 1px 3px` shadow; dots have none. Canvas
      // shadows ignore the transform, so they are in device pixels.
      const shadow = plain > DOT_PX + 0.5;
      if (shadow) {
        context.shadowColor = palette.scrim;
        context.shadowBlur = 3 * density;
        context.shadowOffsetY = density;
      }
      context.fillStyle = palette.paper;
      context.fillRect(left, top, size, size);
      if (shadow) context.shadowColor = "transparent";
      context.fillStyle = key === selectedKey ? palette.signal : palette.ink;
      context.fillRect(
        left + line,
        top + line,
        size - 2 * line,
        size - 2 * line,
      );
      if (key === selectedKey) {
        // The 2px ring 2px outside the square, scaled with it.
        const ring = line * 1.5;
        context.strokeStyle = palette.signal;
        context.lineWidth = line;
        context.strokeRect(
          left - ring,
          top - ring,
          size + 2 * ring,
          size + 2 * ring,
        );
      }
    };

    // The hovered and then the open yard sit above their neighbors.
    let hovered: number | null = null;
    let open: number | null = null;
    pins.forEach((yard, index) => {
      const key = YardPath.key(yard);
      if (key === selectedKey) open = index;
      else if (key === hoveredKey) hovered = index;
      else paint(index);
    });
    if (hovered !== null) paint(hovered);
    if (open !== null) paint(open);
    if (animating) {
      frame.current = window.requestAnimationFrame((time) =>
        draw.current(time),
      );
    }
    return true;
  };

  const schedule = () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame((time) => {
      if (draw.current(time)) onDrawn();
    });
  };

  // Pigeon renders this on every frame of a gesture; draw before paint. The
  // first draw waits for the map's real size and then a frame, so reading
  // the theme's colors does not force a style pass during hydration; the
  // pins' own squares show until then.
  useLayoutEffect(() => {
    if (!measured) return;
    if (!colors.current) {
      schedule();
      return;
    }
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    draw.current(performance.now());
  });

  // The theme switches by a class on <html>; redraw in its colors.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (colors.current) schedule();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => {
      observer.disconnect();
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
    // `schedule` reads the latest draw through refs.
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="yard-map-markers"
      style={{
        position: "absolute",
        inset: 0,
        width: mapState?.width ?? "100%",
        height: mapState?.height ?? "100%",
        pointerEvents: "none",
      }}
    />
  );
}

/** The theme's marker colors, read again only when the theme changes. */
function readColors(
  canvas: HTMLCanvasElement,
  cache: { current: { theme: string; value: Colors } | null },
): Colors {
  const theme = document.documentElement.className;
  if (cache.current?.theme === theme) return cache.current.value;
  const style = getComputedStyle(canvas);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const value = {
    paper: read("--color-paper-3"),
    ink: read("--color-ink"),
    signal: read("--color-signal"),
    scrim: read("--color-scrim"),
  };
  cache.current = { theme, value };
  return value;
}
