"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { YardMapMarker } from "~/lib/yard-map-marker";
import {
  YardMapMarkerPaint,
  type YardMarkerColors,
  type YardMarkerTween,
} from "~/lib/yard-map-marker-paint";
import { projectYardLocation } from "~/lib/yard-map-projection";
import { YardPath } from "~/lib/yard-path";
import type { MapYard } from "./yard-map-data";

type Point = [number, number];

/**
 * Every yard's marker, drawn on one canvas from Pigeon's live view. Pigeon
 * redraws its children on each frame of a pan, pinch or wheel zoom, so the
 * markers follow the map at a constant size on screen, and there is nothing
 * to restyle when the gesture ends. The pin buttons above it stay in the
 * page, invisible, for taps, focus, titles and screen readers; until the
 * canvas first draws, they draw their own markers.
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
  /** Called once the canvas has drawn, so the pins' own markers can hide. */
  onDrawn: () => void;
  /** Given by Pigeon. */
  latLngToPixel?: (latLng: Point) => Point;
  mapState?: { zoom: number; width: number; height: number; center: Point };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tweens = useRef(new Map<string, YardMarkerTween>());
  const colors = useRef<{ theme: string; value: YardMarkerColors } | null>(
    null,
  );
  const frame = useRef<number | null>(null);
  const markers = useMemo(
    () =>
      pins.map((yard) => ({
        key: YardPath.key(yard),
        ...projectYardLocation(yard),
      })),
    [pins],
  );
  const sizer = useMemo(() => YardMapMarker.sizer(pins), [pins]);
  const sizeZoom = mapState ? YardMapMarker.sizeZoom(mapState.zoom) : null;
  const sizes = useMemo(
    () => (sizeZoom === null ? [] : sizer(sizeZoom)),
    [sizer, sizeZoom],
  );

  /**
   * Draws the current view; false when there is nothing to draw on yet.
   * Every draw reads `performance.now()`: a frame's own timestamp can
   * precede a draw made earlier in a busy frame, which stepped tweens back.
   */
  const draw = useRef<() => boolean>(() => false);
  draw.current = () => {
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
    const animating = YardMapMarkerPaint.frame(
      context,
      {
        markers,
        sizes,
        selectedKey,
        hoveredKey,
        center: projectYardLocation({ lat: center[0], lng: center[1] }),
        origin: latLngToPixel(center),
        zoom,
        width,
        height,
        density,
        reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
          .matches,
        now: performance.now(),
      },
      readColors(canvas, colors),
      tweens.current,
    );
    if (animating) {
      frame.current = window.requestAnimationFrame(() => draw.current());
    }
    return true;
  };

  const schedule = () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    frame.current = window.requestAnimationFrame(() => {
      if (draw.current()) onDrawn();
    });
  };

  // Pigeon renders this on every frame of a gesture; draw before paint. The
  // first draw comes from the observer below; the pins' own markers show
  // until then.
  useLayoutEffect(() => {
    if (!measured || !colors.current) return;
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    draw.current();
  });

  // The first draw waits for the map's real size, then runs once that
  // frame's layout is done, so reading the theme's colors forces no style
  // pass during hydration.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!measured || !canvas) return;
    const observer = new ResizeObserver(() => {
      if (!draw.current()) return;
      observer.disconnect();
      onDrawn();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [measured, onDrawn]);

  // The theme switches by a class on <html>; redraw in its colors. Moving
  // the window to a screen of another density changes no size; redraw at
  // its density.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      if (colors.current) schedule();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    let density: MediaQueryList | null = null;
    const onDensity = () => {
      if (colors.current) schedule();
      watchDensity();
    };
    const watchDensity = () => {
      density = window.matchMedia(
        `(resolution: ${window.devicePixelRatio}dppx)`,
      );
      density.addEventListener("change", onDensity, { once: true });
    };
    watchDensity();
    return () => {
      observer.disconnect();
      density?.removeEventListener("change", onDensity);
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
  cache: { current: { theme: string; value: YardMarkerColors } | null },
): YardMarkerColors {
  const theme = document.documentElement.className;
  if (cache.current?.theme === theme) return cache.current.value;
  const style = getComputedStyle(canvas);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const value = {
    paper: read("--color-paper"),
    ink: read("--color-ink"),
    signal: read("--color-signal"),
  };
  cache.current = { theme, value };
  return value;
}
