import { expect, test } from "bun:test";
import { meeksSourceDate, transformMeeksRecord } from "./meeks-transform";
import { meeksSnapshot } from "./meeks-snapshot";
import type { MeeksRecord } from "./meeks-parser";
import { MEEKS_FULL_INVENTORY_URL } from "./meeks-yard-metadata";

const record: MeeksRecord = {
  year: "2014",
  make: "CHEVROLET",
  model: "CAPRICE",
  color: "WHITE",
  stock: "STK000118",
  vin: "6G3NS5U36EL982322",
  row: "0",
  arrival: "06/10/25",
  imageUrl: "https://meeksrecycling.com/vehicle_photos/front.jpg",
  location: "STAGING",
};

test("Meeks maps native required identity and literal optional location without inventing a donor URL", () => {
  expect(transformMeeksRecord(record)).toMatchObject({
    status: "available",
    vehicle: {
      vin: record.vin,
      year: 2014,
      make: "Chevrolet",
      model: "CAPRICE",
      color: "White",
      stockNumber: record.stock,
      row: "0",
      section: "STAGING",
      availableDate: "2025-06-10T00:00:00.000Z",
      detailsUrl: MEEKS_FULL_INVENTORY_URL,
    },
  });
});

test("Meeks accepts native older serials without inferring a replacement identity", () => {
  expect(
    transformMeeksRecord({ ...record, year: "1977", vin: "CCY143F483883" })
      .status,
  ).toBe("available");
  expect(transformMeeksRecord({ ...record, vin: "1FT7X2B67CEC0267" })).toEqual({
    status: "incomplete",
    vin: null,
  });
  expect(transformMeeksRecord({ ...record, model: "" })).toEqual({
    status: "incomplete",
    vin: record.vin,
  });
});

test("Meeks preserves literal models and nulls invalid optional metadata", () => {
  expect(
    transformMeeksRecord({
      ...record,
      model: "TOWN  COUNTRY",
      color: "UNKNOWN",
      stock: "?",
      row: "",
      arrival: "02/30/26",
      imageUrl: "https://example.com/front.jpg",
    }),
  ).toMatchObject({
    status: "available",
    vehicle: {
      model: "TOWN  COUNTRY",
      color: null,
      stockNumber: null,
      row: null,
      availableDate: null,
      imageUrl: null,
    },
  });
});

test("Meeks preserves a native Burned color through the established normalizer", () => {
  expect(transformMeeksRecord({ ...record, color: "BURNED" })).toMatchObject({
    status: "available",
    vehicle: { color: "Burned" },
  });
});

test("Meeks dates require a real MM/DD/YY calendar day in the 20xx century", () => {
  expect(meeksSourceDate("02/29/24")).toBe("2024-02-29T00:00:00.000Z");
  expect(meeksSourceDate("12/31/99")).toBe("2099-12-31T00:00:00.000Z");
  for (const value of [
    "02/29/23",
    "13/01/26",
    "00/10/26",
    "04/31/26",
    "06/00/26",
    "6/10/26",
    "06/10/2026",
    "UNKNOWN",
  ])
    expect(meeksSourceDate(value)).toBeNull();
});

test("Meeks quarantines every required conflict while counting only primary donor observations", () => {
  const changed = { ...record, model: "DIFFERENT" };
  const snapshot = meeksSnapshot([record], [changed]);
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.observedVins).toEqual([record.vin]);
  expect(snapshot.accounting).toMatchObject({
    recordsProcessed: 1,
    recordsRejected: 1,
    duplicateVehicles: 0,
  });
  expect(snapshot.consistencyAccounting).toMatchObject({
    recordsProcessed: 1,
    recordsRejected: 1,
    duplicateVehicles: 0,
  });
});

test("Meeks retains a rejected older serial when only the matching control has a valid year", () => {
  const serial = "CCY143F483883";
  const snapshot = meeksSnapshot(
    [{ ...record, year: "1981", vin: serial }],
    [{ ...record, year: "1977", vin: serial }],
  );
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.observedVins).toEqual([serial]);
  expect(snapshot.accounting.recordsRejected).toBe(1);
  expect(snapshot.consistencyAccounting.recordsRejected).toBe(1);
});

test("Meeks consistency repeats merge optional disagreements to null without adding primary duplicates", () => {
  const snapshot = meeksSnapshot(
    [record],
    [{ ...record, arrival: "06/14/24", stock: "STK000119" }],
  );
  expect(snapshot.vehicles[0]).toMatchObject({
    availableDate: null,
    stockNumber: null,
  });
  expect(snapshot.accounting).toMatchObject({
    recordsProcessed: 1,
    recordsRejected: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.consistencyAccounting.duplicateVehicles).toBe(1);
  expect(() =>
    meeksSnapshot([record], [{ ...record, vin: "JH4CU26689C019172" }]),
  ).toThrow("absent from the primary");
});
