import { expect, test } from "bun:test";
import { chazSnapshot, validateChazSnapshot } from "./chaz-snapshot";
import {
  chazFixtureMake,
  chazFixtureModel,
  chazFixturePage,
  chazFixtureRecord,
} from "./chaz-test-fixtures";
const makes = [{ ...chazFixtureMake, models: [chazFixtureModel] }];

test("Chaz quarantines every required identity conflict, preserves rejected VIN presence and keeps recent-only donors", () => {
  const first = chazFixtureRecord(1);
  const conflict = chazFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const missing = chazFixtureRecord(3);
  missing[0] = "-";
  const extra = chazFixtureRecord(4);
  const recent = chazFixturePage([chazFixtureRecord(2), extra, conflict]);
  const snapshot = chazSnapshot(
    makes,
    [chazFixturePage([first, chazFixtureRecord(2), missing])],
    [recent, recent],
  );
  expect(snapshot.vehicles.map((vehicle) => vehicle.vin)).toEqual([
    chazFixtureRecord(2)[0],
    extra[0],
  ]);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 6,
    recordsExcluded: 0,
    recordsRejected: 3,
    duplicateVehicles: 1,
  });
  expect(snapshot.observedVins).toEqual([first[0]]);
  expect(snapshot.conflictingVins).toEqual([first[0]]);
});

test("Chaz rejects native Nissan make contradictions and shared donor destinations without choosing winners", () => {
  const record = chazFixtureRecord(1);
  record[2] = "NISSAN ALTIMA";
  const conflict = chazFixtureRecord(1);
  conflict[2] = "NISSAN/DATSUN ALTIMA";
  const snapshot = chazSnapshot(
    [{ ...chazFixtureMake, label: "NISSAN", models: [chazFixtureModel] }],
    [chazFixturePage([record])],
    [chazFixturePage([conflict])],
  );
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toEqual([record[0]]);
  const other = chazFixtureRecord(2);
  other[3] = record[3];
  other[4] = record[4];
  const destination = chazSnapshot(
    makes,
    [chazFixturePage([chazFixtureRecord(1), other])],
    [],
  );
  expect(destination.vehicles).toHaveLength(0);
  expect(destination.observedVins).toHaveLength(2);
});

test("Chaz preserves supplied optional values and keeps temporal arrival conflicts null even when a model agrees with one value", () => {
  const model = chazFixtureRecord(1);
  model[5] = "ST1/ST1_1.jpg";
  model[6] = "2026-10-22";
  const first = chazFixtureRecord(1);
  first[5] = "ST1/ST1_1.jpg";
  first[6] = "2026-10-22";
  const second = chazFixtureRecord(1);
  second[5] = "ST1/ST1_2.jpg";
  second[6] = "2026-10-23";
  const snapshot = chazSnapshot(
    makes,
    [chazFixturePage([model])],
    [chazFixturePage([first]), chazFixturePage([second])],
  );
  expect(snapshot.vehicles[0]).toMatchObject({
    imageUrl: null,
    availableDate: null,
  });
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 2,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 1,
  });
  second[5] = null;
  second[6] = "2026-02-31";
  const retained = chazSnapshot(
    makes,
    [chazFixturePage([model])],
    [chazFixturePage([second])],
  );
  expect(retained.vehicles[0]).toMatchObject({
    imageUrl: "https://da8h1v3w8q6n5.cloudfront.net/md08/images/ST1/ST1_1.jpg",
    availableDate: "2026-10-22",
  });
});

test("Chaz enforces the donor floor and source rejection and duplicate limits", () => {
  const records = Array.from({ length: 900 }, (_, index) =>
    chazFixtureRecord(index + 1),
  );
  expect(() =>
    validateChazSnapshot(chazSnapshot(makes, [chazFixturePage(records)], [])),
  ).not.toThrow();
  expect(() =>
    validateChazSnapshot(
      chazSnapshot(makes, [chazFixturePage(records.slice(1))], []),
    ),
  ).toThrow("below 900");
  const invalid = chazFixtureRecord(999);
  invalid[0] = "-";
  expect(() =>
    validateChazSnapshot(
      chazSnapshot(
        makes,
        [
          chazFixturePage([
            ...records,
            ...Array.from({ length: 101 }, () => invalid),
          ]),
        ],
        [],
      ),
    ),
  ).toThrow("10%");
  expect(() =>
    validateChazSnapshot(
      chazSnapshot(
        makes,
        [chazFixturePage([...records, ...records.slice(0, 301)])],
        [],
      ),
    ),
  ).toThrow("25%");
});
