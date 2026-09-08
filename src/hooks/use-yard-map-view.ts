import { useEffect, useState } from "react";
import type { YardMapView } from "~/lib/yard-map-projection";
import { getYardMapTileUrls, loadYardMapTile } from "~/lib/yard-map-tiles";

export function useYardMapView(
  overview: YardMapView,
  width: number,
  height: number,
) {
  const [view, setView] = useState<YardMapView | null>(null);
  const [requested, requestView] = useState<YardMapView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [lat, lng] = overview.center;
  const zoom = overview.zoom;

  useEffect(() => {
    if (requested === view) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(10_000),
    ]);
    const target =
      requested ?? ({ center: [lat, lng], zoom } satisfies YardMapView);
    const urls = getYardMapTileUrls(
      target,
      width,
      height,
      window.matchMedia("(min-resolution: 1.5dppx)").matches,
    );
    setLoadError(false);
    void Promise.all(urls.map((url) => loadYardMapTile(url, signal))).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        if (loaded.every(Boolean)) {
          setView(requested);
        } else {
          // Keep the last usable view if the destination cannot load.
          requestView(view);
          setLoadError(true);
        }
      },
    );
    return () => controller.abort();
  }, [requested, view, lat, lng, zoom, width, height]);

  // Gestures already move Pigeon's internal view. Adopt them immediately and
  // cancel any pending button/yard navigation so it cannot snap the map back.
  const syncView = (next: YardMapView) => {
    setView(next);
    requestView(next);
  };

  return {
    view,
    requestView,
    syncView,
    loading: requested !== view,
    loadError,
  };
}
