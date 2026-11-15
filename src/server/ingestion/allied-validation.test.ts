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
import { ALLIED_CONTRACT } from "./allied-configuration";
import { AlliedCursor } from "./allied-cursor";

test("Allied is registered for qualification and requires explicit rollout", () => {
  expect(INGESTION_SOURCES).toContain("allied");
  expect(IngestionSourceFlags.resolve({})).not.toContain("allied");
});

const initial = AlliedCursor.initial(ALLIED_CONTRACT);
const complete = AlliedCursor.checkpoint(
  {
    source: "allied",
    version: 1,
    phase: "complete",
    scope: initial.scope,
    requests: 577,
    bytes: 80_000_000,
  },
  ALLIED_CONTRACT,
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
  "Allied staged inventory requires explicit complete traversal: accepted=$accepted, cursor=$cursor",
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
      await repository.initialize("allied-validation", async () => ["allied"]);
      const pathname = await snapshotStore.put({
        runId: "allied-validation",
        source: "allied",
        chunk: {
          vehicles: Array.from({ length: 2_000 }, (_, index) => ({
            ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
            source: "allied",
          })),
          observedVins: [],
        },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = 2000, next_cursor = ?, snapshot_chunks = ? where source = 'allied'",
        args: [cursor, JSON.stringify([pathname])],
      });
      const result = await validateDurableSourceRuns({
        runId: "allied-validation",
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Validation was skipped");
      expect(result.acceptedSources).toEqual(accepted ? ["allied"] : []);
      expect(result.rejectedSources).toEqual(
        accepted
          ? []
          : [
              {
                source: "allied",
                errors: ["allied did not provide terminal cursor evidence"],
              },
            ],
      );
    } finally {
      client.close();
    }
  },
);
