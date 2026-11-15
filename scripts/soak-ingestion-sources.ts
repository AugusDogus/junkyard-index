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
import { DURABLE_SOURCE_DEFINITIONS } from "../src/server/ingestion/durable-source";
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
import { streamTapSiteInventory } from "../src/server/ingestion/tap-inventory-connector";
import { TEARAPART_SITE_CONFIG } from "../src/server/ingestion/tap-sites";
import { streamPullNSaveInventory } from "../src/server/ingestion/pullnsave-connector";
import { streamWrenchApartInventory } from "../src/server/ingestion/wrenchapart-connector";
import { streamUpullRPartsInventory } from "../src/server/ingestion/upullrparts-connector";
import { streamIPullUPullInventory } from "../src/server/ingestion/ipullupull-connector";
import { streamUpullitwaInventory } from "../src/server/ingestion/upullitwa-connector";
import { streamPartsGaloreInventory } from "../src/server/ingestion/partsgalore-connector";
import { streamRtpInventory } from "../src/server/ingestion/rtp-connector";
import { soakRtpInventory } from "./soak-rtp";
import { streamNvpapInventory } from "../src/server/ingestion/nvpap-connector";
import { soakNvpapInventory } from "./soak-nvpap";
import { streamPontiacInventory } from "../src/server/ingestion/pontiac-connector";
import { soakPontiacInventory } from "./soak-pontiac";
import { streamAeroInventory } from "../src/server/ingestion/aero-connector";
import { streamChesterfieldInventory } from "../src/server/ingestion/chesterfield-connector";
import { DonorPhotoStore } from "../src/server/ingestion/donor-photo-store";
import { soakChesterfieldInventory } from "./soak-chesterfield";
import { streamUtpapInventory } from "../src/server/ingestion/utpap-connector";
import { soakUtpapInventory } from "./soak-utpap";
import { streamTritownInventory } from "../src/server/ingestion/tritown-connector";
import { soakTritownInventory } from "./soak-tritown";
import { streamWhitebradstreetInventory } from "../src/server/ingestion/whitebradstreet-connector";
import { soakWhitebradstreetInventory } from "./soak-whitebradstreet";
import { streamMidwayInventory } from "../src/server/ingestion/midway-connector";
import { soakMidwayInventory } from "./soak-midway";
import { streamRightwayInventory } from "../src/server/ingestion/rightway-connector";
import { soakRightwayInventory } from "./soak-rightway";
import { streamDdautoInventory } from "../src/server/ingestion/ddauto-connector";
import { soakDdautoInventory } from "./soak-ddauto";
import { streamRivervalleyInventory } from "../src/server/ingestion/rivervalley-connector";
import { soakRivervalleyInventory } from "./soak-rivervalley";
import { streamFenixInventory } from "../src/server/ingestion/fenix-connector";
import { soakFenixInventory } from "./soak-fenix";
import { streamImportapartInventory } from "../src/server/ingestion/importapart-connector";
import { soakImportapartInventory } from "./soak-importapart";
import { streamBigtruckpageInventory } from "../src/server/ingestion/bigtruckpage-connector";
import { soakBigtruckpageInventory } from "./soak-bigtruckpage";
import { streamSpeedysInventory } from "../src/server/ingestion/speedys-connector";
import { soakSpeedysInventory } from "./soak-speedys";
import { streamSandwInventoryFromProvider } from "../src/server/ingestion/sandw-connector";
import { streamBeaversInventory } from "../src/server/ingestion/beavers-connector";
import { soakBeaversInventory } from "./soak-beavers";
import { streamDentonInventoryFromProvider } from "../src/server/ingestion/denton-connector";
import { soakDentonInventory } from "./soak-denton";
import { streamScottsInventory } from "../src/server/ingestion/scotts-connector";
import { soakScottsInventory } from "./soak-scotts";
import { streamDutchersInventory } from "../src/server/ingestion/dutchers-connector";
import { soakDutchersInventory } from "./soak-dutchers";
import { streamChasencarsInventoryFromProvider } from "../src/server/ingestion/chasencars-connector";
import { soakChasencarsInventory } from "./soak-chasencars";
import { streamOemgarageInventoryFromProvider } from "../src/server/ingestion/oemgarage-connector";
import { soakOemgarageInventory } from "./soak-oemgarage";
import { streamHagermanInventory } from "../src/server/ingestion/hagerman-connector";
import { soakHagermanInventory } from "./soak-hagerman";
import { streamKandrInventoryFromProvider } from "../src/server/ingestion/kandr-connector";
import { KANDR_CONTRACT } from "../src/server/ingestion/kandr-configuration";
import { soakKandrInventory } from "./soak-kandr";
import { streamJimsimportInventoryFromProvider } from "../src/server/ingestion/jimsimport-connector";
import { soakJimsimportInventory } from "./soak-jimsimport";
import { streamLonestarimportsInventoryFromProvider } from "../src/server/ingestion/lonestarimports-connector";
import { soakLonestarimportsInventory } from "./soak-lonestarimports";
import { streamHollanderstoresInventoryFromProvider } from "../src/server/ingestion/hollanderstores-provider";
import { soakHollanderstoresInventory } from "./soak-hollanderstores";
import { streamAlshnedInventory } from "../src/server/ingestion/alshned-connector";
import { soakAlshnedInventory } from "./soak-alshned";
import { streamWeberbrothersInventory } from "../src/server/ingestion/weberbrothers-connector";
import { soakWeberbrothersInventory } from "./soak-weberbrothers";
import { streamOemInventoryFromProvider } from "../src/server/ingestion/oem-connector";
import { OEM_LOCATION } from "../src/server/ingestion/oem-yard-metadata";
import { SourceValidationPolicy } from "../src/server/ingestion/source-validation";
import { soakOemInventory } from "./soak-oem";
import { streamIndianriverInventoryFromProvider } from "../src/server/ingestion/indianriver-connector";
import { soakIndianriverInventory } from "./soak-indianriver";
import { streamArmyInventory } from "../src/server/ingestion/army-connector";
import { soakArmyInventory } from "./soak-army";
import { streamIdipullInventory } from "../src/server/ingestion/idipull-connector";
import { soakIdipullInventory } from "./soak-idipull";
import { streamPullsavewaInventory } from "../src/server/ingestion/pullsavewa-connector";
import { soakPullsavewaInventory } from "./soak-pullsavewa";
import { streamLittletonInventory } from "../src/server/ingestion/littleton-connector";
import { soakLittletonInventory } from "./soak-littleton";
import { streamMichigantruckInventory } from "../src/server/ingestion/michigantruck-connector";
import { soakMichigantruckInventory } from "./soak-michigantruck";
import { streamJolietInventory } from "../src/server/ingestion/joliet-connector";
import { soakJolietInventory } from "./soak-joliet";
import { streamAlln1Inventory } from "../src/server/ingestion/alln1-connector";
import { soakAlln1Inventory } from "./soak-alln1";
import { streamPickersInventory } from "../src/server/ingestion/pickers-connector";
import { soakPickersInventory } from "./soak-pickers";
import { streamUwrenchInventory } from "../src/server/ingestion/uwrench-connector";
import { soakUwrenchInventory } from "./soak-uwrench";
import { streamPipesInventory } from "../src/server/ingestion/pipes-connector";
import { soakPipesInventory } from "./soak-pipes";
import { streamMillerstownInventory } from "../src/server/ingestion/millerstown-connector";
import { soakMillerstownInventory } from "./soak-millerstown";
import { streamPickapartvaInventory } from "../src/server/ingestion/pickapartva-connector";
import { soakPickapartvaInventory } from "./soak-pickapartva";
import { streamMccauleyInventory } from "../src/server/ingestion/mccauley-connector";
import { soakMccauleyInventory } from "./soak-mccauley";
import { streamRustyhookInventory } from "../src/server/ingestion/rustyhook-connector";
import { streamAviationInventory } from "../src/server/ingestion/aviation-connector";
import { soakAviationInventory } from "./soak-aviation";
import { streamChazInventory } from "../src/server/ingestion/chaz-connector";
import { soakChazInventory } from "./soak-chaz";
import { streamCitymotorsInventory } from "../src/server/ingestion/citymotors-connector";
import { soakCitymotorsInventory } from "./soak-citymotors";
import { streamAwapInventory } from "../src/server/ingestion/awap-connector";
import { soakAwapInventory } from "./soak-awap";
import { streamClearsalvageInventory } from "../src/server/ingestion/clearsalvage-connector";
import { soakClearsalvageInventory } from "./soak-clearsalvage";
import { streamAplusInventory } from "../src/server/ingestion/aplus-connector";
import { soakAplusInventory } from "./soak-aplus";
import { streamCentralInventory } from "../src/server/ingestion/central-connector";
import { soakCentralInventory } from "./soak-central";
import { streamCoutuInventory } from "../src/server/ingestion/coutu-connector";
import { soakCoutuInventory } from "./soak-coutu";
import { streamKodakInventory } from "../src/server/ingestion/kodak-connector";
import { soakKodakInventory } from "./soak-kodak";
import { streamSix03Inventory } from "../src/server/ingestion/six03-connector";
import { soakSix03Inventory } from "./soak-six03";
import { soakRustyhookInventory } from "./soak-rustyhook";
import { streamRohnerInventory } from "../src/server/ingestion/rohner-connector";
import { soakRohnerInventory } from "./soak-rohner";
import { streamPrattInventoryFromProvider } from "../src/server/ingestion/pratt-connector";
import { PRATT_CONTRACT } from "../src/server/ingestion/pratt-configuration";
import { soakPrattInventory } from "./soak-pratt";
import { streamCars4PartsInventoryFromProvider } from "../src/server/ingestion/cars4parts-connector";
import { CARS4PARTS_CONTRACT } from "../src/server/ingestion/cars4parts-configuration";
import { soakCars4PartsInventory } from "./soak-cars4parts";
import { streamMeeksInventory } from "../src/server/ingestion/meeks-connector";
import { streamBrandywineInventory } from "../src/server/ingestion/brandywine-connector";
import { soakBrandywineInventory } from "./soak-brandywine";
import { streamRmmdtpInventoryFromProvider } from "../src/server/ingestion/rmmdtp-connector";
import { RMMDTP_CONTRACT } from "../src/server/ingestion/rmmdtp-configuration";
import { soakRmmdtpInventory } from "./soak-rmmdtp";
import { streamCaltonInventoryFromProvider } from "../src/server/ingestion/calton-connector";
import { CALTON_CONTRACT } from "../src/server/ingestion/calton-configuration";
import { soakCaltonInventory } from "./soak-calton";
import { UpullitDavieCursorState } from "../src/server/ingestion/durable-cursor";
import { streamUpullitDavieInventory } from "../src/server/ingestion/upullit-davie-connector";
import type { CanonicalVehicle } from "../src/server/ingestion/types";
import { SourceSoakMetrics } from "./source-soak-metrics";

interface SoakConfig {
  sources: IngestionSource[];
  cycles: number;
  maxPages: number | undefined;
  pauseSeconds: number;
  pullapartRequestsPerSecond: number | undefined;
  gopullitIntervalMs: number | undefined;
}

interface SourceResult {
  cycle: number;
  source: IngestionSource;
  status: "complete" | "paused" | "failed" | "error";
  pages: number;
  vehicles: number;
  batches: number;
  uniqueEmittedVins: number;
  duplicateEmissions: number;
  vehiclesByYard: Record<string, number>;
  durationSeconds: number;
  requests: number | null;
  rateLimitedResponses: number | null;
  networkErrors: number | null;
  error: string | null;
  warnings: string[];
}

const HYPERBROWSER_SOURCES: ReadonlySet<IngestionSource> = new Set([
  "upullitdavie",
]);
const requestMetrics = new SourceSoakMetrics();

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
      "HYPERBROWSER_API_KEY is required for U Pull It Davie soaks",
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
      resolution_version integer not null default 0,
      updated_at integer not null
    );
  `);
  const localDatabase = drizzle(localClient);
  const restoreFetch = requestMetrics.installFetchMetrics();
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
    const before = requestMetrics.metricsFor(source);
    const requestsBefore = before.requests;
    const rateLimitsBefore = before.statuses.get(429) ?? 0;
    const networkErrorsBefore = before.networkErrors;
    let batches = 0;
    let batchVehicles = 0;
    const emittedVins = new Set<string>();
    const yardVins = new Map<string, Set<string>>();
    const onBatch = (vehicles: CanonicalVehicle[]) =>
      Effect.sync(() => {
        batches += 1;
        batchVehicles += vehicles.length;
        for (const vehicle of vehicles) {
          emittedVins.add(vehicle.vin);
          const vins = yardVins.get(vehicle.locationCode) ?? new Set<string>();
          vins.add(vehicle.vin);
          yardVins.set(vehicle.locationCode, vins);
        }
      });
    const sourceStartedAt = Date.now();
    console.log(
      `[soak] cycle=${cycle} source=${source} started maxPages=${config.maxPages ?? "full"}`,
    );

    const runProgram = <A, E>(
      program: Effect.Effect<A, E, Config | Database | Scope.Scope>,
    ): Promise<A> =>
      requestMetrics.runPromise(
        source,
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
          case "utpap": {
            const photoStore = DonorPhotoStore.memory();
            return soakUtpapInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamUtpapInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                    photoStore,
                    appOrigin: "https://soak.invalid",
                  }),
                ),
              config.maxPages,
            );
          }
          case "chesterfield": {
            const photoStore = DonorPhotoStore.memory();
            return soakChesterfieldInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamChesterfieldInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                    photoStore,
                    appUrl: "https://soak.invalid",
                  }),
                ),
              config.maxPages,
            );
          }
          case "tritown":
            return soakTritownInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamTritownInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "whitebradstreet":
            return soakWhitebradstreetInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamWhitebradstreetInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "midway":
            return soakMidwayInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamMidwayInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "rightway":
            return soakRightwayInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamRightwayInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "ddauto":
            return soakDdautoInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamDdautoInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "rivervalley":
            return soakRivervalleyInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamRivervalleyInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "fenix":
            return soakFenixInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamFenixInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "bigtruckpage":
            return soakBigtruckpageInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamBigtruckpageInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "speedys":
            return soakSpeedysInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamSpeedysInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "sandw":
            return runProgram(
              streamSandwInventoryFromProvider({
                previousUniqueInventory: null,
                maxPages: Math.min(config.maxPages ?? 5, 5),
                onBatch,
              }),
            );
          case "beavers":
            return soakBeaversInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamBeaversInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "denton":
            return soakDentonInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamDentonInventoryFromProvider({
                    previousAcceptedCount: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "weberbrothers":
            return soakWeberbrothersInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamWeberbrothersInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                    minimumUniqueInventory:
                      SourceValidationPolicy.minimumUniqueInventory
                        .weberbrothers,
                    previousUniqueInventory: null,
                  }),
                ),
              config.maxPages,
            );
          case "lonestarimports":
            return soakLonestarimportsInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamLonestarimportsInventoryFromProvider({
                    previousAcceptedCount: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "hollanderstores":
            return soakHollanderstoresInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamHollanderstoresInventoryFromProvider({
                    previousAcceptedCount: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "alshned":
            return soakAlshnedInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamAlshnedInventory({
                    previousAcceptedCount: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "jimsimport":
            return soakJimsimportInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamJimsimportInventoryFromProvider({
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "kandr":
            return soakKandrInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamKandrInventoryFromProvider({
                    contract: KANDR_CONTRACT,
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "hagerman":
            return soakHagermanInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamHagermanInventory({
                    previousAcceptedCount: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "oemgarage":
            return soakOemgarageInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamOemgarageInventoryFromProvider({
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "chasencars":
            return soakChasencarsInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamChasencarsInventoryFromProvider({
                    previousAcceptedCount: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "dutchers":
            return soakDutchersInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamDutchersInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "oem":
            return soakOemInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamOemInventoryFromProvider({
                    location: OEM_LOCATION,
                    minimumUniqueInventory:
                      SourceValidationPolicy.minimumUniqueInventory.oem,
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "scotts":
            return soakScottsInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamScottsInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "indianriver":
            return soakIndianriverInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamIndianriverInventoryFromProvider({
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "importapart":
            return soakImportapartInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamImportapartInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "army":
            return soakArmyInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamArmyInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "idipull":
            return soakIdipullInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamIdipullInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "alln1":
            return soakAlln1Inventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamAlln1Inventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "pickers":
            return soakPickersInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamPickersInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "uwrench":
            return soakUwrenchInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamUwrenchInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "pipes":
            return soakPipesInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamPipesInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "millerstown":
            return soakMillerstownInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamMillerstownInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              1,
            );
          case "pickapartva":
            return soakPickapartvaInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamPickapartvaInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "mccauley":
            return soakMccauleyInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamMccauleyInventory({ startCursor, maxPages, onBatch }),
                ),
              Math.min(config.maxPages ?? 104, 104),
            );
          case "rustyhook":
            return soakRustyhookInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamRustyhookInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "aviation":
            return soakAviationInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamAviationInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "chaz":
            return soakChazInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamChazInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "citymotors":
            return soakCitymotorsInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamCitymotorsInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "awap":
            return soakAwapInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamAwapInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "clearsalvage":
            return soakClearsalvageInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamClearsalvageInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "aplus":
            return soakAplusInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamAplusInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "central":
            return soakCentralInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamCentralInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "coutu":
            return soakCoutuInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamCoutuInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "kodak":
            return soakKodakInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamKodakInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "six03":
            return soakSix03Inventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamSix03Inventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "pratt":
            return soakPrattInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamPrattInventoryFromProvider({
                    contract: PRATT_CONTRACT,
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "rohner":
            return soakRohnerInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamRohnerInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "joliet":
            return soakJolietInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamJolietInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "michigantruck":
            return soakMichigantruckInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamMichigantruckInventory({
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "littleton":
            return soakLittletonInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamLittletonInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "pullsavewa":
            return soakPullsavewaInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamPullsavewaInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "aero":
            return runProgram(streamAeroInventory({ onBatch }));
          case "meeks":
            return runProgram(streamMeeksInventory({ onBatch }));
          case "brandywine":
            return soakBrandywineInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamBrandywineInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "calton":
            return soakCaltonInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamCaltonInventoryFromProvider({
                    contract: CALTON_CONTRACT,
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "rmmdtp":
            return soakRmmdtpInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamRmmdtpInventoryFromProvider({
                    contract: RMMDTP_CONTRACT,
                    previousUniqueInventory: null,
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "cars4parts":
            return soakCars4PartsInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamCars4PartsInventoryFromProvider({
                    contract: CARS4PARTS_CONTRACT,
                    previousUniqueInventory: {
                      heyworth: null,
                      armington: null,
                    },
                    startCursor,
                    maxPages,
                    onBatch,
                  }),
                ),
              config.maxPages,
            );
          case "pontiac":
            return soakPontiacInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamPontiacInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "nvpap":
            return soakNvpapInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamNvpapInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "rtp":
            return soakRtpInventory(
              (startCursor, maxPages) =>
                runProgram(
                  streamRtpInventory({ startCursor, maxPages, onBatch }),
                ),
              config.maxPages,
            );
          case "ipullupull":
            return runProgram(streamIPullUPullInventory({ onBatch }));
          case "upullitwa":
            return runProgram(
              streamUpullitwaInventory({
                onBatch,
                maxPages: config.maxPages ?? 3200,
              }),
            );
          case "partsgalore":
            return runProgram(streamPartsGaloreInventory({ onBatch }));
          case "wrenchapart":
            return runProgram(
              streamWrenchApartInventory({
                onBatch,
                maxPages: config.maxPages ?? Number.MAX_SAFE_INTEGER,
              }),
            );
          case "upullrparts":
            return runProgram(streamUpullRPartsInventory({ onBatch }));
          case "pullnsave":
            return runProgram(
              streamPullNSaveInventory({
                onBatch,
                maxPages: config.maxPages,
              }),
            );
          case "tearapart":
            return runProgram(
              streamTapSiteInventory({
                config: TEARAPART_SITE_CONFIG,
                onBatch,
                maxPages: config.maxPages,
              }),
            );
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
                cursor: DURABLE_SOURCE_DEFINITIONS.pyp.initialCursor,
                maxPages: config.maxPages,
              }),
            );
          case "autorecycler":
            return runProgram(
              streamAutorecyclerInventory({
                onBatch,
                startCursor:
                  DURABLE_SOURCE_DEFINITIONS.autorecycler.initialCursor,
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
      const after = requestMetrics.metricsFor(source);
      const result: SourceResult = {
        cycle,
        source,
        status: sourceResult.status,
        pages: sourceResult.pagesProcessed,
        vehicles: sourceResult.count,
        batches,
        uniqueEmittedVins: emittedVins.size,
        duplicateEmissions: batchVehicles - emittedVins.size,
        vehiclesByYard: Object.fromEntries(
          [...yardVins].map(([code, vins]) => [code, vins.size]),
        ),
        durationSeconds: (Date.now() - sourceStartedAt) / 1000,
        // PYP uses curl, which bypasses the fetch instrumentation below.
        requests: source === "pyp" ? null : after.requests - requestsBefore,
        rateLimitedResponses:
          source === "pyp"
            ? null
            : (after.statuses.get(429) ?? 0) - rateLimitsBefore,
        networkErrors:
          source === "pyp" ? null : after.networkErrors - networkErrorsBefore,
        error:
          sourceResult.errors.length > 0
            ? sourceResult.errors.join("; ")
            : null,
        warnings:
          "warnings" in sourceResult ? (sourceResult.warnings ?? []) : [],
      };
      allResults.push(result);
      console.log("[soak] complete", result);
      if ("accounting" in sourceResult)
        console.log("[soak] accounting", sourceResult.accounting);
    } catch (error) {
      const after = requestMetrics.metricsFor(source);
      const result: SourceResult = {
        cycle,
        source,
        status: "error",
        pages: 0,
        vehicles: batchVehicles,
        batches,
        uniqueEmittedVins: emittedVins.size,
        duplicateEmissions: batchVehicles - emittedVins.size,
        vehiclesByYard: Object.fromEntries(
          [...yardVins].map(([code, vins]) => [code, vins.size]),
        ),
        durationSeconds: (Date.now() - sourceStartedAt) / 1000,
        requests: source === "pyp" ? null : after.requests - requestsBefore,
        rateLimitedResponses:
          source === "pyp"
            ? null
            : (after.statuses.get(429) ?? 0) - rateLimitsBefore,
        networkErrors:
          source === "pyp" ? null : after.networkErrors - networkErrorsBefore,
        error: errorMessage(error),
        warnings: [],
      };
      allResults.push(result);
      console.error("[soak] failed", result);
    }
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
      warnings: result.warnings.join("; "),
    })),
  );

  if (
    allResults.some(
      (result) =>
        result.status === "error" ||
        result.status === "failed" ||
        (result.rateLimitedResponses ?? 0) > 0,
    )
  ) {
    process.exitCode = 1;
  }
}

await main();
