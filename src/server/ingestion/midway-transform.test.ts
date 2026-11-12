import { expect, test } from "bun:test";
import { transformMidwayRecord } from "./midway-transform";
import { midwayTestRecord } from "./midway-test-fixtures";

test("Midway emits required identity with optional values null", () => {
  expect(
    transformMidwayRecord(
      {
        ...midwayTestRecord,
        stock: "Unknown",
        row: "0",
        arrived: "2026-02-30",
      },
      "MO38",
    ),
  ).toMatchObject({
    status: "available",
    vehicle: {
      vin: midwayTestRecord.vin,
      year: 2016,
      make: "Chrysler",
      model: "200",
      color: null,
      stockNumber: null,
      row: null,
      availableDate: null,
      imageUrl: null,
      stateAbbr: "KS",
    },
  });
});

test("Midway null optional sentinels do not become stock identities or positions", () => {
  expect(
    transformMidwayRecord(
      { ...midwayTestRecord, stock: "NULL", row: "Other" },
      "MO38",
    ),
  ).toMatchObject({
    status: "available",
    vehicle: { stockNumber: null, row: null },
  });
});

test("Midway preserves source date, stock and position without inferring color or photos", () => {
  expect(transformMidwayRecord(midwayTestRecord, "MO09")).toMatchObject({
    status: "available",
    vehicle: {
      availableDate: "2026-10-23T00:00:00.000Z",
      stockNumber: "2604445",
      row: "DR 04- 08",
      locationCode: "MO09",
      stateAbbr: "MO",
      imageUrl: null,
      color: null,
    },
  });
});

test("Midway accepts a native old serial only with a pre-1981 source year", () => {
  expect(
    transformMidwayRecord(
      { ...midwayTestRecord, year: "1980", vin: "ABC123456" },
      "MO38",
    ).status,
  ).toBe("available");
  expect(
    transformMidwayRecord(
      { ...midwayTestRecord, year: "1981", vin: "ABC123456" },
      "MO38",
    ).status,
  ).toBe("incomplete");
});

test.each([
  { vin: "1C3CCCAB6GN12Q544" },
  { year: "2016?" },
  { make: "" },
  { model: "Unknown" },
  { make: "-" },
  { make: "NULL" },
  { make: "N-A" },
  { make: "0" },
  { model: "-" },
  { model: "NULL" },
  { model: "N-A" },
])("Midway requires genuine native identity and YMM (%#)", (fields) => {
  expect(
    transformMidwayRecord({ ...midwayTestRecord, ...fields }, "MO38").status,
  ).toBe("incomplete");
});
