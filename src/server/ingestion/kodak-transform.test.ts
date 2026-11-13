import { expect, test } from "bun:test";
import type { KodakRecord } from "./kodak-parser";
import { kodakSnapshot, validateKodakSnapshot } from "./kodak-snapshot";
import { transformKodakRecord } from "./kodak-transform";

const donor = (index = 0): KodakRecord => ({
  item: `MENU_SECTION0_ITEM${index}`,
  title: "2023 NISSAN ALTIMA",
  fields: {
    VIN: "1N4BL4DV0PN" + String(index).padStart(6, "0"),
    Color: "Gray",
    Engine: "2.5L",
  },
  photo: null,
  printedIdentifier: null,
});
const donors = (count = 30) =>
  Array.from({ length: count }, (_, index) => donor(index));

test("native title drives YMM, without decoding VIN or interpreting printed numbers", () => {
  const record = {
    ...donor(),
    title: "2016 DODGE Dart",
    fields: { VIN: "2C3CDXBGXCH111888", Color: "Black/Silver", Engine: "3.6L" },
    printedIdentifier: "#250020",
  };
  expect(transformKodakRecord(record)).toMatchObject({
    status: "available",
    vehicle: {
      year: 2016,
      make: "Dodge",
      model: "Dart",
      stockNumber: null,
      color: "Black/Silver",
      availableDate: null,
      row: null,
      detailsUrl: "https://kodakauto.co/pull-a-part",
    },
  });
});

test("optional foreign or placeholder images become null without rejecting donors", () => {
  for (const photo of [
    "data:image/gif;base64,AAAA",
    "https://foreign.example/car.jpg",
    "https://img1.wsimg.com/isteam/ip/another-site/car.jpg",
    null,
  ])
    expect(transformKodakRecord({ ...donor(), photo })).toMatchObject({
      status: "available",
      vehicle: { imageUrl: null },
    });
});

test("uses actual older-serial rules and retains valid rejected VIN presence", () => {
  expect(
    transformKodakRecord({
      ...donor(),
      title: "1970 CHEVY MONTE CARLO",
      fields: { VIN: "138570F137869" },
    }),
  ).toMatchObject({ status: "available" });
  expect(
    transformKodakRecord({
      ...donor(),
      title: "2023 CHEVY MONTE CARLO",
      fields: { VIN: "138570F137869" },
    }),
  ).toEqual({ status: "incomplete", vin: null });
  const invalid = { ...donor(), title: "" };
  expect(kodakSnapshot([invalid]).observedVins).toEqual([
    donor().fields.VIN ?? "",
  ]);
});

test("all variants of native YMM conflicts are quarantined while shared roster URLs remain valid", () => {
  const rows = donors(31);
  const snapshot = kodakSnapshot([
    ...rows,
    { ...donor(), title: "2022 NISSAN ROGUE" },
  ]);
  expect(snapshot.vehicles).toHaveLength(30);
  expect(snapshot.accounting).toMatchObject({
    recordsProcessed: 32,
    recordsRejected: 2,
    duplicateVehicles: 0,
  });
  expect(snapshot.observedVins).toEqual([donor().fields.VIN ?? ""]);
  expect(() => validateKodakSnapshot(snapshot)).not.toThrow();
});

test("benign repeated native identity keeps nullable optional disagreements", () => {
  const snapshot = kodakSnapshot([
    donor(),
    { ...donor(), fields: { ...donor().fields, Color: "Black" } },
  ]);
  expect(snapshot.vehicles[0]?.color).toBeNull();
  expect(snapshot.accounting.duplicateVehicles).toBe(1);
});

test("minimum and rejection guards apply before emission", () => {
  expect(() => validateKodakSnapshot(kodakSnapshot(donors(29)))).toThrow(
    "30-donor",
  );
  const invalid = (index: number) => ({ ...donor(index), fields: { VIN: "" } });
  expect(() =>
    validateKodakSnapshot(
      kodakSnapshot([
        ...donors(),
        ...Array.from({ length: 3 }, (_, i) => invalid(i + 100)),
      ]),
    ),
  ).not.toThrow();
  expect(() =>
    validateKodakSnapshot(
      kodakSnapshot([
        ...donors(),
        ...Array.from({ length: 4 }, (_, i) => invalid(i + 100)),
      ]),
    ),
  ).toThrow("10%");
});

test("benign duplication guard uses unique plus duplicates plus rejects", () => {
  expect(() =>
    validateKodakSnapshot(
      kodakSnapshot([
        ...donors(),
        ...Array.from({ length: 10 }, () => donor()),
      ]),
    ),
  ).not.toThrow();
  expect(() =>
    validateKodakSnapshot(
      kodakSnapshot([
        ...donors(),
        ...Array.from({ length: 11 }, () => donor()),
      ]),
    ),
  ).toThrow("25%");
});
