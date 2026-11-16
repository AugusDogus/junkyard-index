import { expect, test } from "bun:test";
import { aplusSnapshot, validateAplusSnapshot } from "./aplus-snapshot";
import {
  aplusFixtureMake,
  aplusFixtureModel,
  aplusFixturePage,
  aplusFixtureRecord,
} from "./aplus-test-fixtures";
const makes = [{ ...aplusFixtureMake, models: [aplusFixtureModel] }];

test("Aplus quarantines every required identity conflict, preserves rejected VIN presence and keeps recent-only donors", () => {
  const first = aplusFixtureRecord(1);
  const conflict = aplusFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const missing = aplusFixtureRecord(3);
  missing[0] = "-";
  const extra = aplusFixtureRecord(4);
  const recent = aplusFixturePage([aplusFixtureRecord(2), extra, conflict]);
  const snapshot = aplusSnapshot(
    makes,
    [aplusFixturePage([first, aplusFixtureRecord(2), missing])],
    [recent, recent],
  );
  expect(snapshot.vehicles.map((vehicle) => vehicle.vin)).toEqual([
    aplusFixtureRecord(2)[0],
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

test("Aplus rejects native Nissan make contradictions and shared donor destinations without choosing winners", () => {
  const record = aplusFixtureRecord(1);
  record[2] = "NISSAN ALTIMA";
  const conflict = aplusFixtureRecord(1);
  conflict[2] = "NISSAN/DATSUN ALTIMA";
  const snapshot = aplusSnapshot(
    [{ ...aplusFixtureMake, label: "NISSAN", models: [aplusFixtureModel] }],
    [aplusFixturePage([record])],
    [aplusFixturePage([conflict])],
  );
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toEqual([record[0]]);
  const other = aplusFixtureRecord(2);
  other[3] = record[3];
  other[4] = record[4];
  const destination = aplusSnapshot(
    makes,
    [aplusFixturePage([aplusFixtureRecord(1), other])],
    [],
  );
  expect(destination.vehicles).toHaveLength(0);
  expect(destination.observedVins).toHaveLength(2);
});

test("Aplus preserves supplied optional values and keeps temporal arrival conflicts null even when a model agrees with one value", () => {
  const model = aplusFixtureRecord(1);
  model[5] = "ST1/ST1_1.jpg";
  model[6] = "2026-10-22";
  const first = aplusFixtureRecord(1);
  first[5] = "ST1/ST1_1.jpg";
  first[6] = "2026-10-22";
  const second = aplusFixtureRecord(1);
  second[5] = "ST1/ST1_2.jpg";
  second[6] = "2026-10-23";
  const snapshot = aplusSnapshot(
    makes,
    [aplusFixturePage([model])],
    [aplusFixturePage([first]), aplusFixturePage([second])],
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
  const retained = aplusSnapshot(
    makes,
    [aplusFixturePage([model])],
    [aplusFixturePage([second])],
  );
  expect(retained.vehicles[0]).toMatchObject({
    imageUrl: "https://da8h1v3w8q6n5.cloudfront.net/qq91/images/ST1/ST1_1.jpg",
    availableDate: "2026-10-22",
  });
});

test("Aplus enforces the donor floor and source rejection and duplicate limits", () => {
  const records = Array.from({ length: 1000 }, (_, index) =>
    aplusFixtureRecord(index + 1),
  );
  expect(() =>
    validateAplusSnapshot(
      aplusSnapshot(makes, [aplusFixturePage(records)], []),
    ),
  ).not.toThrow();
  expect(() =>
    validateAplusSnapshot(
      aplusSnapshot(makes, [aplusFixturePage(records.slice(0, 406))], []),
    ),
  ).toThrow("below 407");
  const invalid = aplusFixtureRecord(999);
  invalid[0] = "-";
  expect(() =>
    validateAplusSnapshot(
      aplusSnapshot(
        makes,
        [
          aplusFixturePage([
            ...records,
            ...Array.from({ length: 112 }, () => invalid),
          ]),
        ],
        [],
      ),
    ),
  ).toThrow("10%");
  expect(() =>
    validateAplusSnapshot(
      aplusSnapshot(
        makes,
        [aplusFixturePage([...records, ...records.slice(0, 334)])],
        [],
      ),
    ),
  ).toThrow("25%");
});

test("A Plus quarantines native Mercedes model changes before canonical normalization", () => {
  const record = aplusFixtureRecord(1);
  record[2] = "MERCEDES GL-CLASS";
  record[4] = "/parts/MERCEDES/MERCEDES_GL~CLASS/ST1/2003";
  const arrival = aplusFixtureRecord(1);
  arrival[2] = "MERCEDES-BENZ MERCEDES GLC-CLASS";
  arrival[4] = "/parts/MERCEDES~BENZ/MERCEDES_GLC~CLASS/ST1/2003";
  const snapshot = aplusSnapshot(
    [{ ...aplusFixtureMake, label: "MERCEDES", models: [aplusFixtureModel] }],
    [aplusFixturePage([record])],
    [aplusFixturePage([arrival]), aplusFixturePage([arrival])],
  );
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsProcessed).toBe(2);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toEqual([record[0]]);
});
