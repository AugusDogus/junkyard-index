import { expect, test } from "bun:test";

/**
 * Real reconciliation of a Sonoma whose cached decode is GMC, while every
 * Algolia request fails and search publication is skipped. `marker` is the
 * Turso schema version; `existing` seeds the row a schema-12 backfill wrote.
 */
function reconcileWhileAlgoliaBlocked(params: {
  marker: number | null;
  existing: boolean;
}) {
  const script = String.raw`
globalThis.fetch = async () => {
  throw new Error("Live network is forbidden in VIN regression tests");
};
import { mock, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  ingestionRun,
  ingestionSourceRun,
  searchIndexSchema,
  vehicle,
  vinDecodeCache,
} from "./schema";
import { RECONCILIATION_TEST_SCHEMA } from "./src/server/ingestion/durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./src/server/ingestion/ingestion-snapshot-store";
import { makeVehicle } from "./src/server/ingestion/durable-ingestion-test-fixtures";
import { VinDecode } from "./src/server/ingestion/vin-decode";

const client = createClient({ url: ":memory:" });
await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
const database = drizzle(client);
const store = IngestionSnapshotStore.memory();
const raw = {
  ...makeVehicle("1GTCS1448S8508120"),
  source: "row52" as const,
  year: 1995,
  make: "Chevrolet",
  model: "SONOMA",
};
const id = VinDecode.identity(raw.vin, raw.year);
if (!id) throw new Error("Invalid Sonoma VIN");
await database.insert(vinDecodeCache).values({
  pattern: id.key,
  data: { make: "GMC", model: "Sonoma", year: 1995, trim: null },
  updatedAt: new Date(),
});
const marker = ${JSON.stringify(params.marker)};
if (marker !== null)
  await database
    .insert(searchIndexSchema)
    .values({ indexName: "vehicles", version: marker, updatedAt: new Date() });
if (${JSON.stringify(params.existing)})
  await database.insert(vehicle).values({
    ...raw,
    make: "GMC",
    model: "Sonoma",
    sourceMake: "Chevrolet",
    sourceModel: "SONOMA",
    firstSeenAt: new Date(500),
    lastSeenAt: new Date(500),
  });
const now = new Date(1000);
await database.insert(ingestionRun).values({
  id: "blocked-run",
  source: "row52",
  status: "running",
  stage: "reconcile_upsert",
  activeSlot: 1,
  commitStartedAt: now,
  acceptedSources: JSON.stringify(["row52"]),
  startedAt: now,
  lastProgressAt: now,
});
const path = await store.put({
  runId: "blocked-run",
  source: "row52",
  chunk: { vehicles: [raw], observedVins: [] },
});
await database.insert(ingestionSourceRun).values({
  id: "blocked-run:row52",
  runId: "blocked-run",
  source: "row52",
  status: "success",
  acceptanceStatus: "accepted",
  uniqueVehicles: 1,
  startedAt: now,
  snapshotChunks: JSON.stringify([path]),
});
let algoliaRequests = 0;
const blocked = new Proxy(
  {},
  {
    get: () => async () => {
      algoliaRequests++;
      throw new Error("Algolia blocked this application");
    },
  },
);
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
mock.module("./src/env.js", () => ({
  env: { BETTERSTACK_PROVIDERS: "{}", BLOB_READ_WRITE_TOKEN: "fixture" },
}));
mock.module("./src/lib/db", () => ({ db: database, dbClient: client }));
mock.module("./src/lib/algolia", () => ({
  getAlgoliaAdminClient: () => blocked,
  ALGOLIA_INDEX_NAME: "vehicles",
}));
mock.module("./src/server/ingestion/search-publication-flag", () => ({
  SearchPublicationFlag: {
    mode: async () => "skipped",
    publication: async () => "skipped",
  },
}));
mock.module("./src/server/ingestion/ingestion-snapshot-store", () => ({
  IngestionSnapshotStore: { vercelBlob: () => store },
}));
const { reconcileDurableIngestion } =
  await import("./src/server/ingestion/durable-ingestion");
await reconcileDurableIngestion("blocked-run");
const [stored] = await database.select().from(vehicle);
expect({ algoliaRequests, stored }).toMatchObject({
  algoliaRequests: 0,
  stored: {
    make: "GMC",
    model: "Sonoma",
    sourceMake: "Chevrolet",
    sourceModel: "SONOMA",
  },
});
client.close();
`;
  return Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
}

test.each([
  { scenario: "schema 12 recorded in Turso", marker: 12, existing: false },
  {
    scenario: "readiness not recorded, row already backfilled",
    marker: null,
    existing: true,
  },
  {
    scenario: "older marker, row already backfilled",
    marker: 11,
    existing: true,
  },
])(
  "reconciliation keeps VIN identities without Algolia while search is skipped ($scenario)",
  ({ marker, existing }) => {
    const result = reconcileWhileAlgoliaBlocked({ marker, existing });
    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
  },
);

test("the migration records schema readiness in Turso before the Algolia marker", () => {
  const script = String.raw`
globalThis.fetch = async () => {
  throw new Error("Live network is forbidden in VIN regression tests");
};
import { mock, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { RECONCILIATION_TEST_SCHEMA } from "./src/server/ingestion/durable-reconciliation-test-fixtures";

const client = createClient({ url: ":memory:" });
await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
const database = drizzle(client);
let version = 11;
mock.module("server-only", () => ({}));
mock.module("./src/lib/db", () => ({ db: database, dbClient: client }));
mock.module("./src/lib/algolia", () => ({
  ALGOLIA_INDEX_NAME: "vehicles",
  getAlgoliaAdminClient: () => ({
    getSettings: async () => ({ userData: { searchSchemaVersion: version } }),
    setSettings: async () => {
      throw new Error("Algolia rejected the settings write");
    },
  }),
}));
mock.module("./src/server/inventory-snapshot", () => ({
  InventorySnapshot: { project: async () => {}, modelUrls: async () => [] },
}));
const { finalizeSearchIndexMigration, initializeSearchIndexMigration } =
  await import("./src/server/ingestion/search-index-migration");
const { SearchIndexSchemaMarker } =
  await import("./src/server/ingestion/search-index-schema-marker");
await expect(
  finalizeSearchIndexMigration({
    cursor: null,
    batchesProcessed: 0,
    recordsProcessed: 0,
    validationVins: [],
  }),
).rejects.toThrow("Algolia rejected the settings write");
expect(await SearchIndexSchemaMarker.version(database, "vehicles")).toBe(12);
expect(await SearchIndexSchemaMarker.version(database, "preview_vehicles")).toBe(0);
await client.execute("delete from search_index_schema");
version = 12;
expect((await initializeSearchIndexMigration()).status).toBe("ready");
expect(await SearchIndexSchemaMarker.version(database, "vehicles")).toBe(12);
await SearchIndexSchemaMarker.record(database, "vehicles", 11);
expect(await SearchIndexSchemaMarker.version(database, "vehicles")).toBe(12);
client.close();
`;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
