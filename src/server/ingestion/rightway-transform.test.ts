import { expect, test } from "bun:test";
import { transformRightwayRecord } from "./rightway-transform";
import { rightwayTestRecord } from "./rightway-test-fixtures";

test("Rightway preserves genuine metadata and direct native donor links", () => {
  expect(transformRightwayRecord(rightwayTestRecord)).toMatchObject({
    status: "available",
    vehicle: {
      source: "rightway",
      vin: rightwayTestRecord.vin,
      year: 2014,
      make: "Ford",
      model: "Focus",
      color: "Blue",
      stockNumber: "01-01-25",
      availableDate: "2025-01-03T00:00:00.000Z",
      imageUrl: null,
      row: null,
      section: null,
      space: null,
      detailsUrl: rightwayTestRecord.nativeUrl,
      stateAbbr: "TN",
      locationCode: "decaturville",
    },
  });
});

test.each([
  [{ color: "Unknown" }, { color: null }],
  [{ color: "" }, { color: null }],
  [{ dateAdded: "2/30/2026" }, { availableDate: null }],
  [{ dateAdded: "" }, { availableDate: null }],
  [{ stock: "Unknown" }, { stockNumber: null }],
  [{ stock: "" }, { stockNumber: null }],
  [
    { stock: "09-55-25", color: "Rust/White" },
    { stockNumber: "09-55-25", color: "Rust/White" },
  ],
])(
  "Rightway retains usable donors while optional metadata is absent or invalid (%#)",
  (patch, metadata) => {
    expect(
      transformRightwayRecord({ ...rightwayTestRecord, ...patch }),
    ).toMatchObject({ status: "available", vehicle: metadata });
  },
);

test.each([
  { year: "" },
  { year: "2014junk" },
  { year: "2101" },
  { make: "Unknown" },
  { model: "" },
])(
  "Rightway rejects missing required YMM but preserves valid presence (%#)",
  (patch) => {
    expect(
      transformRightwayRecord({ ...rightwayTestRecord, ...patch }),
    ).toEqual({ status: "incomplete", vin: rightwayTestRecord.vin });
  },
);

test("Rightway preserves genuine older serials without repairing modern VINs", () => {
  expect(
    transformRightwayRecord({
      ...rightwayTestRecord,
      year: "1980",
      vin: "F14EUHJ1376",
    }).status,
  ).toBe("available");
  expect(
    transformRightwayRecord({ ...rightwayTestRecord, vin: "1FADP3F29EL13014" }),
  ).toEqual({ status: "incomplete", vin: null });
});
