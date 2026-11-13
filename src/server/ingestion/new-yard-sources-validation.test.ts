import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA, makeVehicle } from "./durable-ingestion-test-fixtures";
import { serializeDurableSourceCursor } from "./durable-source";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { BrandywineCursor } from "./brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
} from "./brandywine-test-fixtures";

const schema = `${TEST_SCHEMA}
  create table vehicle (
    vin text primary key, source text not null, year integer not null,
    make text not null, model text not null, color text, stock_number text,
    image_url text, available_date text, location_code text not null,
    location_name text not null, location_city text not null, state text not null,
    state_abbr text not null, lat real not null, lng real not null,
    section text, row text, space text, details_url text, parts_url text,
    prices_url text, engine text, trim text, transmission text,
    first_seen_at integer not null, last_seen_at integer not null,
    missing_since_at integer, missing_run_count integer
  );
`;

const completeBrandywine = BrandywineCursor.checkpoint({
  ...BrandywineCursor.initial(null),
  phase: "complete",
  startedAt: 0,
  opening: brandywineSavedControls("opening"),
  details: brandywineSavedDetails(),
  closing: brandywineSavedControls("closing"),
});

const sources = [
  {
    source: "brandywine",
    minimum: 1_500,
    initial: BrandywineCursor.initial(null),
    complete: completeBrandywine,
  },
] as const;

test.each([...sources])(
  "$source remains disabled without explicit rollout",
  ({ source }) => {
    expect(IngestionSourceFlags.resolve({})).not.toContain(source);
  },
);

for (const { source, minimum, initial, complete } of sources) {
  test.each([
    { cursor: null, accepted: false },
    { cursor: "{}", accepted: false },
    { cursor: serializeDurableSourceCursor(initial), accepted: false },
    { cursor: serializeDurableSourceCursor(complete), accepted: true },
  ])(
    `${source} requires explicit complete traversal: accepted=$accepted, case %#`,
    async ({ cursor, accepted }) => {
      const client = createClient({ url: ":memory:" });
      try {
        await client.executeMultiple(schema);
        const database = drizzle(client);
        const snapshotStore = IngestionSnapshotStore.memory();
        const repository = createDurableIngestionRepository(
          database,
          client,
          snapshotStore,
        );
        await repository.initialize("source-validation", async () => [source]);
        const pathname = await snapshotStore.put({
          runId: "source-validation",
          source,
          chunk: {
            vehicles: Array.from({ length: minimum }, (_, index) => ({
              ...makeVehicle(`1HGCM82633A${String(index).padStart(6, "0")}`),
              source,
            })),
            observedVins: [],
          },
        });
        await client.execute({
          sql: "update ingestion_source_run set status = 'success', vehicles_processed = ?, next_cursor = ?, snapshot_chunks = ? where source = ?",
          args: [minimum, cursor, JSON.stringify([pathname]), source],
        });
        const result = await validateDurableSourceRuns({
          runId: "source-validation",
          database,
          batchClient: client,
          snapshotStore,
        });
        expect(result.status).toBe("ready");
        if (result.status !== "ready")
          throw new Error("Validation was skipped");
        expect(result.acceptedSources).toEqual(accepted ? [source] : []);
        expect(result.rejectedSources).toEqual(
          accepted
            ? []
            : [
                {
                  source,
                  errors: [
                    `${source} did not provide terminal cursor evidence`,
                  ],
                },
              ],
        );
      } finally {
        client.close();
      }
    },
  );
}
