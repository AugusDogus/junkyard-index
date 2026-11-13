import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { RMMDTP_CONTRACT } from "./rmmdtp-configuration";
import { parseRmmdtpPage } from "./rmmdtp-parser";
import { rmmdtpSnapshot, validateRmmdtpSnapshot } from "./rmmdtp-snapshot";
import { rmmdtpFixture } from "./rmmdtp-test-fixtures";
import { assessRmmdtpRecord, transformRmmdtpRecord } from "./rmmdtp-transform";
import { validateSourceSnapshot } from "./source-validation";

const rows = () =>
  Array.from({ length: 5 }, (_, index) =>
    parseRmmdtpPage(rmmdtpFixture("opening", index + 1), index + 1),
  ).flatMap((page) => page.records);
test("RMMDTP matches every native canonical reference field and rejected VIN presence", () => {
  const oracle: unknown = JSON.parse(
    readFileSync(
      new URL(
        "./rmmdtp-test-fixtures/canonical-reference.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  if (!Array.isArray(oracle))
    throw new Error("Expected saved canonical reference array");
  const expected = oracle.flatMap((item: unknown) =>
    item !== null &&
    typeof item === "object" &&
    "status" in item &&
    item.status === "accepted_candidate" &&
    "vehicle" in item
      ? [item.vehicle]
      : [],
  );
  const snapshot = rmmdtpSnapshot(rows(), RMMDTP_CONTRACT);
  expect<unknown>(snapshot.vehicles).toEqual(expected);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 106,
    recordsRejected: 1,
    recordsExcluded: 2,
    duplicateVehicles: 0,
  });
  expect(snapshot.observedVins).toHaveLength(1);
  expect(
    snapshot.vehicles.find((vehicle) => vehicle.vin === "TCE678V579854")?.year,
  ).toBe(1978);
  expect(validateRmmdtpSnapshot(snapshot, RMMDTP_CONTRACT, null).ok).toBe(true);
});

test("RMMDTP quarantine propagates through identity groups before Complete exclusions", () => {
  const all = rows(),
    donor = all[0],
    complete = all.find((row) => row.fields.Condition === "Complete"),
    third = all[1];
  if (!donor || !complete || !third)
    throw new Error("Native conflict controls are missing");
  const sale = {
    ...complete,
    fields: {
      ...complete.fields,
      "Vin Number": donor.fields["Vin Number"] ?? "",
    },
  };
  const bridge = {
    ...sale,
    fields: { ...sale.fields, "Vin Number": third.fields["Vin Number"] ?? "" },
  };
  const snapshot = rmmdtpSnapshot([donor, sale, bridge], RMMDTP_CONTRACT);
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.quarantinedIndices).toEqual([0, 1, 2]);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 3,
    recordsRejected: 3,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.observedVins).toEqual(
    [assessRmmdtpRecord(donor).vin, assessRmmdtpRecord(third).vin]
      .filter((vin) => vin !== null)
      .sort(),
  );
});

test("RMMDTP optional metadata never gates donors and ambiguous duplicate metadata becomes null", () => {
  const donor = rows()[0];
  if (!donor) throw new Error("Native donor control is missing");
  const bare = {
    ...donor,
    imageUrl: null,
    fields: { ...donor.fields, "Lot Number": "", "Engine Model": "" },
  };
  const vehicle = transformRmmdtpRecord(bare, RMMDTP_CONTRACT);
  expect(vehicle?.vin).toBe("3FRNF6FC3FV525419");
  expect(vehicle?.stockNumber).toBeNull();
  expect(vehicle?.imageUrl).toBeNull();
  expect(vehicle?.engine).toBeNull();
  const changed = {
    ...donor,
    imageUrl: donor.imageUrl?.replace("b6712d3e", "b6712d3f") ?? null,
    fields: {
      ...donor.fields,
      "Lot Number": "other-stock",
      "Engine Model": "another engine",
    },
  };
  const snapshot = rmmdtpSnapshot([donor, changed], RMMDTP_CONTRACT);
  expect(snapshot.accounting.duplicateVehicles).toBe(1);
  expect(snapshot.vehicles[0]?.stockNumber).toBeNull();
  expect(snapshot.vehicles[0]?.engine).toBeNull();
  expect(snapshot.vehicles[0]?.imageUrl).toBeNull();
});

test("RMMDTP keeps the qualified minimum, 10% rejects, 25% duplicates and 50% prior-count drift", () => {
  const all = rows(),
    donor = all[0];
  if (!donor) throw new Error("Native donor control is missing");
  const snapshot = rmmdtpSnapshot(all, RMMDTP_CONTRACT);
  expect(validateRmmdtpSnapshot(snapshot, RMMDTP_CONTRACT, 206).ok).toBe(true);
  for (const previous of [207, 208]) {
    const shared = validateSourceSnapshot({
      source: "rmmdtp",
      terminal: true,
      uniqueVehicles: 103,
      vehiclesProcessed: 104,
      duplicateVehicles: 0,
      rejectedVehicles: 1,
      errors: [],
      previousAcceptedCount: previous,
    });
    expect(validateRmmdtpSnapshot(snapshot, RMMDTP_CONTRACT, previous).ok).toBe(
      shared.status === "accepted",
    );
    expect(shared.status).toBe(previous === 207 ? "accepted" : "rejected");
  }
  expect(
    validateRmmdtpSnapshot(
      snapshot,
      { ...RMMDTP_CONTRACT, minimumUniqueInventory: 104 },
      null,
    ).ok,
  ).toBe(false);
  for (const extraRejects of [9, 10]) {
    const changed = all.map((row, index) =>
      index < extraRejects
        ? { ...row, fields: { ...row.fields, "Truck Model": "Other" } }
        : row,
    );
    const assessed = rmmdtpSnapshot(changed, RMMDTP_CONTRACT);
    expect(assessed.accounting.recordsRejected).toBe(extraRejects + 1);
    expect(validateRmmdtpSnapshot(assessed, RMMDTP_CONTRACT, null).ok).toBe(
      extraRejects === 9,
    );
  }
  for (const duplicates of [34, 35]) {
    const assessed = rmmdtpSnapshot(
      [...all, ...Array.from({ length: duplicates }, () => donor)],
      RMMDTP_CONTRACT,
    );
    expect(assessed.accounting.duplicateVehicles).toBe(duplicates);
    expect(validateRmmdtpSnapshot(assessed, RMMDTP_CONTRACT, null).ok).toBe(
      duplicates === 34,
    );
  }
});
