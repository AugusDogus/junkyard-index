import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { stringify } from "devalue";
import { BrandywineCursor } from "./brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
} from "./brandywine-test-fixtures";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import {
  createTestClient,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";
import { serializeDurableSourceCursor } from "./durable-source";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

function largeBrandywineCursor() {
  return BrandywineCursor.checkpoint({
    ...BrandywineCursor.initial(null),
    startedAt: Date.parse("2026-11-17T07:00:00Z"),
    phase: "complete",
    opening: brandywineSavedControls("opening"),
    details: brandywineSavedDetails(),
    closing: brandywineSavedControls("closing"),
  });
}

test("large provider state leaves Workflow steps through registered snapshot references", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const store = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      store,
    );
    await repository.initialize("payload");
    const cursor = largeBrandywineCursor();
    const wire = serializeDurableSourceCursor(cursor);
    expect(Buffer.byteLength(stringify(["payload", cursor]))).toBeGreaterThan(
      1_000_000,
    );
    await client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where run_id = 'payload' and source = 'brandywine'",
      args: [wire],
    });
    const compact = await repository.workflowCursor("payload", cursor);
    expect(Buffer.byteLength(stringify(["payload", compact]))).toBeLessThan(
      1024,
    );
    expect(
      Buffer.byteLength(
        stringify({
          cursor: compact,
          status: "complete",
          count: 1807,
          errors: [],
          pagesProcessed: 3,
        }),
      ),
    ).toBeLessThan(1024);
    expect(await repository.resolveWorkflowCursor("payload", compact)).toEqual(
      cursor,
    );
    expect(await repository.resolveWorkflowCursor("payload", cursor)).toEqual(
      cursor,
    );
    if (!("snapshotCursor" in compact))
      throw new Error("Expected snapshot cursor");
    await expect(
      repository.resolveWorkflowCursor("another-run", compact),
    ).rejects.toThrow("unregistered snapshot");
    await expect(
      repository.resolveWorkflowCursor("payload", {
        ...compact,
        snapshotCursor: { ...compact.snapshotCursor, checksum: "a".repeat(64) },
      }),
    ).rejects.toThrow("checksum");
    await client.execute(
      "update ingestion_run set active_slot = null, status = 'success', stage = 'released' where id = 'payload'",
    );
    await repository.cleanupBatch("payload");
    expect(store.pathnames()).toEqual([]);
  } finally {
    cleanup();
  }
});

test("a losing snapshot registration deletes its staged state and reports the changed checkpoint", async () => {
  const { client, cleanup } = createTestClient();
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const store = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(client),
      client,
      store,
    );
    await repository.initialize("race");
    await expect(
      repository.workflowCursor("race", largeBrandywineCursor()),
    ).rejects.toThrow("checkpoint changed");
    expect(store.pathnames()).toEqual([]);
    const cursor = largeBrandywineCursor();
    await client.execute({
      sql: "update ingestion_source_run set next_cursor = ? where run_id = 'race' and source = 'brandywine'",
      args: [serializeDurableSourceCursor(cursor)],
    });
    await client.execute(
      "update ingestion_run set active_slot = null, status = 'success' where id = 'race'",
    );
    await expect(repository.workflowCursor("race", cursor)).rejects.toThrow(
      "checkpoint changed",
    );
    expect(store.pathnames()).toEqual([]);
  } finally {
    cleanup();
  }
});
