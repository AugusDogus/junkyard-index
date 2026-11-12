import { expect, test } from "bun:test";
import { transformRivervalleyRecord } from "./rivervalley-transform";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";

const record = {
  id: "196762",
  year: "2014",
  make: "IC Corporation",
  model: "PB105",
  vin: "4DRBUAAN0EB485230",
  stockNumber: "260645",
  imageUrl: null,
  detailsUrl:
    "https://rivervalleytruckparts.com/truck-description/?truck=196762",
  condition: "Salvage",
  engine: "International DT466",
} satisfies TruckPartsCatalogRecord;

test("River Valley preserves native donor identity and nullable optional fields", () => {
  const result = transformRivervalleyRecord(record);
  expect(result.status).toBe("available");
  if (result.status !== "available") throw new Error("Expected native donor");
  expect(result.vehicle).toMatchObject({
    source: "rivervalley",
    vin: record.vin,
    year: 2014,
    make: "Ic Corporation",
    model: "PB105",
    stockNumber: "260645",
    detailsUrl: record.detailsUrl,
    color: null,
    availableDate: null,
    row: null,
    section: null,
    space: null,
    imageUrl: null,
    engine: "International DT466",
    locationCity: "Kankakee",
    stateAbbr: "IL",
    lat: 41.0852855,
    lng: -87.8751744,
  });
  expect(
    transformRivervalleyRecord({ ...record, stockNumber: null, engine: null }),
  ).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, engine: null },
  });
  expect(
    transformRivervalleyRecord({
      ...record,
      stockNumber: "N/A",
      engine: "Other",
    }),
  ).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, engine: null },
  });
});

test.each([
  { vin: "n/a" },
  { year: "" },
  { make: "Not Available" },
  { make: "Other" },
  { model: "N/A" },
  {
    detailsUrl: "https://another-yard.example/truck-description/?truck=196762",
  },
])(
  "River Valley rejects missing required metadata without guessing: %j",
  (patch) => {
    expect(transformRivervalleyRecord({ ...record, ...patch })).toEqual({
      status: "incomplete",
      vin: patch.vin ? null : record.vin,
    });
  },
);

test("River Valley retains genuine pre-1981 serials only with an eligible native year", () => {
  expect(
    transformRivervalleyRecord({ ...record, year: "1979", vin: "F70BVFA1234" }),
  ).toMatchObject({
    status: "available",
    vehicle: { year: 1979, vin: "F70BVFA1234" },
  });
  expect(transformRivervalleyRecord({ ...record, vin: "F70BVFA1234" })).toEqual(
    { status: "incomplete", vin: null },
  );
});
