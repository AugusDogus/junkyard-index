/**
 * Read-only Row52 benchmark.
 *
 * Sweeps one or more concurrency values, fetches a configurable number of
 * Row52 pages, performs the same transform work as production, and prints a
 * compact results table.
 *
 * Examples:
 *   bun scripts/row52-benchmark.ts
 *   bun scripts/row52-benchmark.ts --pages=20 --concurrency=1,2,4,6,8
 *   bun scripts/row52-benchmark.ts --pages=50 --json-out=tmp/row52-benchmark.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import buildQuery from "odata-query";
import pMap from "p-map";
import pRetry, { AbortError } from "p-retry";
import { API_ENDPOINTS } from "../src/lib/constants";
import type {
  Row52Location,
  Row52ODataResponse,
  Row52Vehicle,
} from "../src/lib/types";
import { transformRow52Vehicle as transformRow52VehicleProduction } from "../src/server/ingestion/row52-connector";
import type { CanonicalVehicle } from "../src/server/ingestion/types";

const DEFAULT_PAGE_SIZE = 1000;
const DEFAULT_PAGES_TO_TEST = 40;
const DEFAULT_CONCURRENCY_VALUES = [1, 2, 4, 6, 8];
const FETCH_TIMEOUT_MS = 30_000;
const TIMEOUT_RETRY_LIMIT = 2;
const TIMEOUT_RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

interface CliConfig {
  concurrencyValues: number[];
  pagesToTest: number;
  pageSize: number;
  jsonOutputPath: string | null;
}

interface FetchMetrics {
  attempts: number;
  retries: number;
  timeoutRetries: number;
  retryableStatusRetries: number;
}

interface PageSuccess {
  ok: true;
  skip: number;
  transformedCount: number;
  rawCount: number;
  elapsedMs: number;
  metrics: FetchMetrics;
}

interface PageFailure {
  ok: false;
  skip: number;
  elapsedMs: number;
  metrics: FetchMetrics;
  error: string;
}

type PageResult = PageSuccess | PageFailure;

interface BenchmarkResult {
  concurrency: number;
  pageSize: number;
  pagesRequested: number;
  pagesFetched: number;
  vehiclesFetched: number;
  totalTimeSec: number;
  pagesPerSec: number;
  vehiclesPerSec: number;
  avgPageMs: number;
  p95PageMs: number;
  retries: number;
  timeoutRetries: number;
  retryableStatusRetries: number;
  errors: number;
}

function printUsage(): void {
  console.log(`Row52 benchmark

Usage:
  bun scripts/row52-benchmark.ts [options]

Options:
  --concurrency=1,2,4,6,8   Comma-separated concurrency sweep
  --pages=40                Number of pages to benchmark
  --page-size=1000          Row52 OData $top value
  --json-out=path           Optional JSON output path
  --help                    Show this help
`);
}

function parsePositiveInt(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flagName}: ${value}`);
  }
  return parsed;
}

function parseCliArgs(argv: string[]): CliConfig {
  let concurrencyValues = DEFAULT_CONCURRENCY_VALUES;
  let pagesToTest = DEFAULT_PAGES_TO_TEST;
  let pageSize = DEFAULT_PAGE_SIZE;
  let jsonOutputPath: string | null = null;

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
    if (arg.startsWith("--concurrency=")) {
      const raw = arg.slice("--concurrency=".length);
      const parsed = raw
        .split(",")
        .map((entry) => parsePositiveInt(entry.trim(), "--concurrency"))
        .filter((value, index, arr) => arr.indexOf(value) === index)
        .sort((a, b) => a - b);
      if (parsed.length === 0) {
        throw new Error("Expected at least one concurrency value");
      }
      concurrencyValues = parsed;
      continue;
    }
    if (arg.startsWith("--pages=")) {
      pagesToTest = parsePositiveInt(arg.slice("--pages=".length), "--pages");
      continue;
    }
    if (arg.startsWith("--page-size=")) {
      pageSize = parsePositiveInt(arg.slice("--page-size=".length), "--page-size");
      continue;
    }
    if (arg.startsWith("--json-out=")) {
      const rawPath = arg.slice("--json-out=".length).trim();
      if (!rawPath) {
        throw new Error("Expected a path after --json-out=");
      }
      jsonOutputPath = rawPath;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    concurrencyValues,
    pagesToTest,
    pageSize,
    jsonOutputPath,
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lowerMessage = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    lowerMessage.includes("aborted due to timeout") ||
    lowerMessage.includes("timeout")
  );
}

async function fetchRow52WithRetryMetrics(
  url: string,
  context: string,
): Promise<{ response: Response; metrics: FetchMetrics }> {
  const metrics: FetchMetrics = {
    attempts: 0,
    retries: 0,
    timeoutRetries: 0,
    retryableStatusRetries: 0,
  };
  const totalAttempts = TIMEOUT_RETRY_LIMIT + 1;

  const response = await pRetry(
    async (attemptNumber) => {
      metrics.attempts = attemptNumber;

      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (RETRYABLE_STATUS_CODES.has(response.status)) {
          if (attemptNumber < totalAttempts) {
            metrics.retries += 1;
            metrics.retryableStatusRetries += 1;
          }
          throw new Error(`Retryable HTTP status: ${response.status}`);
        }

        return response;
      } catch (error) {
        if (!isTimeoutError(error)) {
          if (
            error instanceof Error &&
            error.message.startsWith("Retryable HTTP status:")
          ) {
            throw error;
          }
          throw new AbortError(`[Row52 bench] ${context}: ${toErrorMessage(error)}`);
        }

        if (attemptNumber < totalAttempts) {
          metrics.retries += 1;
          metrics.timeoutRetries += 1;
        }

        throw error instanceof Error ? error : new Error(toErrorMessage(error));
      }
    },
    {
      retries: TIMEOUT_RETRY_LIMIT,
      factor: 2,
      minTimeout: TIMEOUT_RETRY_BASE_DELAY_MS,
      maxTimeout:
        TIMEOUT_RETRY_BASE_DELAY_MS * 2 ** Math.max(TIMEOUT_RETRY_LIMIT - 1, 0),
      randomize: false,
    },
  );

  return { response, metrics };
}

async function fetchRow52Json<T>(
  endpoint: string,
  queryString: string,
  context: string,
): Promise<{ data: Row52ODataResponse<T>; metrics: FetchMetrics }> {
  const url = `${API_ENDPOINTS.ROW52_BASE}${endpoint}${queryString}`;
  const { response, metrics } = await fetchRow52WithRetryMetrics(url, context);

  if (!response.ok) {
    throw new Error(`Row52 API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as Row52ODataResponse<T>;
  return { data, metrics };
}

function buildLocationQuery(): string {
  return buildQuery({
    orderBy: "state/name",
    select: [
      "id",
      "name",
      "code",
      "address1",
      "city",
      "zipCode",
      "phone",
      "latitude",
      "longitude",
      "isActive",
      "isVisible",
      "isParticipating",
      "webUrl",
      "partsPricingUrl",
      "stateId",
    ],
    expand: "state($select=id,name,abbreviation,countryId)",
    filter: { isParticipating: true },
  });
}

function buildVehicleQuery(skip: number, pageSize: number): string {
  return buildQuery({
    filter: { isActive: true },
    expand: ["model($expand=make)", "location($expand=state)", "images"],
    orderBy: "dateAdded desc",
    top: pageSize,
    skip,
    count: false,
  });
}

async function fetchLocations(): Promise<Map<number, Row52Location>> {
  const { data } = await fetchRow52Json<Row52Location>(
    API_ENDPOINTS.ROW52_LOCATIONS,
    buildLocationQuery(),
    "locations",
  );

  const map = new Map<number, Row52Location>();
  for (const location of data.value) {
    map.set(location.id, location);
  }
  return map;
}

async function fetchVehicleCount(pageSize: number): Promise<number> {
  const queryString = buildQuery({
    filter: { isActive: true },
    orderBy: "dateAdded desc",
    top: pageSize,
    skip: 0,
    count: true,
  });
  const { data } = await fetchRow52Json<Row52Vehicle>(
    API_ENDPOINTS.ROW52_VEHICLES,
    queryString,
    "count bootstrap",
  );
  return data["@odata.count"] ?? data.value.length;
}

function transformRow52Vehicle(
  vehicle: Row52Vehicle,
  locationMap: Map<number, Row52Location>,
): CanonicalVehicle | null {
  return transformRow52VehicleProduction(vehicle, locationMap);
}

async function fetchAndTransformPage(
  skip: number,
  pageSize: number,
  locationMap: Map<number, Row52Location>,
): Promise<PageResult> {
  const startedAt = performance.now();
  const queryString = buildVehicleQuery(skip, pageSize);

  try {
    const { data, metrics } = await fetchRow52Json<Row52Vehicle>(
      API_ENDPOINTS.ROW52_VEHICLES,
      queryString,
      `vehicles skip=${skip}`,
    );

    let transformedCount = 0;
    for (const row of data.value) {
      if (transformRow52Vehicle(row, locationMap)) {
        transformedCount += 1;
      }
    }

    return {
      ok: true,
      skip,
      transformedCount,
      rawCount: data.value.length,
      elapsedMs: performance.now() - startedAt,
      metrics,
    };
  } catch (error) {
    return {
      ok: false,
      skip,
      elapsedMs: performance.now() - startedAt,
      metrics: {
        attempts: TIMEOUT_RETRY_LIMIT + 1,
        retries: TIMEOUT_RETRY_LIMIT,
        timeoutRetries: 0,
        retryableStatusRetries: 0,
      },
      error: toErrorMessage(error),
    };
  }
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function benchmarkConcurrency(params: {
  concurrency: number;
  pageSize: number;
  pagesToTest: number;
  locationMap: Map<number, Row52Location>;
}): Promise<BenchmarkResult> {
  const skips = Array.from({ length: params.pagesToTest }, (_, index) => {
    return index * params.pageSize;
  });
  const startedAt = performance.now();

  const results = await pMap(
    skips,
    async (skip) =>
      fetchAndTransformPage(skip, params.pageSize, params.locationMap),
    {
      concurrency: params.concurrency,
    },
  );

  const totalTimeMs = performance.now() - startedAt;
  const successfulPages = results.filter((result) => result.ok);
  const failedPages = results.filter((result) => !result.ok);
  const pageLatencies = successfulPages.map((result) => result.elapsedMs);
  const totalVehicles = successfulPages.reduce((sum, result) => {
    return sum + result.transformedCount;
  }, 0);
  const totalRetries = results.reduce((sum, result) => {
    return sum + result.metrics.retries;
  }, 0);
  const timeoutRetries = results.reduce((sum, result) => {
    return sum + result.metrics.timeoutRetries;
  }, 0);
  const retryableStatusRetries = results.reduce((sum, result) => {
    return sum + result.metrics.retryableStatusRetries;
  }, 0);

  if (failedPages.length > 0) {
    const preview = failedPages.slice(0, 3).map((result) => {
      return `skip=${result.skip}: ${result.error}`;
    });
    console.warn(
      `[Row52 bench] concurrency=${params.concurrency} had ${failedPages.length} page errors`,
    );
    preview.forEach((line) => console.warn(`  ${line}`));
  }

  return {
    concurrency: params.concurrency,
    pageSize: params.pageSize,
    pagesRequested: params.pagesToTest,
    pagesFetched: successfulPages.length,
    vehiclesFetched: totalVehicles,
    totalTimeSec: round(totalTimeMs / 1000, 2),
    pagesPerSec:
      totalTimeMs > 0 ? round(successfulPages.length / (totalTimeMs / 1000), 2) : 0,
    vehiclesPerSec:
      totalTimeMs > 0 ? round(totalVehicles / (totalTimeMs / 1000), 2) : 0,
    avgPageMs: round(average(pageLatencies), 1),
    p95PageMs: round(percentile(pageLatencies, 95), 1),
    retries: totalRetries,
    timeoutRetries,
    retryableStatusRetries,
    errors: failedPages.length,
  };
}

function writeJsonOutput(path: string, payload: object): void {
  const absolutePath = resolve(process.cwd(), path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  console.log(`\nSaved JSON results to ${absolutePath}`);
}

const cliConfig = parseCliArgs(process.argv.slice(2));

console.log("Row52 benchmark configuration");
console.log(
  JSON.stringify(
    {
      concurrencyValues: cliConfig.concurrencyValues,
      pagesToTest: cliConfig.pagesToTest,
      pageSize: cliConfig.pageSize,
      jsonOutputPath: cliConfig.jsonOutputPath,
    },
    null,
    2,
  ),
);

console.log("\nFetching Row52 locations...");
const locationMap = await fetchLocations();
console.log(`Found ${locationMap.size} participating locations`);

console.log("Fetching Row52 total count...");
const totalVehicles = await fetchVehicleCount(cliConfig.pageSize);
const totalPagesAvailable = Math.max(1, Math.ceil(totalVehicles / cliConfig.pageSize));
const pagesToTest = Math.min(cliConfig.pagesToTest, totalPagesAvailable);
console.log(
  `Total vehicles: ${totalVehicles} across ~${totalPagesAvailable} pages; benchmarking ${pagesToTest} pages per configuration`,
);

const results: BenchmarkResult[] = [];
for (const concurrency of cliConfig.concurrencyValues) {
  console.log(`\nRunning benchmark for concurrency=${concurrency}...`);
  const result = await benchmarkConcurrency({
    concurrency,
    pageSize: cliConfig.pageSize,
    pagesToTest,
    locationMap,
  });
  results.push(result);
}

console.log("\nRow52 benchmark results");
console.table(results);

const bestByVehiclesPerSec = [...results].sort((a, b) => {
  return b.vehiclesPerSec - a.vehiclesPerSec;
})[0];

if (bestByVehiclesPerSec) {
  console.log(
    `Best throughput: concurrency=${bestByVehiclesPerSec.concurrency} at ${bestByVehiclesPerSec.vehiclesPerSec} vehicles/sec (${bestByVehiclesPerSec.errors} errors, ${bestByVehiclesPerSec.retries} retries)`,
  );
}

if (cliConfig.jsonOutputPath) {
  writeJsonOutput(cliConfig.jsonOutputPath, {
    generatedAt: new Date().toISOString(),
    config: {
      ...cliConfig,
      pagesToTest,
      totalVehicles,
      totalPagesAvailable,
    },
    results,
  });
}
