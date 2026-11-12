import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA, makeVehicle } from "./durable-ingestion-test-fixtures";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

describe("AutoRecycler terminal validation", () => {
  test.each([
    { cursor: "50000", accepted: false },
    {
      cursor: '{"phase":"page","beforeId":"1700000000000x1"}',
      accepted: false,
    },
    { cursor: '{"phase":"complete"}', accepted: true },
  ])(
    "requires an explicitly complete record-ID traversal (%j)",
    async ({ cursor, accepted }) => {
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
        await repository.initialize("validation");
        const pathname = await snapshotStore.put({
          runId: "validation",
          source: "autorecycler",
          chunk: {
            vehicles: Array.from({ length: 100 }, (_, index) => ({
              ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
              source: "autorecycler",
            })),
            observedVins: [],
          },
        });
        await client.execute(
          "update ingestion_source_run set status = 'error' where source <> 'autorecycler'",
        );
        await client.execute({
          sql: "update ingestion_source_run set status = 'success', vehicles_processed = 100, next_cursor = ?, snapshot_chunks = ? where source = 'autorecycler'",
          args: [cursor, JSON.stringify([pathname])],
        });
        const result = await validateDurableSourceRuns({
          runId: "validation",
          database,
          batchClient: client,
          snapshotStore,
        });
        expect(result.status).toBe("ready");
        if (result.status !== "ready")
          throw new Error("Validation was skipped");
        expect(result.acceptedSources.includes("autorecycler")).toBe(accepted);
        if (!accepted)
          expect(
            result.rejectedSources.find(
              (source) => source.source === "autorecycler",
            )?.errors,
          ).toContain("autorecycler did not provide terminal cursor evidence");
      } finally {
        client.close();
      }
    },
  );
});
