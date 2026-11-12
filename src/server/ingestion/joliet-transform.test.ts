import { expect, test } from "bun:test";
import { jolietTestRecord } from "./joliet-test-fixtures";
import { transformJolietRecord } from "./joliet-transform";

test("Joliet preserves native API YMM and the explicit calendar date at the verified business pin", () => {
  expect(transformJolietRecord(jolietTestRecord)).toMatchObject({
    status: "available",
    vehicle: {
      source: "joliet",
      vin: "1FAHP2J89EG117594",
      year: 2014,
      make: "Ford",
      model: "TAURUS",
      stockNumber: "STK075102",
      row: "99",
      color: null,
      imageUrl: null,
      availableDate: "2026-08-19",
      detailsUrl: "https://www.jolietupullit.com/inventory",
      locationCode: "joliet",
      locationCity: "Joliet",
      stateAbbr: "IL",
      lat: 41.5224678,
      lng: -88.0560742,
    },
  });
});
test.each([
  undefined,
  null,
  "",
  false,
  {},
  "Unknown",
  "N/A",
  "none",
  "null",
  "undefined",
  "-",
  "???",
])(
  "Joliet optional fields can be unusable without rejecting a donor (%#)",
  (value) => {
    expect(
      transformJolietRecord({
        ...jolietTestRecord,
        color: value,
        vehicleRow: value,
        dateAdded: value,
        imageUrl: value,
        imageUrls: value,
      }),
    ).toMatchObject({
      status: "available",
      vehicle: { color: null, row: null, availableDate: null, imageUrl: null },
    });
  },
);
test.each([
  "Unknown",
  "Other",
  "N/A",
  "none",
  "null",
  "undefined",
  "-",
  "???",
  "",
])(
  "Joliet required placeholders reject with valid identity presence (%#)",
  (value) => {
    expect(
      transformJolietRecord({ ...jolietTestRecord, model: value }),
    ).toEqual({ status: "incomplete", vin: jolietTestRecord.vin });
    expect(transformJolietRecord({ ...jolietTestRecord, make: value })).toEqual(
      { status: "incomplete", vin: jolietTestRecord.vin },
    );
  },
);
test.each([
  "2026-02-30T12:00:00",
  "2026-08-19T25:00:00",
  "08.19.26",
  "2026-08-19T12:00:00Z",
])("Joliet does not infer a date or timezone from %s", (dateAdded) => {
  expect(
    transformJolietRecord({ ...jolietTestRecord, dateAdded }),
  ).toMatchObject({ status: "available", vehicle: { availableDate: null } });
});
test("Joliet retains genuine older serials and rejects malformed modern identities", () => {
  expect(
    transformJolietRecord({ ...jolietTestRecord, year: 1969, vin: "J5172085" }),
  ).toMatchObject({ status: "available", vehicle: { vin: "J5172085" } });
  expect(
    transformJolietRecord({
      ...jolietTestRecord,
      year: 2007,
      vin: "1FAHP31N27W34420",
    }),
  ).toEqual({ status: "incomplete", vin: null });
});
