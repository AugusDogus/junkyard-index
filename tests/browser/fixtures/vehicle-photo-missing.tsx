import { createRoot } from "react-dom/client";
import { RecentVehicles } from "~/components/home/RecentVehicles";
import { HiddenSourcesProvider } from "~/components/HiddenSourcesContext";
import { VehicleRowPhoto } from "~/components/inventory/VehicleRowPhoto";
import { VehicleCard } from "~/components/search/VehicleCard";
import { HiddenSources } from "~/lib/hidden-source";
import { algoliaHitToSearchVehicle } from "~/lib/search-vehicles";

// Every photo here 404s, at the proxy and at the origin.
const photo = "https://photos.test/gone.jpg";

const hit = algoliaHitToSearchVehicle({
  source: "pyp",
  objectID: "gone-photo",
  year: 2012,
  make: "Honda",
  model: "Civic",
  vin: "1FADP3F29FL123456",
  stockNumber: "12345",
  locationCode: "1264",
  locationName: "Pick Your Part - Anaheim",
  locationCity: "Anaheim",
  stateAbbr: "CA",
  imageUrl: photo,
  detailsUrl: "https://cards.test/inventory/12345",
});
if (!hit) throw new Error("Expected a supported vehicle source");
const vehicle = hit;

function Fixture() {
  return (
    <main className="grid gap-6 p-4">
      <section data-surface="search-card" className="w-80">
        <VehicleCard vehicle={vehicle} />
      </section>
      <section data-surface="arrivals">
        {/* A full row of arrivals, as on the homepage: the carousel's
        auto-scroll expects more slides than fit. */}
        <RecentVehicles
          vehicles={Array.from({ length: 8 }, (_, index) => ({
            year: 2012,
            make: "Honda",
            model: "Civic",
            source: "pyp",
            locationCode: "1264",
            city: "Anaheim",
            state: "CA",
            imageUrl: photo,
            indexedAt: `2026-11-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`,
            lastChecked: null,
          }))}
        />
      </section>
      <section data-surface="inventory-row">
        <VehicleRowPhoto src={photo} />
      </section>
    </main>
  );
}

createRoot(document.body).render(
  <HiddenSourcesProvider hidden={HiddenSources.none}>
    <Fixture />
  </HiddenSourcesProvider>,
);
