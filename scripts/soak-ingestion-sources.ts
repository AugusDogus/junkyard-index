/**
 * Read-only provider soak for vehicle ingestion sources.
 *
 * Inventory batches are counted and discarded. AutoRecycler's geolocation
 * cache uses a temporary local SQLite database. No ingestion, Algolia, alert,
 * or production database state is mutated.
 *
 * Examples:
 *   bun run soak:sources -- --sources=row52,autorecycler --max-pages=20
 *   bun run soak:sources -- --sources=all --cycles=2 --pause-seconds=60
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Duration, Effect, RateLimiter, Scope } from "effect";
import {
  INGESTION_SOURCE_DISPLAY_NAMES,
  INGESTION_SOURCES,
  isIngestionSource,
  type IngestionSource,
} from "../src/lib/ingestion-source";
import { streamAutorecyclerInventory } from "../src/server/ingestion/autorecycler-connector";
import { Config, Database } from "../src/server/ingestion/context";
import { GopullitCursorState } from "../src/server/ingestion/durable-cursor";
import {
  streamGopullitInventory,
  streamGopullitInventoryWithRequestGate,
} from "../src/server/ingestion/gopullit-connector";
import {
  streamPullapartInventory,
  streamPullapartInventoryWithRequestGate,
} from "../src/server/ingestion/pullapart-connector";
import { streamPypInventory } from "../src/server/ingestion/pyp-connector";
import { streamRow52Inventory } from "../src/server/ingestion/row52-connector";
import { streamTapInventory } from "../src/server/ingestion/tap-inventory-connector";
import { UpullitDavieCursorState } from "../src/server/ingestion/durable-cursor";
import { streamUpullitDavieInventory } from "../src/server/ingestion/upullit-davie-connector";
import type { CanonicalVehicle } from "../src/server/ingestion/types";

interface SoakConfig {
  sources: IngestionSource[];
  cycles: number;
  maxPages: number | undefined;
  pauseSeconds: number;
  pullapartRequestsPerSecond: number | undefined;
  gopullitIntervalMs: number | undefined;
}

interface RequestMetrics {
  requests: number;
  statuses: Map<number, number>;
  networkErrors: number;
}

interface SourceResult {
  cycle: number;
  source: IngestionSource;
  status: "complete" | "paused" | "failed" | "error";
  pages: number;
  vehicles: number;
  batches: number;
  durationSeconds: number;
  requests: number;
  rateLimitedResponses: number;
  networkErrors: number;
  error: string | null;
}

const HYPERBROWSER_SOURCES: ReadonlySet<IngestionSource> = new Set([
  "pyp",
  "upullitdavie",
]);
const sourceContext = new AsyncLocalStorage<IngestionSource>();
const requestMetrics = new Map<IngestionSource, RequestMetrics>();

function positiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer, received ${value}`);
  }
  return parsed;
}

function nonnegativeInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a nonnegative integer, received ${value}`);
  }
  return parsed;
}

function parseSources(value: string): IngestionSource[] {
  if (value === "all") return [...INGESTION_SOURCES];
  const sources: IngestionSource[] = [];
  for (const candidate of value.split(",")) {
    const source = candidate.trim();
    if (!isIngestionSource(source)) {
      throw new Error(`Unknown ingestion source: ${source}`);
    }
    if (!sources.includes(source)) sources.push(source);
  }
  if (sources.length === 0) throw new Error("At least one source is required");
  return sources;
}

function parseArgs(argv: string[]): SoakConfig {
  let sources: IngestionSource[] = [...INGESTION_SOURCES];
  let cycles = 1;
  let maxPages: number | undefined;
  let pauseSeconds = 30;
  let pullapartRequestsPerSecond: number | undefined;
  let gopullitIntervalMs: number | undefined;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      console.log(`Provider soak

Usage:
  bun run soak:sources -- [options]

Options:
  --sources=all|row52,pyp,...  Sources to run (default: all)
  --cycles=1                   Number of full repetitions
  --max-pages=20               Optional page cap per source and cycle
  --pause-seconds=30           Delay between cycles
  --pullapart-rps=6            Override Pull-A-Part inventory requests/second
  --gopullit-interval-ms=1250  Override delay between GO Pull-It requests
`);
      process.exit(0);
    }
    if (arg.startsWith("--sources=")) {
      sources = parseSources(arg.slice("--sources=".length));
      continue;
    }
    if (arg.startsWith("--cycles=")) {
      cycles = positiveInteger(arg.slice("--cycles=".length), "--cycles");
      continue;
    }
    if (arg.startsWith("--max-pages=")) {
      maxPages = positiveInteger(
        arg.slice("--max-pages=".length),
        "--max-pages",
      );
      continue;
    }
    if (arg.startsWith("--pause-seconds=")) {
      pauseSeconds = nonnegativeInteger(
        arg.slice("--pause-seconds=".length),
        "--pause-seconds",
      );
      continue;
    }
    if (arg.startsWith("--pullapart-rps=")) {
      pullapartRequestsPerSecond = positiveInteger(
        arg.slice("--pullapart-rps=".length),
        "--pullapart-rps",
      );
      continue;
    }
    if (arg.startsWith("--gopullit-interval-ms=")) {
      gopullitIntervalMs = positiveInteger(
        arg.slice("--gopullit-interval-ms=".length),
        "--gopullit-interval-ms",
      );
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    sources,
    cycles,
    maxPages,
    pauseSeconds,
    pullapartRequestsPerSecond,
    gopullitIntervalMs,
  };
}

function metricsFor(source: IngestionSource): RequestMetrics {
  const existing = requestMetrics.get(source);
  if (existing) return existing;
  const created: RequestMetrics = {
    requests: 0,
    statuses: new Map(),
    networkErrors: 0,
  };
  requestMetrics.set(source, created);
  return created;
}

function installFetchMetrics(): () => void {
  const originalFetch = globalThis.fetch;
  const trackedFetch = Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const source = sourceContext.getStore();
      if (!source) return originalFetch(...args);

      const metrics = metricsFor(source);
      metrics.requests += 1;
      try {
        const response = await originalFetch(...args);
        metrics.statuses.set(
          response.status,
          (metrics.statuses.get(response.status) ?? 0) + 1,
        );
        return response;
      } catch (error) {
        metrics.networkErrors += 1;
        throw error;
      }
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = trackedFetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const hyperbrowserApiKey = process.env.HYPERBROWSER_API_KEY;
  if (
    config.sources.some((source) => HYPERBROWSER_SOURCES.has(source)) &&
    !hyperbrowserApiKey
  ) {
    throw new Error(
      "HYPERBROWSER_API_KEY is required for PYP and U Pull It Davie soaks",
    );
  }

  const temporaryDirectory = mkdtempSync(
    join(tmpdir(), "junkyard-source-soak-"),
  );
  const localClient = createClient({
    url: `file:${join(temporaryDirectory, "autorecycler-cache.db")}`,
  });
  await localClient.executeMultiple(`
    create table autorecycler_org_geo (
      org_lookup text primary key,
      lat real not null,
      lng real not null,
      location_name text not null,
      location_city text not null default 'Unknown',
      state text not null,
      state_abbr text not null,
      address text,
      updated_at integer not null
    );
  `);
  const localDatabase = drizzle(localClient);
  const restoreFetch = installFetchMetrics();
  const allResults: SourceResult[] = [];
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    const elapsedMinutes = (Date.now() - startedAt) / 60_000;
    console.log(
      `[soak] alive elapsed=${elapsedMinutes.toFixed(1)}m completed=${allResults.length}`,
    );
  }, 60_000);

  const runSource = async (
    source: IngestionSource,
    cycle: number,
  ): Promise<void> => {
    await sourceContext.run(source, async () => {
      const before = metricsFor(source);
      const requestsBefore = before.requests;
      const rateLimitsBefore = before.statuses.get(429) ?? 0;
      const networkErrorsBefore = before.networkErrors;
      let batches = 0;
      let batchVehicles = 0;
      const onBatch = (vehicles: CanonicalVehicle[]) =>
        Effect.sync(() => {
          batches += 1;
          batchVehicles += vehicles.length;
        });
      const sourceStartedAt = Date.now();
      console.log(
        `[soak] cycle=${cycle} source=${source} started maxPages=${config.maxPages ?? "full"}`,
      );

      const runProgram = <A, E>(
        program: Effect.Effect<A, E, Config | Database | Scope.Scope>,
      ): Promise<A> =>
        Effect.runPromise(
          program.pipe(
            Effect.scoped,
            Effect.provideService(Config, {
              betterStackHeartbeatUrl: undefined,
              hyperbrowserApiKey: hyperbrowserApiKey ?? "unused",
            }),
            Effect.provideService(Database, localDatabase),
          ),
        );

      try {
        const sourceResult = await (() => {
          switch (source) {
            case "row52":
              return runProgram(
                streamRow52Inventory({
                  onBatch,
                  cursor: {
                    source: "row52",
                    afterLocationId: 0,
                    locationIds: [],
                    skip: 0,
                  },
                  maxPages: config.maxPages,
                }),
              );
            case "pyp":
              return runProgram(
                streamPypInventory({
                  onBatch,
                  startPage: 1,
                  maxPages: config.maxPages,
                }),
              );
            case "autorecycler":
              return runProgram(
                streamAutorecyclerInventory({
                  onBatch,
                  startFrom: 0,
                  maxPages: config.maxPages,
                }),
              );
            case "pullapart":
              if (config.pullapartRequestsPerSecond === undefined) {
                return runProgram(
                  streamPullapartInventory({
                    onBatch,
                    startAfter: {
                      source: "pullapart",
                      locationId: 0,
                      makeId: 0,
                    },
                    maxPages: config.maxPages,
                  }),
                );
              }
              return runProgram(
                Effect.scoped(
                  RateLimiter.make({
                    limit: config.pullapartRequestsPerSecond,
                    interval: "1 second",
                  }).pipe(
                    Effect.flatMap((requestGate) =>
                      streamPullapartInventoryWithRequestGate(
                        {
                          onBatch,
                          startAfter: {
                            source: "pullapart",
                            locationId: 0,
                            makeId: 0,
                          },
                          maxPages: config.maxPages,
                        },
                        requestGate,
                      ),
                    ),
                  ),
                ),
              );
            case "upullitne":
              return runProgram(
                streamTapInventory({
                  onBatch,
                  startStoreIndex: 0,
                  maxPages: config.maxPages,
                }),
              );
            case "upullitdavie":
              return runProgram(
                streamUpullitDavieInventory({
                  onBatch,
                  startCursor: UpullitDavieCursorState.initial,
                  maxPages: config.maxPages,
                }),
              );
            case "gopullit":
              if (config.gopullitIntervalMs === undefined) {
                return runProgram(
                  streamGopullitInventory({
                    onBatch,
                    startCursor: GopullitCursorState.initial,
                    maxPages: config.maxPages,
                  }),
                );
              }
              const interval = Duration.millis(config.gopullitIntervalMs);
              return runProgram(
                Effect.sleep(interval).pipe(
                  Effect.zipRight(
                    Effect.scoped(
                      RateLimiter.make({ limit: 1, interval }).pipe(
                        Effect.flatMap((requestGate) =>
                          streamGopullitInventoryWithRequestGate(
                            {
                              onBatch,
                              startCursor: GopullitCursorState.initial,
                              maxPages: config.maxPages,
                            },
                            requestGate,
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              );
          }
        })();
        const after = metricsFor(source);
        const result: SourceResult = {
          cycle,
          source,
          status: sourceResult.status,
          pages: sourceResult.pagesProcessed,
          vehicles: sourceResult.count,
          batches,
          durationSeconds: (Date.now() - sourceStartedAt) / 1000,
          requests: after.requests - requestsBefore,
          rateLimitedResponses:
            (after.statuses.get(429) ?? 0) - rateLimitsBefore,
          networkErrors: after.networkErrors - networkErrorsBefore,
          error:
            sourceResult.errors.length > 0
              ? sourceResult.errors.join("; ")
              : null,
        };
        allResults.push(result);
        console.log("[soak] complete", result);
      } catch (error) {
        const after = metricsFor(source);
        const result: SourceResult = {
          cycle,
          source,
          status: "error",
          pages: 0,
          vehicles: batchVehicles,
          batches,
          durationSeconds: (Date.now() - sourceStartedAt) / 1000,
          requests: after.requests - requestsBefore,
          rateLimitedResponses:
            (after.statuses.get(429) ?? 0) - rateLimitsBefore,
          networkErrors: after.networkErrors - networkErrorsBefore,
          error: errorMessage(error),
        };
        allResults.push(result);
        console.error("[soak] failed", result);
      }
    });
  };

  try {
    for (let cycle = 1; cycle <= config.cycles; cycle += 1) {
      const selectedBrowserSources = config.sources.filter((source) =>
        HYPERBROWSER_SOURCES.has(source),
      );
      const selectedOtherSources = config.sources.filter(
        (source) => !HYPERBROWSER_SOURCES.has(source),
      );
      await Promise.all([
        (async () => {
          for (const source of selectedBrowserSources) {
            await runSource(source, cycle);
          }
        })(),
        ...selectedOtherSources.map((source) => runSource(source, cycle)),
      ]);
      if (cycle < config.cycles && config.pauseSeconds > 0) {
        await sleep(config.pauseSeconds * 1000);
      }
    }
  } finally {
    clearInterval(heartbeat);
    restoreFetch();
    localClient.close();
    rmSync(temporaryDirectory, { recursive: true });
  }

  console.table(
    allResults.map((result) => ({
      cycle: result.cycle,
      source: INGESTION_SOURCE_DISPLAY_NAMES[result.source],
      status: result.status,
      pages: result.pages,
      vehicles: result.vehicles,
      seconds: Number(result.durationSeconds.toFixed(1)),
      requests: result.requests,
      http429: result.rateLimitedResponses,
      networkErrors: result.networkErrors,
      error: result.error,
    })),
  );

  if (
    allResults.some(
      (result) =>
        result.status === "error" ||
        result.status === "failed" ||
        result.rateLimitedResponses > 0,
    )
  ) {
    process.exitCode = 1;
  }
}

await main();
