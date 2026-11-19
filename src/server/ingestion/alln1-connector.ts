import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option, RateLimiter } from "effect";
import {
  Alln1ProviderError,
  fetchAlln1Owner,
  fetchAlln1Page,
} from "./alln1-client";
import {
  createAlln1Cursor,
  type UpullCursor,
  type Alln1Seen,
} from "./alln1-cursor";
import {
  alln1Hash,
  alln1Stock,
  type Alln1Page,
  type Alln1Record,
} from "./alln1-parser";
import {
  transformUpullRecord,
  type Alln1CanonicalVehicle,
} from "./alln1-transform";
import {
  ALLN1_TENANT,
  GRANDPAJOHNS_TENANT,
  type Alln1Tenant,
  type Alln1Source,
  type Alln1Yard,
} from "./alln1-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { ProviderChunkClock } from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";
import { SourceValidationPolicy } from "./source-validation";

interface Alln1Options<E, R, S extends Alln1Source> {
  startCursor?: UpullCursor<S>;
  maxPages?: number;
  onBatch: (vehicles: Alln1CanonicalVehicle<S>[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Alln1Yard<S>[]) => Effect.Effect<void, E, R>;
}
export type UpullStreamResult<S extends Alln1Source> = ConnectorChunkResult<
  S,
  UpullCursor<S>
>;
export type Alln1StreamResult = UpullStreamResult<"alln1">;
const validated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new Alln1ProviderError({ operation, cause }),
  });
function processPage<S extends Alln1Source>(
  records: readonly Alln1Record[],
  page: number,
  seen: Alln1Seen[],
  tenant: Alln1Tenant<S>,
) {
  const vins = new Set(seen.flatMap((entry) => (entry.vin ? [entry.vin] : [])));
  const stocks = new Set(
    seen.flatMap((entry) => (entry.stock ? [entry.stock] : [])),
  );
  const hashes = new Set(seen.map((entry) => entry.hash));
  const vehicles: Alln1CanonicalVehicle<S>[] = [];
  const observedVins: string[] = [];
  let rejected = 0;
  for (const record of records) {
    const result = transformUpullRecord(record, tenant);
    const vin = result.status === "available" ? result.vehicle.vin : result.vin;
    const stock = alln1Stock(record.stock);
    const hash = alln1Hash(record);
    if (
      (vin && vins.has(vin)) ||
      (stock && stocks.has(stock)) ||
      hashes.has(hash)
    )
      throw new Error(
        "Native pages repeat a donor VIN/serial, stock or complete source record",
      );
    if (vin) vins.add(vin);
    if (stock) stocks.add(stock);
    hashes.add(hash);
    const common = { hash, stock, firstPage: page };
    if (result.status === "available") {
      seen.push({ ...common, status: "available", vin: result.vehicle.vin });
      vehicles.push(result.vehicle);
    } else {
      rejected++;
      if (vin) observedVins.push(vin);
      seen.push(
        result.status === "quarantined"
          ? { ...common, status: "quarantined", position: result.position, vin }
          : { ...common, status: "incomplete", vin },
      );
    }
  }
  return { vehicles, observedVins, rejected };
}
function streamUpullInventoryWithRequestGate<S extends Alln1Source, E, R>(
  options: Alln1Options<E, R, S>,
  gate: ProviderRequestGate,
  tenant: Alln1Tenant<S>,
) {
  return Effect.gen(function* () {
    const codec = createAlln1Cursor(tenant);
    const parsed = codec.schema.safeParse(options.startCursor ?? codec.initial);
    const maxPages = options.maxPages ?? 3;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* new Alln1ProviderError({
        operation: "checkpoint",
        cause: "Use a validated All-N-1 cursor and a page budget from 1 to 32",
      });
    const initial = parsed.data;
    const empty: UpullStreamResult<S> = {
      source: tenant.source,
      status: "complete",
      cursor: { source: tenant.source, phase: "complete" },
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsExcluded: 0,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    };
    if (initial.phase === "complete") return empty;
    const resumeUrl = initial.phase === "pages" ? initial.nextUrl : null;
    const closingRead = Effect.all([
      fetchAlln1Owner(gate, tenant),
      fetchAlln1Page(tenant.inventoryUrl, gate, tenant),
    ]);
    // One shared host turn reads the owner and first-page anchor, the page
    // this chunk resumes at, and the closing reads when that page is the last,
    // so a chunk needs one turn to advance. Nothing here touches chunk state.
    const opening = yield* Effect.gen(function* () {
      const owner = yield* fetchAlln1Owner(gate, tenant);
      const anchor = yield* fetchAlln1Page(tenant.inventoryUrl, gate, tenant);
      const scopeHash = alln1Hash({ owner, scope: anchor.scopeHash });
      if (
        initial.phase === "pages" &&
        (initial.scopeHash !== scopeHash ||
          initial.anchorHash !== anchor.hash ||
          initial.lastPage !== anchor.lastPage)
      )
        return yield* new Alln1ProviderError({
          operation: "resume scope",
          cause:
            "Native owner, first-page inventory anchor or pagination changed during the crawl",
        });
      const page =
        resumeUrl === null
          ? anchor
          : yield* fetchAlln1Page(resumeUrl, gate, tenant);
      const closing = page.nextUrl === null ? yield* closingRead : null;
      return { owner, anchor, scopeHash, page, closing };
    }).pipe(
      sharedProviderHostTurn(
        tenant.origin,
        initial.phase === "pages" && initial.nextPage === initial.lastPage
          ? 5
          : 3,
      ),
    );
    const { owner, anchor, scopeHash } = opening;
    const seen: Alln1Seen[] =
      initial.phase === "pages" ? [...initial.seen] : [];
    const receipts: { hash: string; count: number }[] =
      initial.phase === "pages" ? [...initial.receipts] : [];
    let nextPage = initial.phase === "pages" ? initial.nextPage : 1;
    let nextUrl: string | null =
      initial.phase === "pages" ? initial.nextUrl : tenant.inventoryUrl;
    const vehicles: Alln1CanonicalVehicle<S>[] = [];
    const observedVins: string[] = [];
    let pagesProcessed = 0,
      processed = 0,
      rejected = 0;
    type PageRead = { page: Alln1Page; closing: typeof opening.closing };
    let pending: PageRead | null = {
      page: opening.page,
      closing: opening.closing,
    };
    let closing: typeof opening.closing = null;
    while (nextUrl && pagesProcessed < maxPages) {
      if (pending === null) {
        const url: string = nextUrl;
        // The last page shares its turn with the closing reads, because the
        // cursor cannot hold a crawl whose closing reads are still pending.
        const read: Option.Option<PageRead> = yield* Effect.gen(function* () {
          const page: Alln1Page = yield* fetchAlln1Page(url, gate, tenant);
          return {
            page,
            closing: page.nextUrl === null ? yield* closingRead : null,
          };
        }).pipe(
          sharedProviderHostTurn(
            tenant.origin,
            nextPage === anchor.lastPage ? 3 : 1,
          ),
          ProviderChunkClock.unlessDeferred(pagesProcessed > 0),
        );
        if (Option.isNone(read)) break;
        pending = read.value;
      }
      const page: Alln1Page = pending.page;
      closing = pending.closing;
      pending = null;
      if (
        page.page !== nextPage ||
        page.lastPage !== anchor.lastPage ||
        page.scopeHash !== anchor.scopeHash
      )
        return yield* new Alln1ProviderError({
          operation: "native page scope",
          cause:
            "Requested page or native pagination directory changed during the crawl",
        });
      const result = yield* validated("cumulative donor identities", () =>
        processPage(page.records, nextPage, seen, tenant),
      );
      vehicles.push(...result.vehicles);
      observedVins.push(...result.observedVins);
      rejected += result.rejected;
      processed += page.records.length;
      pagesProcessed++;
      receipts.push({ hash: page.hash, count: page.records.length });
      nextPage++;
      nextUrl = page.nextUrl;
    }
    const terminal = nextUrl === null;
    if (terminal) {
      yield* validated("complete yard coverage and quality", () => {
        const totalRejected = seen.filter(
          (entry) => entry.status !== "available",
        ).length;
        if (
          receipts.length !== anchor.lastPage ||
          totalRejected === seen.length ||
          totalRejected / seen.length >
            SourceValidationPolicy.maximumRejectionRatio
        )
          throw new Error(
            totalRejected +
              " rejected or quarantined of " +
              seen.length +
              " donors exceeds the unchanged 10% rejection limit or lacks complete valid yard coverage",
          );
      });
      if (closing === null)
        return yield* new Alln1ProviderError({
          operation: "terminal anchor",
          cause: "The last native page was read without its closing reads",
        });
      const [closingOwner, closingAnchor] = closing;
      if (
        closingOwner !== owner ||
        closingAnchor.hash !== anchor.hash ||
        closingAnchor.scopeHash !== anchor.scopeHash
      )
        return yield* new Alln1ProviderError({
          operation: "terminal anchor",
          cause:
            "Native owner, first-page inventory anchor or pagination changed during the crawl",
        });
    }
    const cursor = yield* validated("next checkpoint", () =>
      nextUrl === null
        ? codec.schema.parse({ source: tenant.source, phase: "complete" })
        : codec.checkpoint({
            scopeHash,
            anchorHash: anchor.hash,
            lastPage: anchor.lastPage,
            nextPage,
            nextUrl,
            seen,
            receipts,
          }),
    );
    // No callback can return an advanced checkpoint after any failed read.
    yield* options.onBatch(vehicles);
    if (terminal && options.onYards) yield* options.onYards([tenant.yard]);
    return {
      ...empty,
      status: terminal ? "complete" : "paused",
      cursor,
      count: vehicles.length,
      pagesProcessed,
      observedVins,
      warnings: rejected
        ? [
            (tenant.source === "alln1" ? "All-N-1" : tenant.yard.name) +
              " counts incomplete identities and literal availability-ambiguous positions toward rejection; valid identities remain presence-only.",
          ]
        : [],
      accounting: {
        recordsProcessed: processed,
        recordsExcluded: 0,
        recordsRejected: rejected,
        duplicateVehicles: 0,
      },
    } satisfies UpullStreamResult<S>;
  }).pipe(
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        new Alln1ProviderError({
          operation: "page budget",
          cause:
            "Three-minute chunk deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function createAlln1Connector<S extends Alln1Source>(
  tenant: Alln1Tenant<S>,
) {
  const streamWithRequestGate = <E, R>(
    options: Alln1Options<E, R, S>,
    gate: ProviderRequestGate,
  ) => streamUpullInventoryWithRequestGate(options, gate, tenant);
  return {
    streamWithRequestGate,
    stream<E, R>(options: Alln1Options<E, R, S>) {
      return Effect.scoped(
        RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
          Effect.flatMap((gate) => streamWithRequestGate(options, gate)),
        ),
      );
    },
  };
}
const alln1 = createAlln1Connector(ALLN1_TENANT);
export const streamAlln1Inventory = alln1.stream;
export const streamAlln1InventoryWithRequestGate = alln1.streamWithRequestGate;

const grandpajohns = createAlln1Connector(GRANDPAJOHNS_TENANT);
export const streamGrandpajohnsInventory = grandpajohns.stream;
export const streamGrandpajohnsInventoryWithRequestGate =
  grandpajohns.streamWithRequestGate;
