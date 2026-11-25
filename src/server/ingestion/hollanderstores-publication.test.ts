import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { reconcileDurableIngestionRun } from "./durable-reconciliation";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { serializeDurableSourceCursor } from "./durable-source";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { HollanderstoresDurableCursor } from "./hollanderstores-durable-cursor";
import { HOLLANDERSTORES_YARDS } from "./hollanderstores-yard-metadata";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

const scope = HollanderstoresDurableCursor.initial().scope;
const healthy = HOLLANDERSTORES_YARDS.find(
  (yard) => yard.code === "blvdautoparts",
);
const drifted = HOLLANDERSTORES_YARDS.find(
  (yard) => yard.code === "strickerauto",
);

// A day before the run: preserved yards keep inventory only within the
// 7-day hide window of their last publication.
const previousPublication = Date.now() - 24 * 60 * 60 * 1000;

async function setup(preserved: readonly string[]) {
  if (!healthy || !drifted) throw new Error("Missing Hollander yard fixture");
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
  const database = drizzle(client);
  const snapshotStore = IngestionSnapshotStore.memory();
  const repository = createDurableIngestionRepository(
    database,
    client,
    snapshotStore,
  );
  const runId = "hollander-yards";
  await repository.initialize(runId, async () => ["hollanderstores"]);
  const vehicles = Array.from({ length: healthy.minimum }, (_, index) => ({
    ...makeVehicle(`NEW-${index}`),
    source: "hollanderstores" as const,
    locationCode: healthy.code,
  }));
  const path = await snapshotStore.put({
    runId,
    source: "hollanderstores",
    chunk: { vehicles, observedVins: [] },
  });
  const cursor = HollanderstoresDurableCursor.parse({
    source: "hollanderstores",
    version: 2,
    scope,
    phase: "complete",
    requests: 200,
    checksum: "0123abcd",
    ...(preserved.length > 0 && { preserved }),
    statePath: "hollanderstores/state",
  });
  await client.execute({
    sql: "update ingestion_source_run set status = 'success', vehicles_processed = ?, snapshot_chunks = ?, next_cursor = ? where run_id = ?",
    args: [
      vehicles.length,
      JSON.stringify([path]),
      serializeDurableSourceCursor(cursor),
      runId,
    ],
  });
  // Live inventory before this run: the drifted yard is far larger than
  // the yard that publishes, and the publishing yard had one old car.
  for (const [prefix, code, count] of [
    ["KEPT", drifted.code, 2 * healthy.minimum + 1],
    ["GONE", healthy.code, 1],
  ] as const)
    await client.execute({
      sql: `with recursive numbers(n) as (select 1 union all select n+1 from numbers where n < ?)
        insert into vehicle (vin, source, year, make, model, location_code, location_name, location_city, state, state_abbr, lat, lng, first_seen_at, last_seen_at, missing_run_count)
        select ? || '-' || n, 'hollanderstores', 2000, 'Ford', 'Focus', ?, 'Saved Yard', 'City', 'Vermont', 'VT', 1, 1, 1, 1, 0 from numbers`,
      args: [count, prefix, code],
    });
  await client.execute({
    sql: `insert into yard_inventory (source, location_code, location_name, location_city, state_abbr, lat, lng, vehicle_count, last_published_at, updated_at)
      values ('hollanderstores', ?, 'Saved Yard', 'City', 'VT', 1, 1, 1, ?, 5),
             ('hollanderstores', ?, 'Saved Yard', 'City', 'VT', 1, 1, 1, ?, 5)`,
    args: [
      drifted.code,
      previousPublication,
      healthy.code,
      previousPublication,
    ],
  });
  return { client, database, snapshotStore, runId };
}

test("a preserved Hollander yard keeps its inventory and publication time while the other yards publish", async () => {
  if (!healthy || !drifted) throw new Error("Missing Hollander yard fixture");
  // Every yard but one is preserved, so only that yard's floor applies.
  const preserved = HOLLANDERSTORES_YARDS.filter(
    (yard) => yard.code !== healthy.code,
  ).map((yard) => yard.code);
  const { client, database, snapshotStore, runId } = await setup(preserved);
  try {
    const validation = await validateDurableSourceRuns({
      runId,
      database,
      batchClient: client,
      snapshotStore,
    });
    expect(validation).toMatchObject({
      status: "ready",
      acceptedSources: ["hollanderstores"],
    });
    expect(
      (
        await reconcileDurableIngestionRun({
          runId,
          database,
          batchClient: client,
          snapshotStore,
        })
      ).status,
    ).toBe("complete");
    const kept = await client.execute(
      "select count(*) n from vehicle where vin like 'KEPT-%' and missing_since_at is null and missing_run_count = 0",
    );
    expect(kept.rows[0]?.n).toBe(2 * healthy.minimum + 1);
    const gone = await client.execute(
      "select missing_run_count from vehicle where vin = 'GONE-1'",
    );
    expect(gone.rows[0]?.missing_run_count).toBe(1);
    const yards = await client.execute(
      "select location_code, last_published_at from yard_inventory where source = 'hollanderstores' order by location_code",
    );
    const published = new Map(
      yards.rows.map((row) => [row.location_code, row.last_published_at]),
    );
    expect(published.get(drifted.code)).toBe(previousPublication);
    expect(published.get(healthy.code)).not.toBe(previousPublication);
  } finally {
    client.close();
  }
});

test("without preserved yards Hollander keeps its whole-source floor", async () => {
  const { client, database, snapshotStore, runId } = await setup([]);
  try {
    const validation = await validateDurableSourceRuns({
      runId,
      database,
      batchClient: client,
      snapshotStore,
    });
    expect(validation.status).toBe("released");
    expect(
      validation.status === "released" &&
        validation.rejectedSources[0]?.errors.join(" "),
    ).toContain("minimum is 25359");
    // The drift baseline is the live inventory of every publishing yard.
    expect(
      validation.status === "released" &&
        validation.rejectedSources[0]?.errors.join(" "),
    ).toContain(`inventory fell from ${2 * (healthy?.minimum ?? 0) + 2} to`);
  } finally {
    client.close();
  }
});

test("a Hollander run that preserves every yard is rejected, not accepted empty", async () => {
  const { client, database, snapshotStore, runId } = await setup(
    HOLLANDERSTORES_YARDS.map((yard) => yard.code),
  );
  try {
    const validation = await validateDurableSourceRuns({
      runId,
      database,
      batchClient: client,
      snapshotStore,
    });
    expect(validation.status).toBe("released");
    expect(
      validation.status === "released" &&
        validation.rejectedSources[0]?.errors.join(" "),
    ).toContain("preserved every yard");
  } finally {
    client.close();
  }
});
