import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { VANDERHAAGS_YARDS } from "./vanderhaags-yards";
import { VanderHaagsCensus } from "./vanderhaags-census";
import { VanderHaagsCursorSchema } from "./vanderhaags-cursor";
import {
  createTestClient,
  TEST_SCHEMA,
  makeVehicle,
} from "./durable-ingestion-test-fixtures";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { serializeDurableSourceCursor } from "./durable-source";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";

const terminal = VanderHaagsCursorSchema.parse({
  source: "vanderhaags",
  phase: "complete",
  census: VanderHaagsCensus.checkpoint({
    contract: "detail-census-v2",
    scope: "a".repeat(64),
    startedAt: 0,
    reverification: { day: 0, paths: [] },
    entries: [],
  }),
});

test.each([
  { sioux: 105, previous: 210, legacy: false, accepted: true, message: "" },
  {
    sioux: 105,
    previous: 211,
    legacy: false,
    accepted: false,
    message: "50% yard drift limit",
  },
  {
    sioux: 94,
    previous: 0,
    legacy: false,
    accepted: false,
    message: "below its qualified yard floor 95",
  },
  {
    sioux: 105,
    previous: 0,
    legacy: true,
    accepted: false,
    message: "terminal cursor evidence",
  },
])(
  "Vander Haags validates physical yards and terminal carry evidence: %#",
  async ({ sioux, previous, legacy, accepted, message }) => {
    const { client } = createTestClient();
    try {
      await client.executeMultiple(
        TEST_SCHEMA +
          "create table vehicle (vin text primary key, source text, location_code text, missing_since_at integer);",
      );
      const database = drizzle(client);
      const snapshotStore = IngestionSnapshotStore.memory();
      const repository = createDurableIngestionRepository(
        database,
        client,
        snapshotStore,
      );
      await repository.initialize("vanderhaags-validation", async () => [
        "vanderhaags",
      ]);
      if (previous)
        await client.batch(
          Array.from({ length: previous }, (_, i) => ({
            sql: "insert into vehicle values (?, 'vanderhaags', 'sioux-falls', null)",
            args: ["prior-" + i],
          })),
          "write",
        );
      const donors = VANDERHAAGS_YARDS.flatMap(({ yard, minimumInventory }) =>
        Array.from(
          {
            length: yard.code === "sioux-falls" ? sioux : minimumInventory + 10,
          },
          (_, index) => ({
            ...makeVehicle(yard.code + "-" + index),
            source: "vanderhaags" as const,
            locationCode: yard.code,
          }),
        ),
      );
      // Even the short yard case exceeds the aggregate 703-donor floor.
      expect(donors.length).toBeGreaterThan(703);
      const pathname = await snapshotStore.put({
        runId: "vanderhaags-validation",
        source: "vanderhaags",
        chunk: { vehicles: donors, observedVins: [] },
      });
      const cursor = legacy
        ? ({ source: "vanderhaags", phase: "complete" } as const)
        : terminal;
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = ?, next_cursor = ?, snapshot_chunks = ? where source = 'vanderhaags'",
        args: [
          donors.length,
          serializeDurableSourceCursor(cursor),
          JSON.stringify([pathname]),
        ],
      });
      const result = await validateDurableSourceRuns({
        runId: "vanderhaags-validation",
        database,
        batchClient: client,
        snapshotStore,
      });
      if (result.status === "stopped")
        throw new Error("Source validation did not finish");
      expect(result.acceptedSources).toEqual(accepted ? ["vanderhaags"] : []);
      if (!accepted)
        expect(
          result.rejectedSources.flatMap((s) => s.errors).join(" "),
        ).toContain(message);
      expect(
        await client.execute("select count(*) as count from vehicle"),
      ).toMatchObject({ rows: [{ count: previous }] });
    } finally {
      client.close();
    }
  },
);
