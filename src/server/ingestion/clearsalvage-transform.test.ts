import { expect, test } from "bun:test";
import {
  parseClearsalvageCatalog,
  parseClearsalvageDetail,
} from "./clearsalvage-parser";
import { clearsalvageSaved } from "./clearsalvage-test-fixtures";
import {
  clearsalvageSnapshot,
  transformClearsalvageRecord,
} from "./clearsalvage-transform";

export function savedClearsalvageRecords() {
  const posts = clearsalvageSaved.opening.flatMap(
    (response) =>
      parseClearsalvageCatalog(
        response.raw,
        response.url,
        new Headers(response.headers),
      ).posts,
  );
  return clearsalvageSaved.donors.map((donor) => {
    const post = posts.find((post) => post.url === donor.url);
    if (!post) throw new Error("Saved native post is missing");
    return parseClearsalvageDetail(donor.raw, post);
  });
}

test("Clear full saved census preserves 177 unique and six required rejects while correcting known make typos", () => {
  const records = savedClearsalvageRecords();
  const snapshot = clearsalvageSnapshot(records);
  expect(snapshot.vehicles).toHaveLength(177);
  expect(snapshot.accounting).toEqual({
    recordsProcessed: 183,
    recordsRejected: 6,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(snapshot.observedVins).toEqual(["5N1AR18B08C603476"]);
  const misspellings = records.filter((record) =>
    record.claims.make.some((make) => /^(?:nissian|oldmobile)$/i.test(make)),
  );
  expect(
    misspellings.filter((record) =>
      record.claims.make.some((make) => /^nissian$/i.test(make)),
    ),
  ).toHaveLength(5);
  expect(
    misspellings.some((record) =>
      record.claims.make.some((make) => /^oldmobile$/i.test(make)),
    ),
  ).toBe(true);
  for (const record of misspellings) {
    expect(transformClearsalvageRecord(record)).toMatchObject({
      status: "available",
      vehicle: {
        make: record.claims.make.some((make) => /^nissian$/i.test(make))
          ? "Nissan"
          : "Oldsmobile",
      },
    });
  }
  expect(
    snapshot.vehicles.every(
      (vehicle) =>
        vehicle.imageUrl === null &&
        vehicle.color === null &&
        vehicle.availableDate === null &&
        vehicle.row === null,
    ),
  ).toBe(true);
  const pathfinder = records.find((record) => record.post.id === 5229);
  if (!pathfinder) throw new Error("Saved native post is missing");
  expect(transformClearsalvageRecord(pathfinder).status).toBe("incomplete");
});

test("Clear accepts a future explicit manufacturer absent from the saved census", () => {
  const first = savedClearsalvageRecords()[0];
  if (!first) throw new Error("Saved native record is missing");
  const fiat = {
    ...first,
    post: { ...first.post, title: "FIAT" },
    claims: { ...first.claims, make: ["FIAT"], model: ["500"] },
  };
  const result = transformClearsalvageRecord(fiat);
  expect(result.status).toBe("available");
  if (result.status === "available") expect(result.vehicle.make).toBe("Fiat");
});

test("Clear retains every conflicting required identity as a rejection and preserves valid VIN presence", () => {
  const first = savedClearsalvageRecords()[0];
  if (!first) throw new Error("Saved native record is missing");
  const conflict = {
    ...first,
    post: {
      ...first.post,
      id: 9999,
      url: "https://clearsalvage.com/inventory/conflict/",
    },
    claims: { ...first.claims, model: ["CONFLICT"] },
  };
  const snapshot = clearsalvageSnapshot([first, conflict]);
  expect(snapshot.vehicles).toEqual([]);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.accounting.duplicateVehicles).toBe(0);
  expect(snapshot.observedVins).toEqual(first.claims.vin);
});
