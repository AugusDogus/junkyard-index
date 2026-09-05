import { hasFiniteCoordinates } from "~/lib/location-preferences";
import type { YardLocation } from "~/lib/yard-directory";

// The overview asset uses the same Web Mercator projection as Leaflet,
// with a 1024-unit world. Clamp polar latitudes to Mercator's finite extent.
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

export function getYardMapOverview(locations: readonly YardLocation[]) {
  const points = locations.filter(hasMapCoordinates).map(projectYardLocation);
  const northwest = projectYardLocation({ lat: 55, lng: -125 });
  const southeast = projectYardLocation({ lat: 25, lng: -70 });
  const left = Math.min(northwest.x, ...points.map((point) => point.x)) - 12;
  const top = Math.min(northwest.y, ...points.map((point) => point.y)) - 12;
  const right = Math.max(southeast.x, ...points.map((point) => point.x)) + 12;
  const bottom = Math.max(southeast.y, ...points.map((point) => point.y)) + 12;
  return { left, top, width: right - left, height: bottom - top };
}
