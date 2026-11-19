import { useState } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { VehicleRow } from "~/components/inventory/VehicleRow";
import { VehicleRowPhoto } from "~/components/inventory/VehicleRowPhoto";
import type { YardVehicle } from "~/lib/yard-inventory";

const vehicle: YardVehicle = {
  vin: "1234567890123456789012345",
  year: 2004,
  make: "Honda",
  model: "Civic",
  trim: null,
  engine: "1.7L",
  color: "Blue",
  stockNumber: "123",
  section: null,
  row: null,
  space: null,
  addedAt: Date.parse("2026-11-17"),
  addedBy: "yard",
  imageUrl: "https://da8h1v3w8q6n5.cloudfront.net/kk25/broken.jpg",
  detailsUrl: null,
};

function Fixture() {
  const [imageUrl, setImageUrl] = useState(vehicle.imageUrl);
  return (
    <main className="p-4">
      <button
        onClick={() =>
          setImageUrl("https://da8h1v3w8q6n5.cloudfront.net/kk25/working.jpg")
        }
      >
        Change photo
      </button>
      <ul>
        <VehicleRow
          vehicle={{ ...vehicle, imageUrl }}
          source="allied"
          publishedAt={null}
          layout="columns"
        />
        <VehicleRow
          vehicle={{ ...vehicle, imageUrl }}
          source="allied"
          publishedAt={null}
          layout="stacked"
        />
        <VehicleRow
          vehicle={{ ...vehicle, imageUrl: null }}
          source="allied"
          publishedAt={null}
          layout="columns"
        />
      </ul>
    </main>
  );
}

if (location.search === "?hydrate") {
  window.addEventListener("hydrate-photo", () => {
    hydrateRoot(
      document.body,
      <VehicleRowPhoto src={vehicle.imageUrl ?? ""} />,
    );
  });
} else {
  createRoot(document.body).render(<Fixture />);
}
