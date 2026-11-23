import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HiddenSources } from "~/lib/hidden-source";
import type { YardVehicle } from "~/lib/yard-inventory";
import { VehicleRow } from "./VehicleRow";

const vehicle: YardVehicle = {
  vin: "1234567890123456789012345",
  year: 2004,
  make: "Honda",
  model: "Civic",
  trim: null,
  engine: null,
  color: null,
  stockNumber: "123",
  section: null,
  row: null,
  space: null,
  addedAt: Date.parse("2026-11-17"),
  addedBy: "yard",
  imageUrl: null,
  detailsUrl: null,
};

test("vehicles without photos use text-only rows and omit missing row notices", () => {
  const html = renderToStaticMarkup(
    <VehicleRow
      vehicle={vehicle}
      source="allied"
      publishedAt={null}
      layout="columns"
      hiddenSources={HiddenSources.none}
    />,
  );
  expect(html).toContain(vehicle.vin);
  expect(html).toContain("In the yard since");
  expect(html).not.toContain("No photo");
  expect(html).not.toContain("aspect-[4/3]");
  expect(html).not.toContain("Row not listed");
});

test("photos and actual yard positions remain visible", () => {
  const html = renderToStaticMarkup(
    <VehicleRow
      vehicle={{
        ...vehicle,
        imageUrl: "https://da8h1v3w8q6n5.cloudfront.net/kk25/car.jpg",
        row: "12",
      }}
      source="allied"
      publishedAt={null}
      layout="stacked"
      hiddenSources={HiddenSources.none}
    />,
  );
  expect(html).toContain(
    'src="https://da8h1v3w8q6n5.cloudfront.net/kk25/car.jpg"',
  );
  expect(html).toContain("Row 12");
});
