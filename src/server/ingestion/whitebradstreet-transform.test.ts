import { expect, test } from "bun:test";
import { transformWhitebradstreetRecord } from "./whitebradstreet-transform";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";

const record: TruckPartsCatalogRecord = {
  id: "193589",
  year: "2010",
  make: "Peterbilt",
  model: "386",
  vin: "1XPHD49X0AD113809",
  stockNumber: null,
  imageUrl: null,
  detailsUrl: "https://white-bradstreet.com/truck-description/?truck=193589",
  condition: "Salvage",
  engine: null,
};

test("White & Bradstreet accepts complete donors with all optional metadata absent", () => {
  expect(transformWhitebradstreetRecord(record)).toMatchObject({
    status: "available",
    vehicle: {
      source: "whitebradstreet",
      vin: record.vin,
      year: 2010,
      color: null,
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      section: null,
      row: null,
      space: null,
      stateAbbr: "ME",
      lat: 44.3404252,
      lng: -69.659884,
    },
  });
});

test.each([
  { year: "" },
  { make: "Unknown" },
  { make: "" },
  { model: "Other" },
  { model: "" },
])(
  "White & Bradstreet preserves valid VINs on required metadata rejection (%#)",
  (patch) => {
    expect(transformWhitebradstreetRecord({ ...record, ...patch })).toEqual({
      status: "incomplete",
      vin: record.vin,
    });
  },
);

test("White & Bradstreet accepts native older serials and never repairs modern VINs", () => {
  expect(
    transformWhitebradstreetRecord({
      ...record,
      year: "1974",
      vin: "4K91T190075",
    }).status,
  ).toBe("available");
  expect(
    transformWhitebradstreetRecord({ ...record, vin: "4v4nc9tko7n458072" }),
  ).toEqual({ status: "incomplete", vin: null });
  expect(
    transformWhitebradstreetRecord({ ...record, vin: "1GDKH1C9YJ500073" }),
  ).toEqual({ status: "incomplete", vin: null });
});
