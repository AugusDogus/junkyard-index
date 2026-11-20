import { createClient, type Client } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { CanonicalVehicle } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const commitStartedAt = new Date("2026-11-20T08:00:00.000Z");
const listedAt = commitStartedAt.getTime() - 60 * DAY;

function listing(vin: string, locationCode = "yard-1"): CanonicalVehicle {
  return {
    source: "pyp",
    vin,
    year: 2018,
    make: "FORD",
    model: "FOCUS",
    color: "Blue",
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    locationCode,
    locationName: "Yard",
    locationCity: "Tulsa",
    state: "Oklahoma",
    stateAbbr: "OK",
    lat: 36.1,
    lng: -95.9,
    section: null,
    row: null,
    space: null,
    detailsUrl: null,
    partsUrl: null,
    pricesUrl: null,
    engine: null,
    trim: null,
    transmission: null,
  };
}

async function setup(params: {
  stage: "reconcile_upsert" | "reconcile_missing";
  vehicles: readonly CanonicalVehicle[];
}) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
  const database = drizzle(client);
  // pyp has published yard-1 before, so an unknown-date VIN new to it is an
  // observed arrival.
  await client.execute({
    sql: "insert into yard_arrival_baseline (source, location_code, established_at) values ('pyp', 'yard-1', ?)",
    args: [listedAt],
  });
  await database.insert(ingestionRun).values({
    id: "run-pyp",
    source: "pyp",
    status: "running",
    stage: params.stage,
    activeSlot: 1,
    commitStartedAt,
    acceptedSources: JSON.stringify(["pyp"]),
    startedAt: commitStartedAt,
    lastProgressAt: commitStartedAt,
  });
  const snapshotStore = IngestionSnapshotStore.memory();
  const chunk = await snapshotStore.put({
    runId: "run-pyp",
    source: "pyp",
    chunk: { vehicles: [...params.vehicles], observedVins: [] },
  });
  await database.insert(ingestionSourceRun).values({
    id: "run-pyp:pyp",
    runId: "run-pyp",
    source: "pyp",
    status: "success",
    acceptanceStatus: "accepted",
    snapshotChunks: JSON.stringify([chunk]),
    startedAt: commitStartedAt,
  });
  const reconcile = () =>
    reconcileDurableIngestionRun({
      runId: "run-pyp",
      database,
      batchClient: client,
      snapshotStore,
    });
  return { client, reconcile };
}

async function addVehicle(
  client: Client,
  vin: string,
  missingSinceAt: number | null,
) {
  await client.execute({
    sql: `insert into vehicle (
      vin, source, year, make, model, location_code, location_name,
      location_city, state, state_abbr, lat, lng, first_seen_at,
      last_seen_at, missing_since_at, missing_run_count
    ) values (?, 'pyp', 2018, 'FORD', 'FOCUS', 'yard-1', 'Yard', 'Tulsa',
      'Oklahoma', 'OK', 36.1, -95.9, ?, ?, ?, ?)`,
    args: [
      vin,
      listedAt,
      listedAt,
      missingSinceAt,
      missingSinceAt === null ? 0 : 2,
    ],
  });
}

async function addDeparture(
  client: Client,
  vin: string,
  departedAt: number,
  locationCode = "yard-1",
) {
  await client.execute({
    sql: `insert into vehicle_departure (
      vin, source, location_code, year, make, model, available_date,
      first_seen_at, departed_at, recorded_at
    ) values (?, 'pyp', ?, 2018, 'FORD', 'FOCUS', null, ?, ?, ?)`,
    args: [vin, locationCode, listedAt, departedAt, departedAt],
  });
}

async function departures(client: Client) {
  const result = await client.execute(
    "select vin, first_seen_at, departed_at from vehicle_departure order by vin",
  );
  return result.rows.map((row) => [
    row.vin,
    row.first_seen_at,
    row.departed_at,
  ]);
}

test("records a departure in the batch that hard-deletes the vehicle", async () => {
  const missingSinceAt = commitStartedAt.getTime() - 4 * DAY;
  const { client, reconcile } = await setup({
    stage: "reconcile_missing",
    vehicles: [],
  });
  try {
    await addVehicle(client, "VIN-GONE", missingSinceAt);

    expect((await reconcile()).status).toBe("complete");

    const remaining = await client.execute("select vin from vehicle");
    expect(remaining.rows).toEqual([]);
    expect(await departures(client)).toEqual([
      ["VIN-GONE", listedAt, missingSinceAt],
    ]);
  } finally {
    client.close();
  }
});

test("a VIN relisted at its yard within 30 days keeps its first sighting and withdraws its departure", async () => {
  const { client, reconcile } = await setup({
    stage: "reconcile_upsert",
    vehicles: [
      listing("VIN-BACK"),
      listing("VIN-LONG-GONE"),
      listing("VIN-MOVED", "yard-1"),
    ],
  });
  try {
    const recently = commitStartedAt.getTime() - 10 * DAY;
    const longAgo = commitStartedAt.getTime() - 40 * DAY;
    await addDeparture(client, "VIN-BACK", recently);
    await addDeparture(client, "VIN-LONG-GONE", longAgo);
    await addDeparture(client, "VIN-MOVED", recently, "yard-2");

    expect((await reconcile()).status).toBe("complete");

    const vehicles = await client.execute(
      "select vin, first_seen_at, observed_arrival_at from vehicle order by vin",
    );
    expect(
      vehicles.rows.map((row) => [
        row.vin,
        row.first_seen_at,
        row.observed_arrival_at,
      ]),
    ).toEqual([
      // A relist is not an arrival.
      ["VIN-BACK", listedAt, null],
      // Back after the window, or at another yard: a new listing.
      ["VIN-LONG-GONE", commitStartedAt.getTime(), commitStartedAt.getTime()],
      ["VIN-MOVED", commitStartedAt.getTime(), commitStartedAt.getTime()],
    ]);
    expect(await departures(client)).toEqual([
      ["VIN-LONG-GONE", listedAt, longAgo],
      ["VIN-MOVED", listedAt, recently],
    ]);
  } finally {
    client.close();
  }
});

test("a missing vehicle listed again withdraws the departure recorded while it was missing", async () => {
  const missingSinceAt = commitStartedAt.getTime() - DAY;
  const { client, reconcile } = await setup({
    stage: "reconcile_upsert",
    vehicles: [listing("VIN-RETURNED")],
  });
  try {
    await addVehicle(client, "VIN-RETURNED", missingSinceAt);
    // The hourly capture recorded it while it was missing.
    await addDeparture(client, "VIN-RETURNED", missingSinceAt);

    expect((await reconcile()).status).toBe("complete");

    const vehicles = await client.execute(
      "select first_seen_at, missing_since_at from vehicle where vin = 'VIN-RETURNED'",
    );
    expect(
      vehicles.rows.map((row) => [row.first_seen_at, row.missing_since_at]),
    ).toEqual([[listedAt, null]]);
    expect(await departures(client)).toEqual([]);
  } finally {
    client.close();
  }
});
