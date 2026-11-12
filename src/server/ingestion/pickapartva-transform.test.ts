import { expect, test } from "bun:test";
import { pickapartvaTestRecord } from "./pickapartva-test-fixtures";
import {
  mergePickapartvaVehicles,
  transformPickapartvaRecord,
} from "./pickapartva-transform";

test("Pick-A-Part VA retains verified identity/geography while absent optional metadata stays null", () => {
  const result = transformPickapartvaRecord(
    {
      ...pickapartvaTestRecord,
      stock: "",
      row: "",
      setDate: "",
      imageUrl: "https://foreign.example/photo.jpg",
    },
    1,
  );
  expect(result).toMatchObject({
    status: "available",
    vehicle: {
      source: "pickapartva",
      vin: pickapartvaTestRecord.vin,
      color: null,
      stockNumber: null,
      row: null,
      availableDate: null,
      imageUrl: null,
      locationCode: "TT87",
      stateAbbr: "VA",
      lat: 38.271385,
      lng: -77.492726,
    },
  });
});

test.each([
  { ...pickapartvaTestRecord, year: "2004", vin: "1FTZR45E14PB1190" },
  { ...pickapartvaTestRecord, year: "not a year" },
  { ...pickapartvaTestRecord, make: "Unknown" },
  { ...pickapartvaTestRecord, model: "" },
])(
  "Pick-A-Part VA rejects incomplete required identity independently of optional fields (%#)",
  (record) => {
    expect(transformPickapartvaRecord(record, 1).status).toBe("incomplete");
  },
);

test("Pick-A-Part VA supports genuine pre-1981 serials and preserves valid rejected VIN presence", () => {
  expect(
    transformPickapartvaRecord(
      { ...pickapartvaTestRecord, year: "1976", vin: "J6A03EW051988" },
      1,
    ).status,
  ).toBe("available");
  expect(
    transformPickapartvaRecord(
      { ...pickapartvaTestRecord, model: "Unknown" },
      1,
    ),
  ).toEqual({ status: "incomplete", vin: pickapartvaTestRecord.vin });
});

test("Pick-A-Part VA merges only optional conflicts and uses a common verified destination for different stocks", () => {
  const first = transformPickapartvaRecord(pickapartvaTestRecord, 1);
  const next = transformPickapartvaRecord(
    {
      ...pickapartvaTestRecord,
      stock: "PAP100001",
      cardId: "PAP100001",
      row: "999",
      setDate: "2026-11-11",
    },
    2,
  );
  if (first.status !== "available" || next.status !== "available")
    throw new Error("Expected valid fixture donors");
  expect(mergePickapartvaVehicles(first.vehicle, next.vehicle)).toMatchObject({
    vin: first.vehicle.vin,
    stockNumber: null,
    row: null,
    availableDate: null,
    detailsUrl: "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY",
  });
  expect(
    mergePickapartvaVehicles(first.vehicle, {
      ...first.vehicle,
      detailsUrl:
        "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=2#PAP100000",
    }).detailsUrl,
  ).toBe(first.vehicle.detailsUrl);
  expect(() =>
    mergePickapartvaVehicles(first.vehicle, { ...next.vehicle, year: 2009 }),
  ).toThrow("conflicting");
  expect(() =>
    mergePickapartvaVehicles(first.vehicle, {
      ...next.vehicle,
      locationCode: "UU81",
    }),
  ).toThrow("physical yard");
});
