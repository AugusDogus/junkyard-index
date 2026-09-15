import { expect, test } from "bun:test";
import { transformPartsGaloreVehicle } from "./partsgalore-transform";
import { PARTSGALORE_YARD } from "./partsgalore-yard-metadata";
import type { PartsGaloreRecord } from "./partsgalore-parser";

const record: PartsGaloreRecord = {
  vin: " 3n69r9m338069 ",
  year: "1979",
  make: "OLDSMOBILE",
  model: " Eighty Eight ",
  color: "BLUE",
  yardDate: "2026-07-31",
  row: "101",
  stockNumber: "",
};

test("preserves legacy VIN/year and maps inventory fields to the verified Detroit yard", () => {
  expect(transformPartsGaloreVehicle(record, PARTSGALORE_YARD)).toMatchObject({
    source: "partsgalore",
    vin: "3N69R9M338069",
    year: 1979,
    make: "Oldsmobile",
    model: "Eighty Eight",
    color: "Blue",
    availableDate: "2026-07-31T00:00:00.000Z",
    row: "101",
    stockNumber: null,
    lat: 42.448375,
    lng: -83.00895,
    state: "Michigan",
    stateAbbr: "MI",
    detailsUrl: "https://parts-galore.com/inventory/",
    imageUrl: null,
  });
});
test.each(["", "2026-02-30", "2026-13-01", "yesterday"])(
  "does not invent arrival dates for %s",
  (yardDate) => {
    expect(
      transformPartsGaloreVehicle(
        { ...record, yardDate, color: "UNKNOWN", stockNumber: " PG-7 " },
        PARTSGALORE_YARD,
      ),
    ).toMatchObject({ availableDate: null, color: null, stockNumber: "PG-7" });
  },
);
test.each([
  { vin: " " },
  { make: "" },
  { model: "" },
  { year: "2014oops" },
  { year: "0000" },
])("rejects unusable required metadata %j", (invalid) => {
  expect(
    transformPartsGaloreVehicle({ ...record, ...invalid }, PARTSGALORE_YARD),
  ).toBeNull();
});
test.each([
  { lat: null, lng: null },
  { lat: 0, lng: 0 },
  { lat: NaN },
  { city: "" },
  { state: "" },
])("does not invent yard metadata %j", (invalid) => {
  expect(
    transformPartsGaloreVehicle(record, { ...PARTSGALORE_YARD, ...invalid }),
  ).toBeNull();
});
