import { expect, test } from "bun:test";
import { decodePypFilterResponse, decodePypLocations } from "./pyp-api";
import { transformPypVehicle } from "./pyp-transform";
import { toAlgoliaRecord } from "./types";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { planChangedVehicleUpserts } from "./reconciliation-policy";
import filterFixture from "./pyp-test-fixtures/riverside-filter.json";
import locationFixture from "./pyp-test-fixtures/riverside-location.json";

const locations = new Map(
  decodePypLocations(locationFixture).map((location) => [
    location.locationCode,
    location,
  ]),
);
const vehicles = decodePypFilterResponse(filterFixture).ResponseData.Vehicles;
const positionedVehicle = vehicles.find(
  (vehicle) => vehicle.Vin === "JHMES96644S020762",
);
if (!positionedVehicle)
  throw new Error("Riverside fixture omitted the sample VIN");

test("updates a previously unpositioned vehicle from the bulk fixture through search projection", async () => {
  const canonical = transformPypVehicle(positionedVehicle, locations);
  if (!canonical) throw new Error("Riverside fixture did not transform");
  const position = { section: "LEVEL 1", row: "23", space: "5" };
  expect(canonical).toMatchObject({
    ...position,
    engine: null,
    transmission: null,
  });
  const store = IngestionSnapshotStore.memory();
  const pathname = await store.put({
    runId: "pyp-position-test",
    source: "pyp",
    chunk: { vehicles: [canonical], observedVins: [] },
  });
  const staged = await store.load(pathname);
  const now = new Date("2026-11-19");
  const changed = planChangedVehicleUpserts({
    inventory: new Map(
      staged.vehicles.map((vehicle) => [vehicle.vin, vehicle]),
    ),
    existingRows: [
      {
        ...canonical,
        sourceMake: null,
        sourceModel: null,
        section: null,
        row: null,
        space: null,
        firstSeenAt: now,
        lastSeenAt: now,
        observedArrivalAt: null,
        missingSinceAt: null,
        missingRunCount: 0,
      },
    ],
    recentDepartures: [],
    runTimestamp: now,
    acceptedSources: new Set(["pyp"]),
    publishedYards: new Map(),
  });
  expect(changed).toHaveLength(1);
  const update = changed[0];
  if (!update)
    throw new Error("Yard position change did not produce an upsert");
  expect(toAlgoliaRecord(update.vehicle, now, null, 0, null)).toMatchObject(
    position,
  );
});

test("keeps vehicles whose bulk record has no yard position", () => {
  const vehicle = vehicles.find(
    (vehicle) => vehicle.Vin === "19UUA56823A028973",
  );
  if (!vehicle)
    throw new Error("Riverside fixture omitted the unpositioned VIN");
  expect(transformPypVehicle(vehicle, locations)).toMatchObject({
    vin: vehicle.Vin,
    section: null,
    row: null,
    space: null,
  });
});

test.each([
  "",
  "   ",
  "N/A",
  " n/a ",
  "N.A.",
  "NA",
  "None",
  "null",
  "undefined",
  "Unknown",
  "(Unknown)",
  "TBD",
  "TBA",
  "Pending",
  "Unassigned",
  "Not Assigned",
  "Not Available",
  "Not Applicable",
  "Unavailable",
  "-",
  "--",
  "?",
  "A".repeat(41),
  "<b>23</b>",
  "https://example.com/row/23",
  "23\u0000",
  "23\n24",
])("rejects unusable yard position %j without losing the vehicle", (value) => {
  expect(
    transformPypVehicle(
      { ...positionedVehicle, Section: value, Row: value, SpaceNumber: value },
      locations,
    ),
  ).toMatchObject({
    vin: positionedVehicle.Vin,
    section: null,
    row: null,
    space: null,
  });
});

test.each([
  "LEVEL 1",
  "TRUCK SUV",
  "p1",
  "A-2",
  "0",
  "12/13",
  "A & B",
  "A".repeat(40),
])("trims and retains usable yard position %j", (value) => {
  expect(
    transformPypVehicle(
      {
        ...positionedVehicle,
        Section: ` ${value} `,
        Row: ` ${value} `,
        SpaceNumber: ` ${value} `,
      },
      locations,
    ),
  ).toMatchObject({ section: value, row: value, space: value });
});
