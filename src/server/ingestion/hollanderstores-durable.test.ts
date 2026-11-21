import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import {
  dehydrateStepReturnValue,
  dehydrateWorkflowReturnValue,
} from "@workflow/core/serialization";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import {
  createTestClient,
  TEST_SCHEMA,
} from "./durable-ingestion-test-fixtures";
import { HollanderstoresDurableCursor } from "./hollanderstores-durable-cursor";
import { streamHollanderstoresDurableInventory } from "./hollanderstores-durable";
import { streamHollanderstoresInventory } from "./hollanderstores-connector";
import { HollanderstoresCursor } from "./hollanderstores-cursor";
import { hollanderstoresFixture } from "./hollanderstores-test-fixtures";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { connectorChunkMetrics } from "./connector-chunk";

test("Hollander checkpoints keep workflow inputs and results small and resume the atomically saved blob", async () => {
  const database = createTestClient();
  try {
    await database.client.executeMultiple(TEST_SCHEMA);
    const store = IngestionSnapshotStore.memory();
    const repository = createDurableIngestionRepository(
      drizzle(database.client),
      database.client,
      store,
    );
    const runId = "hollander-snapshot";
    await repository.initialize(runId);
    const initial = HollanderstoresDurableCursor.initial();
    const result = await Effect.runPromise(
      streamHollanderstoresDurableInventory(
        {
          startCursor: initial,
          loadState: async (path) => (await store.load(path)).checkpointState,
          onBatch: () => Effect.die("Partial census must not publish"),
          readPage: (yard) => Effect.succeed(hollanderstoresFixture(yard.code)),
        },
        (options) =>
          streamHollanderstoresInventory({
            ...options,
            decodeBatch: () => Effect.die("Opening census must not decode"),
          }),
      ),
    );
    const fetched = {
      ...result,
      ...connectorChunkMetrics(result, 0),
      vehicles: [],
      yards: [],
    };
    const saved = await repository.checkpointChunk({
      runId,
      requestedCursor: initial,
      fetched,
    });
    if (saved.cursor.phase === "initial" || !saved.cursor.statePath)
      throw new Error("Missing saved reference");
    expect(saved.status).toBe("paused");
    expect(saved.count).toBe(0);
    expect(saved.cursor.requests).toBe(1);
    const state = await HollanderstoresDurableCursor.load(
      saved.cursor,
      async (path) => (await store.load(path)).checkpointState,
    );
    expect(state.pages).toHaveLength(1);
    expect(state).toEqual(result.checkpointState);
    expect(
      await repository.getCheckpoint({ runId, requestedCursor: initial }),
    ).toEqual(saved);
    expect(
      await repository.checkpointChunk({
        runId,
        requestedCursor: initial,
        fetched,
      }),
    ).toEqual(saved);
    expect(store.pathnames()).toHaveLength(1);
    expect(Buffer.byteLength(JSON.stringify(saved))).toBeLessThan(2048);
    // These are the actual Workflow 5.4 step-result and step-input codecs.
    for (const payload of [
      await dehydrateStepReturnValue(saved, runId, undefined),
      await dehydrateWorkflowReturnValue(
        [runId, saved.cursor],
        runId,
        undefined,
      ),
    ]) {
      expect(payload).toBeInstanceOf(Uint8Array);
      if (!(payload instanceof Uint8Array))
        throw new Error("Expected binary workflow payload");
      expect(payload.byteLength).toBeLessThan(2048);
    }
    const row = await database.client.execute(
      "select next_cursor, snapshot_chunks from ingestion_source_run where source = 'hollanderstores'",
    );
    expect(Buffer.byteLength(String(row.rows[0]?.next_cursor))).toBeLessThan(
      2048,
    );
    expect(String(row.rows[0]?.snapshot_chunks)).toContain(
      saved.cursor.statePath,
    );
    await store.delete(store.pathnames());
    await expect(
      HollanderstoresDurableCursor.load(
        saved.cursor,
        async (path) => (await store.load(path)).checkpointState,
      ),
    ).rejects.toThrow("missing");
  } finally {
    database.cleanup();
  }
});

test("Hollander references reject legacy, corrupt, missing and substituted census state", async () => {
  const initial = HollanderstoresCursor.initial();
  expect(() =>
    HollanderstoresDurableCursor.fromWire(
      HollanderstoresCursor.serialize(initial),
    ),
  ).toThrow();
  const result = await Effect.runPromise(
    streamHollanderstoresInventory({
      readPage: (yard) => Effect.succeed(hollanderstoresFixture(yard.code)),
      decodeBatch: () => Effect.die("Opening census must not decode"),
      onBatch: () => Effect.die("Partial census must not publish"),
    }),
  );
  const wire = HollanderstoresCursor.serialize(result.cursor);
  expect(wire).toBe(JSON.stringify(result.cursor));
  expect(HollanderstoresCursor.fromWire(wire)).toEqual(result.cursor);
  expect(() =>
    HollanderstoresCursor.fromWire(
      wire.replace(/"requests":\d+/, '"requests":0'),
    ),
  ).toThrow();
  const reference = HollanderstoresDurableCursor.checkpoint(result.cursor);
  await expect(
    HollanderstoresDurableCursor.load(reference, async () => result.cursor),
  ).rejects.toThrow("no snapshot path");
  const saved = { ...reference, statePath: "offline/state.json.gz" };
  await expect(
    HollanderstoresDurableCursor.load(saved, async () => ({
      ...result.cursor,
      checksum: "deadbeef",
    })),
  ).rejects.toThrow("checksum changed");
  await expect(
    HollanderstoresDurableCursor.load(
      { ...saved, requests: saved.requests + 1 },
      async () => result.cursor,
    ),
  ).rejects.toThrow("does not match");
  await expect(
    HollanderstoresDurableCursor.load(
      { ...saved, checksum: "deadbeef" },
      async () => result.cursor,
    ),
  ).rejects.toThrow("does not match");
  expect(() =>
    HollanderstoresDurableCursor.parse({
      ...saved,
      pages: result.cursor.pages,
    }),
  ).toThrow();
  expect(() => HollanderstoresDurableCursor.fromWire(" ".repeat(2049))).toThrow(
    "2 KiB",
  );
});
