import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import type { CanonicalVehicle } from "./types";

function listing(vin: string): CanonicalVehicle {
  return {
    source: "pyp",
    vin,
    year: 2018,
    make: "FORD",
    model: "FOCUS",
    color: null,
    stockNumber: null,
    imageUrl: null,
    availableDate: null,
    locationCode: "yard-1",
    locationName: "Yard 1",
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

test("publication counts live vehicles and yards from the yard summaries", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const commitStartedAt = new Date("2026-11-20T08:00:00.000Z");
    const at = commitStartedAt.getTime();
    // pyp lists VIN-1 and VIN-2 at yard-1 and drops VIN-3 there. It also
    // drops the only vehicles of yard-2 and yard-3, which leave the summary
    // while their rows stay in the table, missing. row52 shares the yard-1
    // code and owns VIN-8 at yard-8, missing until pyp observes it again.
    const add = (
      vin: string,
      source: string,
      locationCode: string,
      missingSinceAt: number | null,
    ) =>
      client.execute({
        sql: `insert into vehicle (
          vin, source, year, make, model, location_code, location_name,
          location_city, state, state_abbr, lat, lng, first_seen_at,
          last_seen_at, missing_since_at, missing_run_count
        ) values (?, ?, 2018, 'FORD', 'FOCUS', ?, 'Yard', 'Tulsa', 'Oklahoma',
          'OK', 36.1, -95.9, ?, ?, ?, ?)`,
        args: [
          vin,
          source,
          locationCode,
          at,
          at,
          missingSinceAt,
          missingSinceAt === null ? 0 : 1,
        ],
      });
    await add("VIN-1", "pyp", "yard-1", null);
    await add("VIN-2", "pyp", "yard-1", null);
    await add("VIN-3", "pyp", "yard-1", null);
    await add("VIN-4", "pyp", "yard-2", null);
    await add("VIN-5", "pyp", "yard-3", null);
    await add("VIN-9", "row52", "yard-1", null);
    await add("VIN-8", "row52", "yard-8", at - 24 * 60 * 60 * 1000);
    await client.execute(`insert into yard_inventory (source, location_code, location_name, location_city, state_abbr, lat, lng, vehicle_count, inventory_url, updated_at) values
      ('row52', 'yard-1', 'Yard', 'Tulsa', 'OK', 36.1, -95.9, 1, null, 0)`);
    await database.insert(ingestionRun).values({
      id: "run-pyp",
      source: "pyp",
      status: "running",
      stage: "reconcile_missing",
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
      chunk: {
        vehicles: [listing("VIN-1"), listing("VIN-2")],
        observedVins: ["VIN-8"],
      },
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

    const result = await reconcileDurableIngestionRun({
      runId: "run-pyp",
      database,
      batchClient: client,
      snapshotStore,
    });

    expect(result.status).toBe("complete");
    const run = await client.execute(
      "select published_vehicle_count, published_yard_count from ingestion_run where id = 'run-pyp'",
    );
    expect(
      run.rows.map((row) => [
        row.published_vehicle_count,
        row.published_yard_count,
      ]),
      // Live: VIN-1, VIN-2, VIN-9 and the restored VIN-8, in pyp/yard-1,
      // row52/yard-1 and row52/yard-8. A whole-table count gives 7 vehicles
      // in 4 distinct location codes.
    ).toEqual([[4, 3]]);
  } finally {
    client.close();
  }
});
