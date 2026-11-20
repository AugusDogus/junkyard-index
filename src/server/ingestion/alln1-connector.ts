import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option, RateLimiter } from "effect";
import {
  Alln1ProviderError,
  fetchAlln1Owner,
  fetchAlln1Page,
  fetchAlln1Search,
} from "./alln1-client";
import {
  ALLN1_EMPTY_CENSUS,
  admitAlln1Page,
  alln1PendingTies,
  completeAlln1Census,
  type Alln1Census,
} from "./alln1-census";
import { createAlln1Cursor, type UpullCursor } from "./alln1-cursor";
import { alln1Hash, type Alln1Page } from "./alln1-parser";
import type { Alln1CanonicalVehicle } from "./alln1-transform";
import {
  ALLN1_TENANT,
  GRANDPAJOHNS_TENANT,
  type Alln1Tenant,
  type Alln1Source,
  type Alln1Yard,
} from "./alln1-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  PROVIDER_CHUNK_WALL_LIMIT,
  ProviderChunkClock,
} from "./provider-chunk-clock";
import { sharedProviderHostTurn } from "./shared-provider-host";

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
/**
 * Set Date searches one finishing turn may hold. Its T searches and two
 * closing reads must end by the 340-second turn horizon even when every read
 * takes the 60-second read limit plus the 3.5-second URG gap and 1.6-second
 * gate: 5 reads x 65.1 s = 325.5 s. All-N-1 (three pages) has at most two
 * ties and Grandpa John's (two pages) one.
 */
export const ALLN1_MAX_TIE_SEARCHES = 3;
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
    let census: Alln1Census =
      initial.phase === "start"
        ? ALLN1_EMPTY_CENSUS
        : { seen: initial.seen, setDates: initial.setDates };
    const closingRead = Effect.all([
      fetchAlln1Owner(gate, tenant),
      fetchAlln1Page(tenant.inventoryUrl, gate, tenant),
    ]);
    // The Set Date searches for every pending tie, then the closing owner and
    // first-page reads, as one shared host turn of T + 2 reads. It is never
    // combined with a catalog page. With T capped at ALLN1_MAX_TIE_SEARCHES it
    // fits the turn horizon even when every read takes the full read limit;
    // more ties fail closed before any search is sent.
    const finishing = (before: Alln1Census) => {
      const ties = alln1PendingTies(before);
      if (ties.length > ALLN1_MAX_TIE_SEARCHES)
        return Effect.fail(
          new Alln1ProviderError({
            operation: "Set Date tie searches",
            cause:
              ties.length +
              " page boundaries split Set Date ties (" +
              ties.map((tie) => tie.date).join(", ") +
              "), but one finishing turn fits at most " +
              ALLN1_MAX_TIE_SEARCHES +
              " searches at the 60-second read limit, so this census cannot prove its hidden donors. Nothing was accepted. Splitting tie searches across turns is required before this yard's census can complete",
          }),
        );
      return Effect.all([
        Effect.forEach(ties, (tie) => fetchAlln1Search(tie.date, gate, tenant)),
        closingRead,
      ]).pipe(sharedProviderHostTurn(tenant.origin, ties.length + 2));
    };
    type Finished = Effect.Effect.Success<ReturnType<typeof finishing>>;
    // A closing checkpoint already admitted every page: its closing reads
    // are also its resume scope check, so it reads no opening controls.
    const opening =
      initial.phase === "closing"
        ? null
        : yield* Effect.gen(function* () {
            const owner = yield* fetchAlln1Owner(gate, tenant);
            const anchor = yield* fetchAlln1Page(
              tenant.inventoryUrl,
              gate,
              tenant,
            );
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
            return { owner, anchor, scopeHash, page };
          }).pipe(
            // One shared host turn reads the owner, the first-page anchor and
            // the page this chunk resumes at, so a chunk needs one turn to
            // advance. Nothing here touches chunk state.
            sharedProviderHostTurn(tenant.origin, resumeUrl === null ? 2 : 3),
          );
    const binding =
      opening === null
        ? initial.phase === "closing"
          ? {
              scopeHash: initial.scopeHash,
              anchorHash: initial.anchorHash,
              lastPage: initial.lastPage,
            }
          : null
        : {
            scopeHash: opening.scopeHash,
            anchorHash: opening.anchor.hash,
            lastPage: opening.anchor.lastPage,
          };
    if (binding === null)
      return yield* new Alln1ProviderError({
        operation: "checkpoint",
        cause: "Only a closing checkpoint may skip the opening controls",
      });
    const receipts = initial.phase === "start" ? [] : [...initial.receipts];
    let nextPage =
      initial.phase === "pages"
        ? initial.nextPage
        : initial.phase === "closing"
          ? initial.lastPage + 1
          : 1;
    let nextUrl: string | null =
      initial.phase === "pages"
        ? initial.nextUrl
        : initial.phase === "closing"
          ? null
          : tenant.inventoryUrl;
    const vehicles: Alln1CanonicalVehicle<S>[] = [];
    const observedVins: string[] = [];
    let pagesProcessed = 0,
      processed = 0,
      rejected = 0,
      repeated = 0;
    let pending: Alln1Page | null = opening?.page ?? null;
    while (nextUrl && pagesProcessed < maxPages) {
      if (pending === null) {
        const read: Option.Option<Alln1Page> = yield* fetchAlln1Page(
          nextUrl,
          gate,
          tenant,
        ).pipe(
          sharedProviderHostTurn(tenant.origin),
          ProviderChunkClock.unlessDeferred(pagesProcessed > 0),
        );
        if (Option.isNone(read)) break;
        pending = read.value;
      }
      const page: Alln1Page = pending;
      pending = null;
      if (
        opening === null ||
        page.page !== nextPage ||
        page.lastPage !== opening.anchor.lastPage ||
        page.scopeHash !== opening.anchor.scopeHash
      )
        return yield* new Alln1ProviderError({
          operation: "native page scope",
          cause:
            "Requested page or native pagination directory changed during the crawl",
        });
      const admitted = yield* validated("cumulative donor identities", () =>
        admitAlln1Page(census, page.records, nextPage, tenant),
      );
      census = admitted.census;
      vehicles.push(...admitted.vehicles);
      observedVins.push(...admitted.observedVins);
      rejected += admitted.rejected;
      processed += page.records.length;
      repeated += admitted.repeats;
      pagesProcessed++;
      receipts.push({
        hash: page.hash,
        count: page.records.length,
        repeats: admitted.repeats,
      });
      nextPage++;
      nextUrl = page.nextUrl;
    }
    // Every page is admitted: search the pending ties and reread the closing
    // controls. An advanced chunk whose finishing turn is deferred returns a
    // closing checkpoint; a closing checkpoint's chunk defers as a whole.
    const finished: Option.Option<Finished> =
      nextUrl === null
        ? yield* finishing(census).pipe(
            ProviderChunkClock.unlessDeferred(pagesProcessed > 0),
          )
        : Option.none();
    const terminal = Option.isSome(finished);
    const recovered: string[] = [];
    if (Option.isSome(finished)) {
      const [searches, [closingOwner, closingAnchor]] = finished.value;
      const completed = yield* validated(
        "complete yard coverage and quality",
        () =>
          completeAlln1Census(
            census,
            searches,
            binding.lastPage,
            receipts.length,
            binding.lastPage,
            tenant,
          ),
      );
      census = completed.census;
      vehicles.push(...completed.vehicles);
      observedVins.push(...completed.observedVins);
      rejected += completed.rejected;
      processed += completed.processed;
      for (const search of searches) recovered.push(search.date);
      if (
        alln1Hash({ owner: closingOwner, scope: closingAnchor.scopeHash }) !==
          binding.scopeHash ||
        closingAnchor.hash !== binding.anchorHash ||
        closingAnchor.lastPage !== binding.lastPage
      )
        return yield* new Alln1ProviderError({
          operation: "terminal anchor",
          cause:
            "Native owner, first-page inventory anchor or pagination changed during the crawl",
        });
    }
    const setDates = census.setDates;
    const cursor = yield* validated("next checkpoint", () => {
      if (terminal)
        return codec.schema.parse({ source: tenant.source, phase: "complete" });
      if (setDates === null)
        throw new Error("A paused census must hold at least one native donor");
      const ledger = {
        scopeHash: binding.scopeHash,
        anchorHash: binding.anchorHash,
        lastPage: binding.lastPage,
        seen: census.seen,
        receipts,
        setDates,
      };
      return nextUrl === null
        ? codec.closing(ledger)
        : codec.checkpoint({ ...ledger, nextPage, nextUrl });
    });
    const name = tenant.source === "alln1" ? "All-N-1" : tenant.yard.name;
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
      warnings: [
        ...(rejected
          ? [
              name +
                " counts incomplete identities and literal availability-ambiguous positions toward rejection; valid identities remain presence-only.",
            ]
          : []),
        ...(recovered.length
          ? [
              name +
                " page boundaries split the Set Date ties " +
                recovered.join(", ") +
                "; their native Set Date searches recovered the donors the pages hid.",
            ]
          : []),
      ],
      accounting: {
        recordsProcessed: processed,
        recordsExcluded: 0,
        recordsRejected: rejected,
        duplicateVehicles: repeated,
      },
    } satisfies UpullStreamResult<S>;
  }).pipe(
    // Uncached inventory reads take 18 to 26 s and a read may take 60 s, so a
    // fixed work budget below the wall limit would fail healthy censuses on
    // slow days. With the wall limit as the work budget, every shared host
    // turn ends by the turn horizon first: a slow turn is deferred, so an
    // advanced chunk returns its checkpoint and an unadvanced one is retried
    // as a deferral, never a failure.
    ProviderChunkClock.deadline({
      duration: PROVIDER_CHUNK_WALL_LIMIT,
      onTimeout: () =>
        new Alln1ProviderError({
          operation: "page budget",
          cause:
            "Chunk work reached the step's wall limit outside a shared host turn; retain the last validated checkpoint",
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
