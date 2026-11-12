import { expect, test } from "bun:test";
import {
  aviationArrivalUnion,
  aviationSnapshot,
  validateAviationSnapshot,
} from "./aviation-snapshot";
import {
  aviationFixtureMake,
  aviationFixtureModel,
  aviationFixturePage,
  aviationFixtureRecord,
} from "./aviation-test-fixtures";

const makes = [{ ...aviationFixtureMake, models: [aviationFixtureModel] }];
test("Aviation unions arrival-only donors and quarantines every native VIN conflict with disjoint accounting", () => {
  const rows = Array.from({ length: 20 }, (_, i) =>
    aviationFixtureRecord(i + 1),
  );
  const invalid = aviationFixtureRecord(99);
  invalid[0] = "-";
  const conflict = aviationFixtureRecord(1);
  conflict[2] = "ACURA RDX";
  const extra = aviationFixtureRecord(21);
  const first = aviationFixturePage([rows[1] ?? extra, extra]);
  const snapshot = aviationSnapshot(
    makes,
    [aviationFixturePage([...rows, invalid, conflict])],
    [first, first],
  );
  expect(snapshot.vehicles).toHaveLength(20);
  expect(snapshot.vehicles.some((v) => v.vin === conflict[0])).toBe(false);
  expect(snapshot.vehicles.some((v) => v.vin === extra[0])).toBe(true);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 24,
    recordsExcluded: 0,
    recordsRejected: 3,
    duplicateVehicles: 1,
  });
  expect(() => validateAviationSnapshot(snapshot)).toThrow("10%");
});

test("Aviation preserves supplied optional values and nulls disagreements without extra rejections", () => {
  const record = aviationFixtureRecord(1);
  const enriched = aviationFixtureRecord(1);
  enriched[5] = "ST1/ST1_0.jpg";
  enriched[6] = "2026-10-22";
  const snapshot = aviationSnapshot(
    makes,
    [aviationFixturePage([record])],
    [aviationFixturePage([enriched])],
  );
  expect(snapshot.vehicles[0]).toMatchObject({
    availableDate: "2026-10-22",
    imageUrl: "https://da8h1v3w8q6n5.cloudfront.net/az30/images/ST1/ST1_0.jpg",
  });
  enriched[6] = "2026-10-23";
  const conflict = aviationFixtureRecord(1);
  conflict[6] = "2026-10-22";
  const mismatch = aviationSnapshot(
    makes,
    [aviationFixturePage([conflict])],
    [aviationFixturePage([enriched])],
  );
  expect(mismatch.vehicles[0]?.availableDate).toBeNull();
  expect(mismatch.accounting.recordsRejected).toBe(0);
});

test("Aviation rejects both valid identities sharing the same native donor destination", () => {
  const first = aviationFixtureRecord(1),
    second = aviationFixtureRecord(2);
  second[3] = first[3];
  second[4] = first[4];
  const snapshot = aviationSnapshot(
    makes,
    [aviationFixturePage([first, second])],
    [],
  );
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.observedVins).toContain(first[0]);
  expect(snapshot.observedVins).toContain(second[0]);
});

test("Aviation retains supplied arrival metadata across temporal repeats and keeps conflicting dates null", () => {
  const empty = aviationFixtureRecord(1),
    first = aviationFixtureRecord(1),
    second = aviationFixtureRecord(1);
  first[6] = "2026-10-22";
  second[6] = "2026-10-23";
  expect(
    aviationArrivalUnion([
      aviationFixturePage([empty]),
      aviationFixturePage([first]),
    ])[0]?.[6],
  ).toBe("2026-10-22");
  expect(
    aviationArrivalUnion([
      aviationFixturePage([first]),
      aviationFixturePage([second]),
      aviationFixturePage([first]),
    ])[0]?.[6],
  ).toBeNull();
});
