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
import { PRATT_CONTRACT } from "./pratt-configuration";
import { PrattCursor } from "./pratt-cursor";

test("Pratt is registered for qualification and runs unless its flag serves false", () => {
  expect(INGESTION_SOURCES).toContain("pratt");
  expect(IngestionSourceFlags.resolve({})).toContain("pratt");
});

const initial = PrattCursor.initial(PRATT_CONTRACT);
const complete = PrattCursor.checkpoint(
  {
    source: "pratt",
    version: 1,
    phase: "complete",
    scope: initial.scope,
    requests: 518,
    bytes: 80_000_000,
  },
  PRATT_CONTRACT,
);
if (!complete.ok) throw new Error(complete.error.message);

test.each([
  { cursor: null, accepted: false },
  { cursor: serializeDurableSourceCursor(initial), accepted: false },
  {
    cursor: JSON.stringify({ ...initial, phase: "complete" }),
    accepted: false,
  },
  {
    cursor: serializeDurableSourceCursor(complete.value),
    accepted: true,
  },
])(
  "Pratt staged inventory requires explicit complete traversal: accepted=$accepted, cursor=$cursor",
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
      await repository.initialize("pratt-validation", async () => ["pratt"]);
      const pathname = await snapshotStore.put({
        runId: "pratt-validation",
        source: "pratt",
        chunk: {
          vehicles: Array.from({ length: 5_000 }, (_, index) => ({
            ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
            source: "pratt",
          })),
          observedVins: [],
        },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = 5000, next_cursor = ?, snapshot_chunks = ? where source = 'pratt'",
        args: [cursor, JSON.stringify([pathname])],
      });
      const result = await validateDurableSourceRuns({
        runId: "pratt-validation",
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe(accepted ? "ready" : "released");
      if (result.status === "stopped")
        throw new Error("Validation was skipped");
      expect(result.acceptedSources).toEqual(accepted ? ["pratt"] : []);
      expect(result.rejectedSources).toEqual(
        accepted
          ? []
          : [
              {
                source: "pratt",
                errors: ["pratt did not provide terminal cursor evidence"],
              },
            ],
      );
    } finally {
      client.close();
    }
  },
);
