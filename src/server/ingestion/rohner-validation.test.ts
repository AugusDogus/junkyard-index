import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA, makeVehicle } from "./durable-ingestion-test-fixtures";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { RohnerCursor } from "./rohner-cursor";

test.each([
  null,
  RohnerCursor.serialize(RohnerCursor.initial),
  JSON.stringify({ ...RohnerCursor.initial, phase: "complete" }),
])(
  "Rohner staged inventory cannot pass validation without complete native traversal (%j)",
  async (cursor) => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(TEST_SCHEMA);
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      await repository.initialize("rohner-validation", async () => ["rohner"]);
      const pathname = await snapshotStore.put({
        runId: "rohner-validation",
        source: "rohner",
        chunk: {
          vehicles: Array.from({ length: 286 }, (_, index) => ({
            ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
            source: "rohner",
          })),
          observedVins: [],
        },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = 286, next_cursor = ?, snapshot_chunks = ? where source = 'rohner'",
        args: [cursor, JSON.stringify([pathname])],
      });
      const result = await validateDurableSourceRuns({
        runId: "rohner-validation",
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe("released");
      if (result.status !== "released")
        throw new Error("Validation was skipped");
      expect(result.acceptedSources).toEqual([]);
      expect(result.rejectedSources).toEqual([
        {
          source: "rohner",
          errors: ["rohner did not provide terminal cursor evidence"],
        },
      ]);
    } finally {
      client.close();
    }
  },
);
