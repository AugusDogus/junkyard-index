import { expect, test } from "bun:test";

test("saved makes and alert expressions match before, during and after the real migration", () => {
  const script = String.raw`
globalThis.fetch = async () => {
  throw new Error("Live network is forbidden in VIN regression tests");
};
import { mock, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle, vinDecodeCache } from "./schema";
import { RECONCILIATION_TEST_SCHEMA } from "./src/server/ingestion/durable-reconciliation-test-fixtures";
import { makeVehicle } from "./src/server/ingestion/durable-ingestion-test-fixtures";
import { VinDecode } from "./src/server/ingestion/vin-decode";
import {
  toAlgoliaRecord,
  type AlgoliaVehicleRecord,
} from "./src/server/ingestion/types";
import { mapDbVehicleToAlgolia } from "./src/server/ingestion/algolia-projector-helpers";
import type { AlertSearchClient } from "./src/lib/alert-match-search";

const client = createClient({ url: ":memory:" });
await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
const database = drizzle(client);
const raw = {
  ...makeVehicle("1GTCS1448S8508120"),
  year: 1995,
  make: "Chevrolet",
  model: "SONOMA",
};
await database
  .insert(vehicle)
  .values({ ...raw, firstSeenAt: new Date(2000), lastSeenAt: new Date(2000) });
const id = VinDecode.identity(raw.vin, raw.year);
if (!id) throw new Error("Invalid Sonoma VIN");
await database
  .insert(vinDecodeCache)
  .values({
    pattern: id.key,
    data: { make: "GMC", model: "Sonoma", year: 1995, trim: null },
    updatedAt: new Date(),
  });
let indexed: AlgoliaVehicleRecord = toAlgoliaRecord(
  raw,
  new Date(2000),
  null,
  0,
  null,
);
indexed.makeAliases = [];
indexed.searchTokens = indexed.searchTokens.filter(
  (token) => !token.startsWith("make="),
);
let version = 11;
const requestsSeen: unknown[] = [];
const searchForHits: AlertSearchClient["searchForHits"] = async ({
  requests,
}) => ({
  results: requests.map((request) => {
    requestsSeen.push({
      version,
      canonicalMake: indexed.make,
      filters: request.filters,
    });
    const clauses = [
      ...(request.filters ?? "").matchAll(
        /(makeAliases|make|searchTokens):"([^"]+)"/g,
      ),
    ];
    const matches = clauses.some(([, attribute, value]) =>
      attribute === "make"
        ? indexed.make === value
        : attribute === "makeAliases"
          ? indexed.makeAliases.includes(value ?? "")
          : indexed.searchTokens.includes(value ?? ""),
    );
    return {
      hits: matches ? [indexed] : [],
      nbHits: matches ? 1 : 0,
      nbPages: 1,
      page: 0,
      hitsPerPage: 100,
      processingTimeMS: 0,
      query: request.query,
      params: "",
    };
  }),
});
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
mock.module("./src/lib/db", () => ({ db: database, dbClient: client }));
mock.module("./src/lib/algolia", () => ({
  ALGOLIA_INDEX_NAME: "vehicles",
  getAlgoliaAdminClient: () => ({
    getSettings: async () => ({ userData: { searchSchemaVersion: version } }),
  }),
}));
mock.module("./src/server/algolia-search-client", () => ({
  algoliaSearchClient: { searchForHits },
}));
mock.module("./src/server/ingestion/sync-algolia", () => ({
  configureAlgoliaIndex: async () => {},
  syncToAlgolia: async (records: AlgoliaVehicleRecord[]) => {
    const record = records[0];
    if (record) indexed = record;
  },
}));
mock.module("./src/server/ingestion/vehicle-search-projection", () => ({
  projectSearchVehicles: async (
    _db: unknown,
    rows: (typeof vehicle.$inferSelect)[],
  ) => rows.map(mapDbVehicleToAlgolia),
}));
const { migrateSearchIndexBatch } =
  await import("./src/server/ingestion/search-index-migration");
const { getAlertMatchStatsBatch } =
  await import("./src/server/alerts/algolia-alert-search");
const { getSearchIndexCapabilities } =
  await import("./src/server/ingestion/search-index-readiness");
async function matches() {
  for (const criteria of [
    { makes: ["Chevrolet"] },
    { expression: "make:Chevrolet SONOMA" },
  ]) {
    const [result] = await getAlertMatchStatsBatch(
      [{ query: "SONOMA", filters: criteria, lastCheckedAt: new Date(1000) }],
      { checkedThrough: new Date(2000), latestFirstSeenAt: new Date(2000) },
    );
    if (result?.status !== "fulfilled")
      throw new Error("Unexpected alert failure");
    expect(result.value.matchedCount).toBe(1);
  }
  return 1;
}
expect(await matches()).toBe(1);
await migrateSearchIndexBatch({
  cursor: null,
  batchesProcessed: 0,
  recordsProcessed: 0,
  validationVins: [],
});
expect(indexed.make).toBe("GMC");
expect(indexed.makeAliases).toContain("Chevrolet");
expect((await getSearchIndexCapabilities()).makeAliasesReady).toBe(false);
expect(await matches()).toBe(1);
version = 12;
expect(await matches()).toBe(1);
console.log(
  JSON.stringify(
    {
      scenario: "schema-11 to schema-12 publication rollout",
      matchCounts: [1, 1, 1],
      requests: requestsSeen,
    },
    null,
    2,
  ),
);
client.close();
`;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("readiness fallback preserves existing normalization through real reconciliation", () => {
  const script = String.raw`
globalThis.fetch = async () => {
  throw new Error("Live network is forbidden in VIN regression tests");
};
import { mock, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { ingestionRun, ingestionSourceRun, vehicle } from "./schema";
import { RECONCILIATION_TEST_SCHEMA } from "./src/server/ingestion/durable-reconciliation-test-fixtures";
import { IngestionSnapshotStore } from "./src/server/ingestion/ingestion-snapshot-store";
import { makeVehicle } from "./src/server/ingestion/durable-ingestion-test-fixtures";
import { normalizeCanonicalVehicle } from "./src/server/ingestion/normalization";

const client = createClient({ url: ":memory:" });
await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
const database = drizzle(client);
const store = IngestionSnapshotStore.memory();
const raw = {
  ...makeVehicle("UNDECODABLE"),
  source: "row52" as const,
  make: "Nissian",
  model: "NISSIAN SENTRA",
  engine: "1.589545208L",
  locationName: "KIKER'S U PULL IT",
};
const now = new Date(1000);
await database
  .insert(ingestionRun)
  .values({
    id: "readiness-repro",
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
  runId: "readiness-repro",
  source: "row52",
  chunk: { vehicles: [raw], observedVins: [] },
});
await database
  .insert(ingestionSourceRun)
  .values({
    id: "readiness-repro:row52",
    runId: "readiness-repro",
    source: "row52",
    status: "success",
    acceptanceStatus: "accepted",
    uniqueVehicles: 1,
    startedAt: now,
    snapshotChunks: JSON.stringify([path]),
  });
mock.module("./src/env.js", () => ({
  env: { BETTERSTACK_PROVIDERS: "{}", BLOB_READ_WRITE_TOKEN: "fixture" },
}));
mock.module("./src/lib/db", () => ({ db: database, dbClient: client }));
mock.module("./src/lib/algolia", () => ({
  getAlgoliaAdminClient: () => ({}),
  ALGOLIA_INDEX_NAME: "vehicles",
}));
mock.module("./src/server/ingestion/search-index-readiness", () => ({
  getSearchIndexCapabilities: async () => ({ makeAliasesReady: false }),
}));
mock.module("./src/server/ingestion/search-publication-flag", () => ({
  SearchPublicationFlag: {
    mode: async () => "inline",
    publication: async () => "inline",
  },
}));
mock.module("./src/server/ingestion/ingestion-snapshot-store", () => ({
  IngestionSnapshotStore: { vercelBlob: () => store },
}));
const { reconcileDurableIngestion } =
  await import("./src/server/ingestion/durable-ingestion");
await reconcileDurableIngestion("readiness-repro");
const [stored] = await database.select().from(vehicle);
expect(stored).toMatchObject({
  make: "Nissan",
  model: "SENTRA",
  engine: "1.6L",
  locationName: "Kiker's U Pull It",
});
console.log(
  JSON.stringify(
    { readiness: false, expected: normalizeCanonicalVehicle(raw), stored },
    null,
    2,
  ),
);
client.close();
`;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});
