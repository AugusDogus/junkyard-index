import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle } from "~/schema";
import { CARS4PARTS_CONTRACT } from "./cars4parts-configuration";
import { Cars4PartsCursor } from "./cars4parts-cursor";
import { createDurableIngestionRepository } from "./durable-ingestion-repository";
import { TEST_SCHEMA, makeVehicle } from "./durable-ingestion-test-fixtures";
import { serializeDurableSourceCursor } from "./durable-source";
import { validateDurableSourceRuns } from "./durable-source-validation";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { MeeksCursor } from "./meeks-cursor";
import { validateSourceSnapshot } from "./source-validation";
import { BrandywineCursor } from "./brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
} from "./brandywine-test-fixtures";
import { CaltonCursor } from "./calton-cursor";
import { CALTON_CONTRACT } from "./calton-configuration";
import { BeaversCursor } from "./beavers-cursor";
import { IndianriverCursor } from "./indianriver-cursor";
import { DutchersCursor } from "./dutchers-cursor";
import { ChasencarsCursor, chasencarsAdvance } from "./chasencars-cursor";
import { chasencarsFixture } from "./chasencars-test-fixtures";

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

const initialCars = Cars4PartsCursor.initial(CARS4PARTS_CONTRACT);
const completeCars = Cars4PartsCursor.checkpoint(
  {
    source: "cars4parts",
    version: 1,
    phase: "complete",
    scope: initialCars.scope,
    requests: 87,
    bytes: 20_000_000,
  },
  CARS4PARTS_CONTRACT,
);
if (!completeCars.ok) throw new Error(completeCars.error.message);

const completeBrandywine = BrandywineCursor.checkpoint({
  ...BrandywineCursor.initial(null),
  phase: "complete",
  startedAt: 0,
  opening: brandywineSavedControls("opening"),
  details: brandywineSavedDetails(),
  closing: brandywineSavedControls("closing"),
});

const initialCalton = CaltonCursor.initial(CALTON_CONTRACT);
if (!initialCalton.ok) throw new Error(initialCalton.error.message);
const completeCalton = CaltonCursor.checkpoint(
  {
    source: "calton",
    version: 1,
    phase: "complete",
    scope: initialCalton.value.scope,
    requests: 679,
    bytes: 142_370_116,
  },
  CALTON_CONTRACT,
);
if (!completeCalton.ok) throw new Error(completeCalton.error.message);

let chasencars = ChasencarsCursor.initial(null);
for (const name of [
  "owner",
  "yard",
  "inventory",
  "inventory",
  "yard",
  "owner",
] as const)
  chasencars = chasencarsAdvance(chasencars, chasencarsFixture(name));
const completeChasencars = ChasencarsCursor.complete(chasencars);

const sources = [
  {
    source: "chasencars",
    minimum: 550,
    initial: ChasencarsCursor.initial(null),
    complete: completeChasencars,
  },
  {
    source: "dutchers",
    minimum: 500,
    initial: DutchersCursor.initial(),
    // Synthetic terminal marker tests shared gating, not native qualification.
    complete: DutchersCursor.checkpoint({
      ...DutchersCursor.initial(),
      phase: "complete",
    }),
  },
  {
    source: "indianriver",
    minimum: 900,
    initial: IndianriverCursor.initial(),
    complete: IndianriverCursor.checkpoint({
      source: "indianriver",
      version: 1,
      scope: IndianriverCursor.initial().scope,
      phase: "complete",
    }),
  },
  {
    source: "beavers",
    minimum: 240,
    initial: BeaversCursor.initial,
    complete: { source: "beavers", version: 1, phase: "complete" },
  },
  {
    source: "calton",
    minimum: CALTON_CONTRACT.minimumUniqueInventory,
    initial: initialCalton.value,
    complete: completeCalton.value,
  },
  {
    source: "cars4parts",
    minimum: 56,
    initial: initialCars,
    complete: completeCars.value,
  },
  {
    source: "meeks",
    minimum: 1_200,
    initial: MeeksCursor.initial,
    complete: { source: "meeks", phase: "complete" },
  },
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

test.each([
  { previousArmington: 5, retiringArmington: 0, accepted: false },
  { previousArmington: 4, retiringArmington: 0, accepted: true },
  { previousArmington: 4, retiringArmington: 6, accepted: true },
])(
  "Cars4Parts enforces per-yard drift before reconciliation: prior Armington=$previousArmington",
  async ({ previousArmington, retiringArmington, accepted }) => {
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
      await repository.initialize("yard-drift", async () => ["cars4parts"]);
      const donors = (code: string, count: number) =>
        Array.from({ length: count }, (_, index) => ({
          ...makeVehicle(`${code}-${index}`),
          source: "cars4parts" as const,
          locationCode: code,
        }));
      const prior = [
        ...donors("heyworth", 69),
        ...donors("armington", previousArmington),
      ];
      expect(
        validateSourceSnapshot({
          source: "cars4parts",
          terminal: true,
          uniqueVehicles: 71,
          vehiclesProcessed: 75,
          duplicateVehicles: 0,
          rejectedVehicles: 4,
          errors: [],
          previousAcceptedCount: prior.length,
        }),
      ).toEqual({ status: "accepted", errors: [] });
      await database.insert(vehicle).values(
        prior.map((donor) => ({
          ...donor,
          firstSeenAt: new Date(0),
          lastSeenAt: new Date(0),
        })),
      );
      if (retiringArmington > 0)
        await database.insert(vehicle).values(
          donors("armington", retiringArmington).map((donor) => ({
            ...donor,
            vin: `retiring-${donor.vin}`,
            firstSeenAt: new Date(0),
            lastSeenAt: new Date(0),
            missingSinceAt: new Date(1),
          })),
        );
      const pathname = await snapshotStore.put({
        runId: "yard-drift",
        source: "cars4parts",
        chunk: {
          vehicles: [...donors("heyworth", 69), ...donors("armington", 2)],
          observedVins: [],
        },
      });
      await client.execute({
        sql: "update ingestion_source_run set status = 'success', vehicles_processed = 71, next_cursor = ?, snapshot_chunks = ? where source = 'cars4parts'",
        args: [
          serializeDurableSourceCursor(completeCars.value),
          JSON.stringify([pathname]),
        ],
      });
      const result = await validateDurableSourceRuns({
        runId: "yard-drift",
        database,
        batchClient: client,
        snapshotStore,
      });
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Validation was skipped");
      expect(result.acceptedSources).toEqual(accepted ? ["cars4parts"] : []);
      expect(result.rejectedSources).toEqual(
        accepted
          ? []
          : [
              {
                source: "cars4parts",
                errors: [
                  "cars4parts armington inventory fell from 5 to 2, below the 50% yard drift limit; previously published inventory is preserved. Inspect the complete yard catalog before retrying.",
                ],
              },
            ],
      );
      expect(await database.select().from(vehicle)).toHaveLength(
        prior.length + retiringArmington,
      );
    } finally {
      client.close();
    }
  },
);
