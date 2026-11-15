import { describe, expect, test } from "bun:test";
import { parseOemDonors, type OemPage } from "./oem-parser";
import { assessOemRecord } from "./oem-record";
import { OemSnapshot } from "./oem-snapshot";
import {
  oemArrivalFixture,
  oemDonorFixture,
  oemF150,
  oemFord,
} from "./oem-test-fixtures";

const page = () =>
  parseOemDonors(oemDonorFixture, {
    kind: "model",
    make: oemFord,
    model: oemF150,
  });
const snapshot = (pages: OemPage[]) => OemSnapshot.create(pages, ["FORD"]);
describe("OEM complete-union quality guards", () => {
  test("keeps required identity while optional metadata is absent", () => {
    const result = snapshot([page()]);
    expect(result.accounting).toEqual({
      recordsProcessed: 1,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(result.vehicles[0]).toMatchObject({
      vin: "1FTMF1KP0RKE76038",
      year: 2024,
      make: "FORD",
      model: "F150 PICKUP",
      stockNumber: "10563",
      availableDate: null,
      color: null,
      row: null,
    });
    expect(
      OemSnapshot.validate(result, {
        minimumUniqueInventory: 1,
        previousUniqueInventory: null,
      }).ok,
    ).toBe(true);
  });
  test("preserves duplicate appearances in accounting without inflating vehicles", () => {
    const result = snapshot([page(), page()]);
    expect(result.vehicles).toHaveLength(1);
    expect(result.accounting.duplicateVehicles).toBe(1);
    expect(
      OemSnapshot.validate(result, {
        minimumUniqueInventory: 1,
        previousUniqueInventory: null,
      }),
    ).toEqual({ ok: false, reasons: ["benign duplicates exceed 25%"] });
  });
  test("a conflicting required claim contaminates every connected occurrence", () => {
    const original = page();
    const conflict = page();
    const row = conflict.records[0];
    if (!row) throw new Error("Missing native fixture donor");
    row.fields.push({ label: "year", value: "2023" });
    const result = snapshot([original, conflict, page()]);
    expect(result.vehicles).toHaveLength(0);
    expect(result.accounting.recordsRejected).toBe(3);
    expect(result.quarantinedIndices).toEqual([0, 1, 2]);
    expect(result.observedVins).toEqual(["1FTMF1KP0RKE76038"]);
  });
  test("a rejected appearance with a known VIN also quarantines a contradictory destination", () => {
    const conflict = page();
    const row = conflict.records[0];
    if (!row) throw new Error("Missing native fixture donor");
    row.destinations = [
      "https://oemautorecyclers.com/parts/FORD/FORD_F150_PICKUP/10563/2023",
    ];
    const result = snapshot([page(), conflict]);
    expect(result.accounting.recordsRejected).toBe(2);
    expect(result.vehicles).toHaveLength(0);
    expect(result.conflicts.some((c) => c.domain === "vin")).toBe(true);
  });
  test("does not emit blank VINs or manufacture presence evidence", () => {
    const blank = parseOemDonors(
      oemDonorFixture.replace("1FTMF1KP0RKE76038", ""),
      { kind: "model", make: oemFord, model: oemF150 },
    );
    const result = snapshot([blank]);
    expect(result.accounting.recordsRejected).toBe(1);
    expect(result.observedVins).toEqual([]);
    const validation = OemSnapshot.validate(result, {
      minimumUniqueInventory: 1,
      previousUniqueInventory: null,
    });
    expect(validation.ok).toBe(false);
    if (!validation.ok)
      expect(validation.reasons).toContain("required rejection exceeds 10%");
  });
  test("applies count reconciliation and previous complete-count drift guards", () => {
    const result = snapshot([page()]);
    const drift = OemSnapshot.validate(result, {
      minimumUniqueInventory: 1,
      previousUniqueInventory: 3,
    });
    expect(drift.ok).toBe(false);
    const corrupt = OemSnapshot.validate(
      { ...result, accounting: { ...result.accounting, recordsProcessed: 2 } },
      { minimumUniqueInventory: 1, previousUniqueInventory: null },
    );
    expect(corrupt).toEqual({
      ok: false,
      reasons: ["native union accounting does not reconcile"],
    });
  });
  test("foreign supplier images create an ownership hold without filtering donors into a qualified subset", () => {
    const foreign = parseOemDonors(
      oemDonorFixture.replaceAll("/oh40/images/", "/mi07/images/"),
      { kind: "model", make: oemFord, model: oemF150 },
    );
    const result = snapshot([foreign]);
    expect(result.vehicles).toHaveLength(1);
    expect(result.vehicles[0]?.imageUrl).toBeNull();
    expect(
      OemSnapshot.validate(result, {
        minimumUniqueInventory: 1,
        previousUniqueInventory: null,
      }),
    ).toEqual({
      ok: false,
      reasons: ["native photo supplier assertions require ownership review"],
    });
  });
  test("contradictory stock claims cannot disappear as optional null metadata", () => {
    const current = page(),
      record = current.records[0];
    if (!record) throw new Error("Missing native fixture donor");
    record.fields.push({ label: "stock", value: "10564" });
    const result = snapshot([current, page()]);
    expect(result.vehicles).toHaveLength(0);
    expect(result.accounting.recordsRejected).toBe(2);
  });
  test("unbound optional photos remain null", () => {
    const current = page();
    const record = current.records[0];
    if (!record) throw new Error("Missing native fixture donor");
    record.images = [
      "https://da8h1v3w8q6n5.cloudfront.net/oh40/images/OTHER/OTHER_0.jpg",
    ];
    const assessed = assessOemRecord(record, ["FORD"]);
    expect(assessed.status).toBe("required-pass");
    expect(assessed.candidate?.imageUrl).toBeNull();
  });
  test("reconciles overlapping arrivals with identical model donors", () => {
    const arrivals = parseOemDonors(oemArrivalFixture, { kind: "arrivals" });
    const result = snapshot([page(), arrivals]);
    expect(result.accounting.recordsProcessed).toBe(2);
    expect(result.accounting.duplicateVehicles).toBe(1);
    expect(result.conflicts).toEqual([]);
  });
});
