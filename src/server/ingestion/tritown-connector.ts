import { Effect, RateLimiter } from "effect";
import {
  fetchTritownContext,
  fetchTritownPage,
  TritownProviderError,
} from "./tritown-client";
import { TritownCursor, TritownCursorSchema } from "./tritown-cursor";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";
import {
  transformTritownRecord,
  type TritownCanonicalVehicle,
} from "./tritown-transform";
import { TRITOWN_YARD, type TritownYard } from "./tritown-yard-metadata";

interface TritownOptions<E, R> {
  startCursor?: TritownCursor;
  maxPages?: number;
  onBatch: (vehicles: TritownCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: TritownYard[]) => Effect.Effect<void, E, R>;
}
export type TritownStreamResult = ConnectorChunkResult<
  "tritown",
  TritownCursor
>;
type TritownProgress = Pick<
  Extract<TritownCursor, { phase: "pages" }>,
  "processed" | "emitted" | "rejected" | "vins" | "urls" | "hashes" | "lastPage"
>;
const failure = (operation: string, cause: unknown) =>
  Effect.fail(new TritownProviderError({ operation, cause }));

export function streamTritownInventoryWithRequestGate<E, R>(
  options: TritownOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = TritownCursorSchema.safeParse(
      options.startCursor ?? TritownCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* failure(
        "checkpoint",
        "Use a validated TriTown cursor and a page budget from 1 to 32",
      );
    let cursor: TritownCursor = parsed.data;
    const summary: TritownStreamResult = {
      source: "tritown",
      status: "paused",
      cursor,
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
    if (cursor.phase === "complete")
      return { ...summary, status: "complete" as const };
    const context = yield* fetchTritownContext(gate);
    if (
      cursor.phase === "pages" &&
      JSON.stringify(cursor.makes) !== JSON.stringify(context.makes)
    )
      return yield* failure(
        "catalog scope",
        "Native make directory changed during the crawl",
      );
    const observed = new Set<string>();
    while (cursor.phase !== "complete" && summary.pagesProcessed < maxPages) {
      const pageNumber: number = cursor.phase === "start" ? 1 : cursor.nextPage;
      const page = yield* fetchTritownPage(pageNumber, context.nonce, gate);
      const prior: TritownProgress =
        cursor.phase === "pages"
          ? cursor
          : {
              processed: 0,
              emitted: 0,
              rejected: 0,
              vins: [],
              urls: [],
              hashes: [],
              lastPage: page.lastPage,
            };
      if (prior.lastPage !== page.lastPage)
        return yield* failure(
          "pagination",
          "Native total pages changed during the crawl",
        );
      const hashes = [...prior.hashes, page.hash];
      const vins = new Set(prior.vins);
      const urls = new Set(prior.urls);
      if (prior.hashes.includes(page.hash))
        return yield* failure(
          "pagination",
          "Native page repeated an earlier page body",
        );
      const vehicles: TritownCanonicalVehicle[] = [];
      let rejected = 0;
      for (const record of page.records) {
        if (urls.has(record.donorUrl))
          return yield* failure(
            "pagination",
            "A donor URL repeats across catalog pages",
          );
        urls.add(record.donorUrl);
        const result = transformTritownRecord(record, context.makes);
        const vin =
          result.status === "available" ? result.vehicle.vin : result.vin;
        if (vin && vins.has(vin))
          return yield* failure(
            "donor identity",
            "Different native listings reuse a valid VIN or serial",
          );
        if (vin) vins.add(vin);
        if (result.status === "available") vehicles.push(result.vehicle);
        else {
          rejected++;
          if (vin) observed.add(vin);
        }
      }
      const processed = prior.processed + page.records.length;
      const totalRejected = prior.rejected + rejected;
      const emitted = prior.emitted + vehicles.length;
      const terminal: boolean = pageNumber === page.lastPage;
      if (
        terminal &&
        (emitted === 0 ||
          totalRejected / processed >
            SourceValidationPolicy.maximumRejectionRatio)
      )
        return yield* failure(
          "yard quality",
          totalRejected +
            " rejected of " +
            processed +
            " donors exceeds the unchanged 10% rejection limit or leaves no valid donors",
        );
      // A failing callback cannot produce an advanced durable checkpoint.
      yield* options.onBatch(vehicles);
      if (terminal && options.onYards) yield* options.onYards([TRITOWN_YARD]);
      cursor = terminal
        ? { source: "tritown", phase: "complete" }
        : {
            source: "tritown",
            phase: "pages",
            nextPage: pageNumber + 1,
            lastPage: page.lastPage,
            makes: context.makes,
            processed,
            emitted,
            rejected: totalRejected,
            vins: [...vins],
            urls: [...urls],
            hashes,
          };
      summary.count += vehicles.length;
      summary.pagesProcessed++;
      if (summary.accounting) {
        summary.accounting.recordsProcessed += page.records.length;
        summary.accounting.recordsRejected += rejected;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
      observedVins: [...observed],
      warnings: summary.accounting?.recordsRejected
        ? [
            "TriTown rejected incomplete required donor metadata; independently valid VINs supply presence evidence only.",
          ]
        : [],
    } satisfies TritownStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new TritownProviderError({
          operation: "chunk budget",
          cause:
            "Three-minute chunk limit exceeded; no advanced checkpoint returned",
        }),
    }),
  );
}

export function streamTritownInventory<E, R>(options: TritownOptions<E, R>) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamTritownInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
