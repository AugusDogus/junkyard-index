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
import { vinplusCensus } from "./vinplus-test-fixtures";
import { VINPLUS_TENANTS } from "./vinplus-configuration";
import { SourceValidationPolicy } from "./source-validation";
import { VinplusCursor } from "./vinplus-cursor";

test("VinPlus is registered for qualification and requires explicit rollout", () => {
  expect(INGESTION_SOURCES).toContain("vinplus");
  expect(SourceValidationPolicy.minimumUniqueInventory.vinplus).toBe(
    VINPLUS_TENANTS.reduce((sum, tenant) => sum + tenant.minimum, 0),
  );
  expect(IngestionSourceFlags.resolve({})).not.toContain("vinplus");
});

const initial = VinplusCursor.initial();
test.each([
  { name: "missing", cursor: null, accepted: false },
  {
    name: "paused",
    cursor: serializeDurableSourceCursor(initial),
    accepted: false,
  },
  {
    name: "forged",
    cursor: JSON.stringify({ ...initial, phase: "complete" }),
    accepted: false,
  },
  {
    name: "complete",
    cursor: "complete",
    accepted: true,
  },
])(
  "VinPlus staged inventory requires explicit complete traversal: case=$name",
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
      await repository.initialize("vinplus-validation", async () => [
        "vinplus",
      ]);
      const pathname = await snapshotStore.put({
        runId: "vinplus-validation",
        source: "vinplus",
        chunk: {
          vehicles: Array.from({ length: 5_650 }, (_, index) => ({
            ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
            source: "vinplus",
          })),
          observedVins: [],
        },
      });
      const wire =
        cursor === "complete"
          ? serializeDurableSourceCursor(
              VinplusCursor.checkpoint({
                ...initial,
                phase: "complete",
                yards: vinplusCensus(),
              }),
            )
          : cursor;
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = 5650, next_cursor = ?, snapshot_chunks = ? where source = 'vinplus'",
        args: [wire, JSON.stringify([pathname])],
      });
      const result = await validateDurableSourceRuns({
        runId: "vinplus-validation",
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Validation was skipped");
      expect(result.acceptedSources).toEqual(accepted ? ["vinplus"] : []);
      expect(result.rejectedSources).toEqual(
        accepted
          ? []
          : [
              {
                source: "vinplus",
                errors: ["vinplus did not provide terminal cursor evidence"],
              },
            ],
      );
    } finally {
      client.close();
    }
  },
);
