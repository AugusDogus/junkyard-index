import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle, vinDecodeCache } from "~/schema";
import { RECONCILIATION_TEST_SCHEMA } from "./durable-reconciliation-test-fixtures";
import { makeVehicle } from "./durable-ingestion-test-fixtures";
import { runVinCachePass } from "./vin-cache-pass";
import { warmVinCacheBatch } from "./vin-cache-warmer";
import { VinDecode } from "./vin-decode";
import type { VpicClient } from "./vpic-client";

// The daily search-index migration is one workflow run: the VIN cache pass,
// then the migration batches. Each step adds three events and Vercel fails a
// run past 25,000 events, so both passes must cover the whole inventory
// (494,411 vehicles on 2026-11-25) in about a thousand rows per step.
const ROWS_PER_STEP = 1000;

function vehicles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    ...makeVehicle(`1FT${String(i).padStart(5, "0")}06K123456`),
    year: 2006,
    make: "FORD",
    model: "TFORD150",
    firstSeenAt: new Date(1000),
    lastSeenAt: new Date(1000),
  }));
}

async function setup(count: number) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
  const database = drizzle(client);
  const rows = vehicles(count);
  for (let i = 0; i < rows.length; i += 500) {
    await database.insert(vehicle).values(rows.slice(i, i + 500));
  }
  return { client, database, rows };
}

function recordingClient() {
  const batches: string[][] = [];
  const client: VpicClient = {
    decode: async (requests) => {
      batches.push(requests.map((request) => request.key));
      return {
        status: "complete",
        decodes: new Map(
          requests.map((request) => [
            request.key,
            { make: "Ford", model: "F-150", year: 2006, trim: null },
          ]),
        ),
      };
    },
  };
  return { client, batches };
}

test("a warm cache pass scans a thousand vehicles per step", async () => {
  const { client, database, rows } = await setup(2500);
  try {
    const now = new Date();
    const cached = rows.flatMap((row) => {
      const id = VinDecode.identity(row.vin, row.year);
      return id ? [{ pattern: id.key, data: null, updatedAt: now }] : [];
    });
    expect(cached).toHaveLength(2500);
    // Failed patterns still cooling down are not requested again.
    const retryAfter = new Date(now.getTime() + 60_000);
    for (let i = 0; i < cached.length; i += 500) {
      await database
        .insert(vinDecodeCache)
        .values(
          cached.slice(i, i + 500).map((entry) => ({ ...entry, retryAfter })),
        );
    }
    const decoder = recordingClient();
    let steps = 0;
    const result = await runVinCachePass(async (state) => {
      steps++;
      return warmVinCacheBatch(database, state, decoder.client);
    });
    expect(result).toMatchObject({ status: "complete", accepted: 0 });
    expect(steps).toBe(Math.ceil(2500 / ROWS_PER_STEP));
    expect(decoder.batches).toEqual([]);
  } finally {
    client.close();
  }
});

test("a cold cache pass requests at most 100 patterns per step and skips no vehicle", async () => {
  const { client, database, rows } = await setup(1250);
  try {
    const decoder = recordingClient();
    let steps = 0;
    const result = await runVinCachePass(async (state) => {
      steps++;
      return warmVinCacheBatch(database, state, decoder.client);
    });
    expect(result).toMatchObject({ status: "complete", accepted: 1250 });
    expect(decoder.batches.every((batch) => batch.length <= 100)).toBe(true);
    const requested = decoder.batches.flat();
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested).toHaveLength(1250);
    expect(steps).toBe(13);
    expect(await database.$count(vinDecodeCache)).toBe(rows.length);
  } finally {
    client.close();
  }
});

test("each migration step publishes a thousand vehicles", () => {
  // Module mocks leak across the suite, so this runs in its own process.
  const script = String.raw`
globalThis.fetch = async () => {
  throw new Error("Live network is forbidden in migration step tests");
};
import { mock } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { vehicle } from "./schema";
import { RECONCILIATION_TEST_SCHEMA } from "./src/server/ingestion/durable-reconciliation-test-fixtures";
import { makeVehicle } from "./src/server/ingestion/durable-ingestion-test-fixtures";
import { mapDbVehicleToAlgolia } from "./src/server/ingestion/algolia-projector-helpers";

const client = createClient({ url: ":memory:" });
await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
const database = drizzle(client);
const rows = Array.from({ length: 2500 }, (_, i) => ({
  ...makeVehicle("1FT" + String(i).padStart(5, "0") + "06K123456"),
  year: 2006,
  firstSeenAt: new Date(1000),
  lastSeenAt: new Date(1000),
}));
for (let i = 0; i < rows.length; i += 500)
  await database.insert(vehicle).values(rows.slice(i, i + 500));
const written = [];
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ unstable_cache: (fn) => fn }));
mock.module("./src/lib/db", () => ({ db: database, dbClient: client }));
mock.module("./src/lib/algolia", () => ({
  ALGOLIA_INDEX_NAME: "vehicles",
  getAlgoliaAdminClient: () => ({}),
}));
mock.module("./src/server/ingestion/sync-algolia", () => ({
  configureAlgoliaIndex: async () => {},
  syncToAlgolia: async (records) => {
    written.push(records.length);
  },
}));
mock.module("./src/server/ingestion/vehicle-search-projection", () => ({
  projectSearchVehicles: async (_db, rows) => rows.map(mapDbVehicleToAlgolia),
}));
const { migrateSearchIndexBatch } =
  await import("./src/server/ingestion/search-index-migration");
let state = { cursor: null, batchesProcessed: 0, recordsProcessed: 0, validationVins: [] };
while (true) {
  const batch = await migrateSearchIndexBatch(state);
  state = batch.state;
  if (batch.done) break;
}
console.log(JSON.stringify({ written, state }));
client.close();
`;
  const result = Bun.spawnSync([process.execPath, "--eval", script], {
    cwd: process.cwd(),
    env: { ...process.env, SKIP_ENV_VALIDATION: "1" },
  });
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
  const output = JSON.parse(result.stdout.toString().trim());
  expect(output.written).toEqual([1000, 1000, 500]);
  expect(output.state).toMatchObject({
    batchesProcessed: 3,
    recordsProcessed: 2500,
  });
});
