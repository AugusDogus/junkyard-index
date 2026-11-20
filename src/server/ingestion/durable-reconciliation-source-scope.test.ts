import { createClient, type Client } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun } from "~/schema";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

const DAY = 24 * 60 * 60 * 1000;

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
    ) values (?, 'pyp', 2018, 'FORD', 'FOCUS', 'yard-1', 'Yard 1', 'Tulsa',
      'Oklahoma', 'OK', 36.1, -95.9, 0, 0, ?, ?)`,
    args: [vin, missingSinceAt, missingSinceAt === null ? 0 : 1],
  });
}

test("missing reconciliation leaves rows another source took over after the batch read them", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
    const database = drizzle(client);
    const commitStartedAt = new Date("2026-11-20T08:00:00.000Z");
    const longMissing = commitStartedAt.getTime() - 4 * DAY;
    const recentlyMissing = commitStartedAt.getTime() - DAY;
    // Due for deletion, due to go missing, and observed again (restored).
    await addVehicle(client, "VIN-DELETE", longMissing);
    await addVehicle(client, "VIN-MISS", null);
    await addVehicle(client, "VIN-RESTORE", recentlyMissing);
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
      chunk: { vehicles: [], observedVins: ["VIN-RESTORE"] },
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
    // row52 takes every VIN over between the batch's reads and its write.
    let tookOver = false;
    const batchClient: Pick<Client, "batch"> = {
      batch: async (statements, mode) => {
        if (!tookOver) {
          tookOver = true;
          await client.execute("update vehicle set source = 'row52'");
        }
        return client.batch(statements, mode);
      },
    };

    await reconcileDurableIngestionRun({
      runId: "run-pyp",
      database,
      batchClient,
      snapshotStore,
      budgetMs: 0,
    });

    const rows = await client.execute(
      "select vin, source, missing_since_at, missing_run_count from vehicle order by vin",
    );
    expect(
      rows.rows.map((row) => ({
        vin: row.vin,
        source: row.source,
        missing_since_at: row.missing_since_at,
        missing_run_count: row.missing_run_count,
      })),
    ).toEqual([
      {
        vin: "VIN-DELETE",
        source: "row52",
        missing_since_at: longMissing,
        missing_run_count: 1,
      },
      {
        vin: "VIN-MISS",
        source: "row52",
        missing_since_at: null,
        missing_run_count: 0,
      },
      {
        vin: "VIN-RESTORE",
        source: "row52",
        missing_since_at: recentlyMissing,
        missing_run_count: 1,
      },
    ]);
    // Nor does it queue search changes for rows it no longer owns.
    const changes = await client.execute(
      "select vin, change_type from vehicle_change_v2",
    );
    expect(changes.rows).toEqual([]);
  } finally {
    client.close();
  }
});
