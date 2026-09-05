import { hasFiniteCoordinates } from "~/lib/location-preferences";
import { calculateDistance } from "~/lib/utils";

export type YardLocation = { lat: number; lng: number };

/** Missing coordinates sort last; equal distances keep the directory order. */
export function sortYardsByDistance<
  Yard extends {
    lat: number | null;
    lng: number | null;
  },
>(yards: readonly Yard[], location: YardLocation | null): Yard[] {
  if (!location || !hasFiniteCoordinates(location)) return [...yards];

  return yards
    .map((yard) => ({
      yard,
      distance: hasFiniteCoordinates(yard)
        ? calculateDistance(location.lat, location.lng, yard.lat, yard.lng)
        : Infinity,
    }))
    .sort((a, b) => a.distance - b.distance)
    .map(({ yard }) => yard);
}
