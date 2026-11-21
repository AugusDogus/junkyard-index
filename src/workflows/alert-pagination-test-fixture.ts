import { expect, mock } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  ingestionRun,
  savedSearch,
  vehicle,
  vinDecodeCache,
} from "../../schema";
import { RECONCILIATION_TEST_SCHEMA } from "../../src/server/ingestion/durable-reconciliation-test-fixtures";
import { makeVehicle } from "../../src/server/ingestion/durable-ingestion-test-fixtures";
import { VinDecode } from "../../src/server/ingestion/vin-decode";
import type { AlgoliaVehicleRecord } from "../../src/server/ingestion/types";
import { IngestionDay } from "../../src/server/ingestion/ingestion-day";
import type { SearchIndexMigrationState } from "../../src/server/ingestion/search-index-migration";
import type { AlertSearchClient } from "../../src/lib/alert-match-search";
import { mapDbVehicleToAlgolia } from "../../src/server/ingestion/algolia-projector-helpers";
import { COMMON_ALGOLIA_INDEX_SETTINGS } from "../../src/server/ingestion/algolia-settings-plan";

function blockNetwork(): never {
  throw new Error("Live network forbidden in the pagination fixture");
}
globalThis.fetch = Object.assign(async () => blockNetwork(), {
  preconnect: blockNetwork,
});
const client = createClient({ url: ":memory:" });
await client.executeMultiple(RECONCILIATION_TEST_SCHEMA);
await client.executeMultiple(`
create table saved_search (
 id text primary key, user_id text not null, name text not null, query text not null, filters text not null,
 email_alerts_enabled integer not null default 0, discord_alerts_enabled integer not null default 0,
 search_match_version integer not null default 1, email_config_version integer not null default 1,
 discord_config_version integer not null default 1, email_start_sequence integer not null default 0,
 discord_start_sequence integer not null default 0, last_matched_publication_sequence integer not null default 0,
 last_checked_at integer, alert_quarantined_at integer, alert_quarantine_reason text, processing_lock integer,
 created_at integer not null default 0, updated_at integer not null default 0
);
create table search_alert_check (
 id text primary key, day text not null unique, status text not null, checked_through integer not null,
 search_cursor text, started_at integer not null, last_progress_at integer not null, completed_at integer
);
create table search_notification_intent (
 id text primary key, run_id text, alert_check_id text, publication_sequence integer not null,
 saved_search_id text not null, user_id text not null, channel text not null, search_match_version integer not null,
 channel_config_version integer not null, payload text not null, status text not null, attempts integer not null,
 created_at integer not null, unique (saved_search_id, publication_sequence, channel)
);
`);
const database = drizzle(client);
const activeVin = "1GTCS1448S8508120";
// Old enough that the day's check bound, which trails its creation by a
// minute, covers the vehicles.
const epoch = Math.floor(Date.now() / 1000) * 1000 - 10 * 60_000;
const day = IngestionDay.key(new Date());
const rows = Array.from({ length: 101 }, (_, i) => ({
  ...makeVehicle(
    i < 100 ? `1GTCS1448S8${String(i).padStart(6, "0")}` : activeVin,
  ),
  year: 1995,
  make: "Chevrolet",
  model: "SONOMA",
  firstSeenAt: new Date(epoch + 2000),
  lastSeenAt: new Date(epoch + 2000),
  missingSinceAt: i < 100 ? new Date(epoch + 3000) : null,
  missingRunCount: i < 100 ? 1 : 0,
}));
await database.insert(vehicle).values(rows);
const identity = VinDecode.identity(activeVin, 1995);
if (!identity) throw new Error("Invalid recorded Sonoma VIN");
await database.insert(vinDecodeCache).values({
  pattern: identity.key,
  data: { make: "GMC", model: "Sonoma", year: 1995, trim: null },
  updatedAt: new Date(),
});
const records = new Map(
  (await database.select().from(vehicle)).map((row) => {
    const record = mapDbVehicleToAlgolia(row);
    record.makeAliases = [];
    record.searchTokens = record.searchTokens.filter(
      (token) => !token.startsWith("make="),
    );
    return [row.vin, record];
  }),
);
await database.insert(savedSearch).values({
  id: "basic",
  userId: "fixture",
  name: "Chevrolet",
  query: "Chevrolet",
  filters: JSON.stringify({ makes: ["Chevrolet"] }),
  emailAlertsEnabled: true,
  lastCheckedAt: new Date(epoch + 1000),
});
// The released run that published the vehicles in the check's window.
await database.insert(ingestionRun).values({
  id: "published-run",
  source: "pyp",
  status: "completed",
  stage: "completed",
  activeSlot: null,
  commitStartedAt: new Date(epoch + 2000),
  publicationSequence: 1,
  startedAt: new Date(epoch),
  lastProgressAt: new Date(epoch + 2000),
  searchPublishedAt: new Date(epoch + 2000),
  releasedAt: new Date(epoch + 2000),
});
const pages: unknown[] = [];
let backfillState: SearchIndexMigrationState = {
  cursor: null,
  batchesProcessed: 0,
  recordsProcessed: 0,
  validationVins: [],
};
const interleaving = !process.argv.includes("--stable");
let interleave = interleaving;
let migration: Promise<unknown> | undefined;
let scanning = false;
let rewriteDuringScan = false;
let searchRequests = 0;
let sleeps = 0;
let scanLockAcquisitions = 0;
let announceMigrationAttempt: () => void = () => {};
const waitForMigrationAttempt = new Promise<void>((resolve) => {
  announceMigrationAttempt = resolve;
});
const owners = new Map<string, object>();
const waiters = new Set<() => void>();
mock.module("workflow", () => ({
  getWorkflowMetadata: () => ({ workflowRunId: "fixture" }),
  createHook: ({ token }: { token: string }) => {
    const hook = {
      getConflict: async () =>
        owners.get(token) !== hook ? { runId: "other-writer" } : null,
      [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
      [Symbol.dispose]: () => {
        if (owners.get(token) !== hook) return;
        owners.delete(token);
        for (const resolve of waiters) resolve();
        waiters.clear();
      },
    };
    if (!owners.has(token)) {
      owners.set(token, hook);
      if (token === "algolia-writes" && !migration) scanLockAcquisitions++;
    }
    return hook;
  },
  sleep: async () => {
    sleeps++;
    announceMigrationAttempt();
    await new Promise<void>((resolve) => {
      waiters.add(resolve);
    });
  },
}));
mock.module("workflow/api", () => ({
  start: async () => ({ runId: "unused" }),
  getRun: () => ({ status: Promise.resolve("completed") }),
}));
mock.module("../../src/server/alerts/durable-alert-delivery-runtime", () => ({
  hasDeliverableNotificationIntents: async () => false,
}));
mock.module("../../src/server/alerts/search-alerts-flag", () => ({
  SearchAlertsFlag: { mode: async () => "enabled" },
}));
mock.module("../../src/workflows/downstream-consumers", () => ({
  vehicleNotificationDeliveryWorkflow: async () => {},
}));
const searchForHits: AlertSearchClient["searchForHits"] = async ({
  requests,
}) => ({
  results: await Promise.all(
    requests.map(async (request) => {
      searchRequests++;
      expect(request.query).toBe("Chevrolet");
      const after = Number(
        request.filters?.match(/firstSeenAt > (\d+)/)?.[1] ?? 0,
      );
      // Replay an allowed attribute-ranking shift from configured make (position 0)
      // to source makeAliases (position 3). Earlier ranking criteria and arrival dates tie.
      const rank = (record: AlgoliaVehicleRecord) =>
        COMMON_ALGOLIA_INDEX_SETTINGS.searchableAttributes.indexOf(
          record.make === "Chevrolet" ? "make" : "unordered(makeAliases)",
        );
      const matching = [...records.values()]
        .filter(
          (record) =>
            record.firstSeenAt > after &&
            (record.make === "Chevrolet" ||
              record.searchTokens.includes("make=chevrolet")),
        )
        .sort((a, b) => rank(a) - rank(b) || a.vin.localeCompare(b.vin));
      const hits = matching.slice(
        request.page * request.hitsPerPage,
        (request.page + 1) * request.hitsPerPage,
      );
      pages.push({
        page: request.page,
        hits: hits.length,
        activeInPage: hits.some((hit) => hit.vin === activeVin),
        firstVin: hits[0]?.vin,
        lastVin: hits.at(-1)?.vin,
      });
      if (interleave && request.page === 0) {
        interleave = false;
        migration = searchIndexMigrationWorkflow();
        await waitForMigrationAttempt;
      }
      return {
        hits,
        nbHits: matching.length,
        nbPages: Math.ceil(matching.length / request.hitsPerPage),
        page: request.page,
        hitsPerPage: request.hitsPerPage,
        processingTimeMS: 0,
        query: request.query,
        params: "",
        exhaustiveNbHits: true,
      };
    }),
  ),
});
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
mock.module("../../src/env.js", () => ({
  env: { NEXT_PUBLIC_APP_URL: "https://example.com" },
}));
mock.module("../../src/lib/db", () => ({ db: database, dbClient: client }));
mock.module("../../src/lib/algolia", () => ({
  ALGOLIA_INDEX_NAME: "vehicles",
  getAlgoliaAdminClient: () => ({
    getSettings: async () => ({ userData: { searchSchemaVersion: 11 } }),
  }),
}));
mock.module("../../src/server/algolia-search-client", () => ({
  algoliaSearchClient: { searchForHits },
}));
mock.module("../../src/server/ingestion/vehicle-search-projection", () => ({
  projectSearchVehicles: async (
    _db: unknown,
    rows: (typeof vehicle.$inferSelect)[],
  ) => rows.map(mapDbVehicleToAlgolia),
}));
mock.module("../../src/server/ingestion/sync-algolia", () => ({
  configureAlgoliaIndex: async () => {},
  syncToAlgolia: async (rows: AlgoliaVehicleRecord[]) => {
    for (const row of rows) records.set(row.vin, row);
  },
}));
const { migrateSearchIndexBatch } =
  await import("../../src/server/ingestion/search-index-migration");
const { runDailySearchAlertCheckBatch } =
  await import("../../src/server/alerts/search-alert-check-runtime");
const unusedStep = async () => {};
const ingestionStepNames = [
  "cleanupDurableIngestionStateBatchStep",
  "cleanupStaleDurableAlgoliaRebuildsStep",
  "attachDurableIngestionWorkflowStep",
  "claimDurableIngestionCommitStep",
  "prepareIngestionPassStep",
  "reportIngestionRunStep",
  "signalCommitWaitersStep",
  "initializeDurableIngestionStep",
  "markDurableIngestionFailedStep",
  "markDurableSourceFailedStep",
  "reportProviderStatusStep",
  "reconcileDurableIngestionStep",
  "runAlgoliaProjectorStep",
  "runDurableSourceChunkStep",
  "validateDurableIngestionSourcesStep",
];
let result:
  | Awaited<ReturnType<typeof runDailySearchAlertCheckBatch>>
  | undefined;
mock.module("../../src/workflows/vehicle-steps", () => ({
  ...Object.fromEntries(ingestionStepNames.map((name) => [name, unusedStep])),
  runSearchAlertCheckBatchStep: async (checkDay: string) => {
    scanning = true;
    try {
      result = await runDailySearchAlertCheckBatch(checkDay);
      return result;
    } finally {
      scanning = false;
    }
  },
  searchPublicationModeStep: async () => "inline",
  warmVinCacheBatchStep: async (state: unknown) => ({
    status: "complete",
    state,
  }),
  initializeSearchIndexMigrationStep: async () => ({
    status: "pending",
    state: backfillState,
  }),
  runSearchIndexMigrationBatchStep: async (
    state: SearchIndexMigrationState,
  ) => {
    if (scanning) rewriteDuringScan = true;
    const batch = await migrateSearchIndexBatch(state);
    backfillState = batch.state;
    announceMigrationAttempt();
    return batch;
  },
  finalizeSearchIndexMigrationStep: async () => ({}),
}));
mock.module("../../src/workflows/search-projector", () => ({
  searchProjectorWorkflow: async () => {},
}));
mock.module("../../src/workflows/search-projector-steps", () => ({
  searchRebuildInFlightStep: async () => false,
}));
const { searchAlertCheckWorkflow } =
  await import("../../src/workflows/vehicle-ingestion");
const { searchIndexMigrationWorkflow } =
  await import("../../src/workflows/search-index-migration");
const { getAlertMatchStatsBatch } =
  await import("../../src/server/alerts/algolia-alert-search");
expect(COMMON_ALGOLIA_INDEX_SETTINGS.searchableAttributes[0]).toBe("make");
expect(COMMON_ALGOLIA_INDEX_SETTINGS.searchableAttributes[3]).toBe(
  "unordered(makeAliases)",
);
expect([...records.values()].filter((row) => !row.isMissing)).toHaveLength(1);
await searchAlertCheckWorkflow(day);
expect(result).toMatchObject({
  status: "complete",
  searchesProcessed: 1,
  intentsCreated: 1,
});
const [checkpoint] = await database.select().from(savedSearch);
const [check] = (
  await client.execute("select checked_through from search_alert_check")
).rows;
if (!checkpoint?.lastCheckedAt) throw new Error("Missing checkpoint");
expect(checkpoint.lastCheckedAt.getTime()).toBeGreaterThan(epoch + 2000);
const intents = (
  await client.execute("select * from search_notification_intent")
).rows;
expect(intents).toHaveLength(1);
expect(String(intents[0]?.payload)).toContain(activeVin);
expect(searchRequests).toBe(2);
expect(pages).toMatchObject([
  { page: 0, hits: 100, activeInPage: false },
  { page: 1, hits: 1, activeInPage: true },
]);
expect(rewriteDuringScan).toBe(false);
expect(scanLockAcquisitions).toBe(1);
if (!interleaving) expect(sleeps).toBe(0);
const scanRequests = searchRequests;
const scanSleeps = sleeps;
if (migration) await migration;
else await searchIndexMigrationWorkflow();
const [after] = await getAlertMatchStatsBatch(
  [
    {
      query: "Chevrolet",
      filters: { makes: ["Chevrolet"] },
      lastCheckedAt: checkpoint.lastCheckedAt,
    },
  ],
  {
    checkedThrough: new Date(Number(check?.checked_through)),
    latestFirstSeenAt: new Date(epoch + 2000),
  },
);
expect(after).toMatchObject({
  status: "fulfilled",
  value: { matchedCount: 0, completion: { status: "complete" } },
});
console.log(
  JSON.stringify(
    {
      scenario: "migration reorders matches between alert pages",
      interleaving,
      result,
      pages,
      scanRequests,
      scanSleeps,
      scanLockAcquisitions,
      checkpoint: checkpoint.lastCheckedAt,
      activeVehicleFirstSeenAt: epoch + 2000,
      activeVin,
      afterCheckpoint: after,
    },
    null,
    2,
  ),
);
client.close();
