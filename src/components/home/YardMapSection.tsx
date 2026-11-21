import { geolocation } from "@vercel/functions";
import { headers } from "next/headers";
import { userAgent } from "next/server";
import { Suspense } from "react";
import { YardMap } from "~/components/home/YardMap";
import { getHomepageInventory } from "~/lib/homepage-inventory";
import { hasFiniteCoordinates } from "~/lib/location-preferences";
import type { YardLocation } from "~/lib/yard-directory";
import { MapYard } from "./yard-map-data";

export type YardMapSectionProps = {
  yards: MapYard[];
  vehicleCount: number;
  approximateLocation: YardLocation | null;
  compactMap: boolean;
};

/**
 * The yard map's inputs for this request: the cached homepage inventory,
 * the visitor's approximate location, and whether a phone gets the compact
 * map. The landing page and /map both render the map from these.
 */
export async function loadYardMapSection() {
  const requestHeaders = await headers();
  const geo = geolocation({ headers: requestHeaders });
  const compactMap =
    userAgent({ headers: requestHeaders }).device.type === "mobile";
  const coordinates = {
    lat: geo.latitude ? Number(geo.latitude) : null,
    lng: geo.longitude ? Number(geo.longitude) : null,
  };
  const approximateLocation = hasFiniteCoordinates(coordinates)
    ? coordinates
    : null;
  const inventory = await getHomepageInventory();
  const vehicleCount = inventory.yards.reduce(
    (total, yard) => total + yard.vehicleCount,
    0,
  );
  const section: YardMapSectionProps = {
    yards: inventory.yards.map(MapYard.from),
    vehicleCount,
    approximateLocation,
    compactMap,
  };
  return { inventory, section };
}

/** The yard map with its loading frame and the confirm-first note. */
export function YardMapSection({
  yards,
  vehicleCount,
  approximateLocation,
  compactMap,
}: YardMapSectionProps) {
  return (
    <>
      <Suspense
        fallback={
          <div aria-hidden="true" className="border-ink border-2">
            <div className="bg-board h-16" />
            <div className="homepage-map-layout bg-paper-2 border-ink border-t-2">
              <div className="homepage-map-canvas" />
              <div className="bg-paper-3 border-ink h-[54px] border-t-2 lg:hidden" />
            </div>
          </div>
        }
      >
        <YardMap
          compactMap={compactMap}
          yards={yards}
          vehicleCount={vehicleCount}
          approximateLocation={approximateLocation}
        />
      </Suspense>
      <p className="text-ink-2 mt-3 text-sm text-pretty">
        Confirm vehicle availability with the yard before visiting.
      </p>
    </>
  );
}
