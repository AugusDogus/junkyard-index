import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisCursor } from "./urgiis-cursor";
import { loadUrgiisPublishedCursor } from "./urgiis-history";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import {
  createTestClient,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

const terminal = (statePath: string) =>
  UrgiisCursor.checkpoint({
    source: "urgiis",
    version: 2,
    scope: UrgiisCursor.initial(URGIIS_TENANTS).scope,
    startedAt: 1,
    asOf: 1,
    statePath,
    stateHash: "offline-census",
    requests: 0,
    bytes: 0,
    phase: "complete",
    completed: URGIIS_TENANTS.map((t) => ({
      code: t.code,
      accepted: t.minimumInventory,
    })),
  });

test("only accepted published census seeds history; cleanup retains its Blob until the next publication", async () => {
  const { client } = createTestClient();
  const database = drizzle(client);
  const store = IngestionSnapshotStore.memory();
  const repository = createDurableIngestionRepository(database, client, store);
  try {
    await client.executeMultiple(TEST_SCHEMA);
    expect(await loadUrgiisPublishedCursor(database)).toBeNull();
    const paths: Record<string, string> = {};
    for (const [id, published, status, acceptance] of [
      ["accepted", 100, "success", "accepted"],
      ["unpublished", null, "success", "accepted"],
      ["failed", 300, "error", "rejected"],
      ["rejected", 400, "success", "rejected"],
    ] as const) {
      const censusPath = await store.put({
        runId: id,
        source: "urgiis",
        chunk: {
          vehicles: [],
          observedVins: [],
          checkpointState: { census: id },
        },
      });
      const stagingPath = await store.put({
        runId: id,
        source: "urgiis",
        chunk: { vehicles: [], observedVins: [] },
      });
      paths[id] = censusPath;
      await client.execute({
        sql: "insert into ingestion_run (id, source, status, started_at, last_progress_at, inventory_published_at) values (?, 'urgiis', 'success', 1, 1, ?)",
        args: [id, published],
      });
      await client.execute({
        sql: "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, next_cursor, snapshot_chunks, started_at) values (?, ?, 'urgiis', ?, ?, ?, ?, 1)",
        args: [
          id,
          id,
          status,
          acceptance,
          UrgiisCursor.serialize(terminal(censusPath)),
          JSON.stringify([stagingPath, censusPath]),
        ],
      });
    }
    const accepted = paths.accepted;
    if (!accepted) throw new Error("Missing accepted Blob");
    expect(await loadUrgiisPublishedCursor(database)).toEqual(
      terminal(accepted),
    );
    await repository.cleanupStaleSnapshots();
    expect(store.pathnames()).toEqual([accepted]);
    // The retained path stays tracked so a later publication can collect it.
    const row = await client.execute(
      "select snapshot_chunks from ingestion_source_run where id = 'accepted'",
    );
    expect(row.rows[0]?.snapshot_chunks).toBe(JSON.stringify([accepted]));
    const next = await store.put({
      runId: "next",
      source: "urgiis",
      chunk: {
        vehicles: [],
        observedVins: [],
        checkpointState: { census: "next" },
      },
    });
    await client.execute(
      "insert into ingestion_run (id, source, status, started_at, last_progress_at, inventory_published_at) values ('next', 'urgiis', 'success', 1, 1, 500)",
    );
    await client.execute({
      sql: "insert into ingestion_source_run (id, run_id, source, status, acceptance_status, next_cursor, snapshot_chunks, started_at) values ('next', 'next', 'urgiis', 'success', 'accepted', ?, ?, 1)",
      args: [UrgiisCursor.serialize(terminal(next)), JSON.stringify([next])],
    });
    await repository.cleanupStaleSnapshots();
    expect(store.pathnames()).toEqual([next]);
    await client.execute(
      "update ingestion_source_run set next_cursor = 'corrupt' where id = 'next'",
    );
    expect(await loadUrgiisPublishedCursor(database)).toBe("corrupt");
  } finally {
    client.close();
  }
});
