import { HiddenSourcesProvider } from "~/components/HiddenSourcesContext";
import { HiddenSources } from "~/lib/hidden-source";
import { createRoot } from "react-dom/client";
import { VehicleCard } from "~/components/search/VehicleCard";
import {
  algoliaHitToSearchVehicle,
  type AlgoliaVehicleHit,
} from "~/lib/search-vehicles";

// Representative provider shapes, including a missing photo/date and a long
// engine description. The full-service card must retain its call-first hint.
const hits: AlgoliaVehicleHit[] = [
  {
    source: "pullapart",
    locationName: "Pull-A-Part - Atlanta South",
    row: "215",
    engine: "2.4L I4",
    transmission: "Automatic",
    _rankingInfo: { geoDistance: 1609.344, geoPrecision: 10 },
  },
  {
    source: "pyp",
    locationName: "Pick Your Part - Anaheim",
    section: "Cars",
    row: "13",
    space: "6",
  },
  {
    source: "row52",
    locationCode: "40",
    locationName: "Pick-n-Pull - Dallas",
    row: "52",
  },
  {
    source: "hollanderstores",
    locationCode: "a1nm",
    locationName: "A-1 Auto Recyclers",
    engine: "2.4L gasoline engine with continuously variable transmission",
    arrivalDate: { kind: "seen", date: "2026-11-18" },
  },
  {
    source: "gopullit",
    locationName: "GO Pull-It - Jacksonville",
    row: "7",
    imageUrl: null,
    arrivalDate: { kind: "unknown" },
  },
];

function Fixture() {
  return (
    <main className="shell py-4">
      <h1 className="mb-4 text-2xl font-bold">Search card provider samples</h1>
      <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 lg:grid-cols-3">
        {hits.map((hit, index) => {
          const vehicle = algoliaHitToSearchVehicle(
            {
              objectID: `card-${index}`,
              year: 2012,
              make: "Honda",
              model: "Civic",
              color: "Silver",
              vin: "1FADP3F29FL123456",
              stockNumber: `1234-${index}`,
              locationCode: "test",
              locationCity: "Dallas",
              stateAbbr: "TX",
              _geoloc: { lat: 33, lng: -97 },
              arrivalDate: { kind: "yard", date: "2026-11-18" },
              imageUrl: "https://cards.test/vehicle.svg",
              detailsUrl: "https://cards.test/inventory/1234",
              ...hit,
            },
            { lat: 32, lng: -97 },
          );
          return vehicle ? (
            <VehicleCard
              key={vehicle.id}
              vehicle={vehicle}
              priority={index === 0}
            />
          ) : null;
        })}
      </div>
    </main>
  );
}

createRoot(document.body).render(
  <HiddenSourcesProvider hidden={HiddenSources.none}>
    <Fixture />
  </HiddenSourcesProvider>,
);
