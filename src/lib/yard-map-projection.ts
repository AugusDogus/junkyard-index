import { hasFiniteCoordinates } from "~/lib/location-preferences";
import type { YardLocation } from "~/lib/yard-directory";

// Web Mercator in a 1024-unit world. Clamp polar latitudes to its finite extent.
export function projectYardLocation({ lat, lng }: YardLocation) {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat));
  return {
    x: ((lng + 180) / 360) * 1024,
    y:
      ((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) *
      1024,
  };
}

export function hasMapCoordinates(location: YardLocation) {
  return (
    hasFiniteCoordinates(location) && (location.lat !== 0 || location.lng !== 0)
  );
}

export function getYardMapBounds(locations: readonly YardLocation[]) {
  const points = locations.filter(hasMapCoordinates).map(projectYardLocation);
  const northwest = projectYardLocation({ lat: 55, lng: -125 });
  const southeast = projectYardLocation({ lat: 25, lng: -70 });
  const left = Math.min(northwest.x, ...points.map((point) => point.x)) - 1;
  const top = Math.min(northwest.y, ...points.map((point) => point.y)) - 1;
  const right = Math.max(southeast.x, ...points.map((point) => point.x)) + 1;
  const bottom = Math.max(southeast.y, ...points.map((point) => point.y)) + 1;
  return { left, top, width: right - left, height: bottom - top };
}

export type YardMapView = { center: [number, number]; zoom: number };

export function getYardMapView(
  locations: readonly YardLocation[],
  width: number,
  height: number,
): YardMapView {
  const bounds = getYardMapBounds(locations);
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  return {
    center: [
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 1024))) * 180) / Math.PI,
      (x / 1024) * 360 - 180,
    ],
    // Pigeon uses a 256px world at zoom 0. Reserve 16px around the pins.
    zoom: Math.max(
      1,
      Math.min(
        7,
        2 +
          Math.log2(
            Math.min(
              Math.max(1, width - 32) / bounds.width,
              Math.max(1, height - 32) / bounds.height,
            ),
          ),
      ),
    ),
  };
}
