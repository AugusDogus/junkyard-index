import { expect, test } from "bun:test";
import { acceptBrandywineDetail } from "./brandywine-parser";
import { brandywineDonors } from "./brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
} from "./brandywine-test-fixtures";
import {
  brandywineInventorySnapshot,
  validateBrandywineInventorySnapshot,
} from "./brandywine-transform";

const donors = brandywineDonors(brandywineSavedControls("opening"));
const raw = brandywineSavedDetails();
const records = raw.map((detail, index) =>
  acceptBrandywineDetail(detail, donors[index]?.bindings ?? []),
);
const snapshot = brandywineInventorySnapshot(records);

test("only conflict-free CRUSHED and SOLD identities may retire", () => {
  const inactive = records.find(
    (record) => record.status === "required-pass" && record.marker === "SOLD",
  );
  if (!inactive) throw new Error("Missing native sold donor");
  const sole = brandywineInventorySnapshot([inactive]);
  expect(sole.accounting.recordsExcluded).toBe(1);
  expect(sole.observedVins).toEqual([]);
  const active = acceptBrandywineDetail(
    {
      ...inactive.raw,
      fields: inactive.raw.fields.map((field) =>
        field.label === "Row in Yard:" ? { ...field, value: "ROW-01" } : field,
      ),
    },
    inactive.bindings,
  );
  const conflict = brandywineInventorySnapshot([inactive, active]);
  expect(conflict.accounting.recordsExcluded).toBe(0);
  expect(conflict.accounting.recordsRejected).toBe(2);
  expect(conflict.observedVins).toEqual(inactive.validVinClaims);
});

test("source size and unchanged prior-drift guard use eligible unique inventory", () => {
  expect(() =>
    validateBrandywineInventorySnapshot(snapshot, null),
  ).not.toThrow();
  expect(() =>
    validateBrandywineInventorySnapshot(snapshot, 3614),
  ).not.toThrow();
  expect(() => validateBrandywineInventorySnapshot(snapshot, 3616)).toThrow(
    "50% prior-drift",
  );
  expect(() =>
    validateBrandywineInventorySnapshot(
      {
        ...snapshot,
        vehicles: snapshot.vehicles.slice(0, 601),
        accounting: {
          recordsProcessed: 601,
          recordsExcluded: 0,
          recordsRejected: 0,
          duplicateVehicles: 0,
        },
      },
      null,
    ),
  ).toThrow("602 minimum");
  expect(() => validateBrandywineInventorySnapshot(snapshot, -1)).toThrow(
    "authoritative",
  );
});

test("10% rejection and 25% duplicate guards retain their exact inclusive boundaries", () => {
  const vehicles = snapshot.vehicles.slice(0, 1500);
  const at = {
    vehicles,
    observedVins: [],
    accounting: {
      recordsProcessed: 2000,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 500,
    },
  };
  expect(() => validateBrandywineInventorySnapshot(at, null)).not.toThrow();
  expect(() =>
    validateBrandywineInventorySnapshot(
      {
        ...at,
        accounting: {
          ...at.accounting,
          recordsProcessed: 2001,
          duplicateVehicles: 501,
        },
      },
      null,
    ),
  ).toThrow("25% duplicate");
  const rejected = {
    ...at,
    accounting: {
      recordsProcessed: 2000,
      recordsExcluded: 0,
      recordsRejected: 200,
      duplicateVehicles: 300,
    },
  };
  expect(() =>
    validateBrandywineInventorySnapshot(rejected, null),
  ).not.toThrow();
  expect(() =>
    validateBrandywineInventorySnapshot(
      {
        ...rejected,
        accounting: {
          ...rejected.accounting,
          recordsRejected: 201,
          duplicateVehicles: 299,
        },
      },
      null,
    ),
  ).toThrow("10% rejection");
  expect(() =>
    validateBrandywineInventorySnapshot(
      {
        ...rejected,
        accounting: { ...rejected.accounting, recordsProcessed: 2001 },
      },
      null,
    ),
  ).toThrow("accounting partition");
});
