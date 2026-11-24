import { Suspense } from "react";
import { YardMap } from "~/components/home/YardMap";
import { getHomepageInventory } from "~/lib/homepage-inventory";
import { MapYard } from "./yard-map-data";

export type YardMapSectionProps = {
  yards: MapYard[];
  vehicleCount: number;
};

/**
 * The yard map's inputs: the cached homepage inventory. The landing page and
 * /map both render the map from these. Nothing here reads the request, so
 * both pages are served from the CDN; the map asks for the visitor's
 * approximate location after it loads.
 */
export async function loadYardMapSection() {
  const inventory = await getHomepageInventory();
  const vehicleCount = inventory.yards.reduce(
    (total, yard) => total + yard.vehicleCount,
    0,
  );
  const section: YardMapSectionProps = {
    yards: inventory.yards.map(MapYard.from),
    vehicleCount,
  };
  return { inventory, section };
}

/** The yard map with its loading frame and the confirm-first note. */
export function YardMapSection({ yards, vehicleCount }: YardMapSectionProps) {
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
        <YardMap yards={yards} vehicleCount={vehicleCount} />
      </Suspense>
      <p className="text-ink-2 mt-3 text-sm text-pretty">
        Confirm vehicle availability with the yard before visiting.
      </p>
    </>
  );
}
