import { Suspense } from "react";
import { YardMap } from "~/components/home/YardMap";
import { getHomepageInventory } from "~/lib/homepage-inventory";
import {
  MapYard,
  yardMapLayoutClasses,
  type YardMapLayout,
} from "./yard-map-data";

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
export function YardMapSection({
  yards,
  vehicleCount,
  layout,
}: YardMapSectionProps & { layout: YardMapLayout }) {
  return (
    <>
      <Suspense
        fallback={
          <div aria-hidden="true" className="border-rule-strong border">
            <div className="bg-board h-16" />
            <div
              className={`${yardMapLayoutClasses[layout].layout} bg-paper-2 border-rule-strong border-t`}
            >
              <div className={yardMapLayoutClasses[layout].canvas} />
              <div className="bg-paper-3 border-rule-strong h-[54px] border-t lg:hidden" />
            </div>
          </div>
        }
      >
        <YardMap yards={yards} vehicleCount={vehicleCount} layout={layout} />
      </Suspense>
      <p className="text-ink-2 mt-3 text-sm text-pretty">
        Confirm vehicle availability with the yard before visiting.
      </p>
    </>
  );
}
