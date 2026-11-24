import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA, makeVehicle } from "./durable-ingestion-test-fixtures";
import { serializeDurableSourceCursor } from "./durable-source";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { ByotCursor } from "./byot-cursor";
import { byotTerminal } from "./byot-test-fixtures";

test("BYOT is registered for qualification and runs unless its flag serves false", () => {
  expect(INGESTION_SOURCES).toContain("byot");
  expect(IngestionSourceFlags.resolve({})).toContain("byot");
});

const initial = ByotCursor.initial();
const complete = byotTerminal(0);

test.each([
  { cursor: null, accepted: false },
  { cursor: serializeDurableSourceCursor(initial), accepted: false },
  {
    cursor: JSON.stringify({ ...initial, phase: "complete" }),
    accepted: false,
  },
  {
    cursor: serializeDurableSourceCursor(complete),
    accepted: true,
  },
])(
  "BYOT staged inventory requires explicit complete traversal: accepted=$accepted",
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
      await repository.initialize("byot-validation", async () => ["byot"]);
      const pathname = await snapshotStore.put({
        runId: "byot-validation",
        source: "byot",
        chunk: {
          vehicles: Array.from({ length: 4_350 }, (_, index) => ({
            ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
            source: "byot",
          })),
          observedVins: [],
        },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = 4350, next_cursor = ?, snapshot_chunks = ? where source = 'byot'",
        args: [cursor, JSON.stringify([pathname])],
      });
      const result = await validateDurableSourceRuns({
        runId: "byot-validation",
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe(accepted ? "ready" : "released");
      if (result.status === "stopped")
        throw new Error("Validation was skipped");
      expect(result.acceptedSources).toEqual(accepted ? ["byot"] : []);
      expect(result.rejectedSources).toEqual(
        accepted
          ? []
          : [
              {
                source: "byot",
                errors: ["byot did not provide terminal cursor evidence"],
              },
            ],
      );
    } finally {
      client.close();
    }
  },
);
