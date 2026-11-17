import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { fetchRohnerPage, RohnerProviderError } from "./rohner-client";
import {
  inspectRohnerCursor,
  ROHNER_MAX_RUN_BYTES,
  ROHNER_MAX_RUN_REQUESTS,
  RohnerCursor,
  RohnerCursorSchema,
} from "./rohner-cursor";
import {
  parseRohnerCatalog,
  parseRohnerDetail,
  ROHNER_MAX_RESPONSE_BYTES,
  rohnerCatalogPage,
  type RohnerCatalog,
} from "./rohner-parser";
import type { ProviderRequestGate } from "./provider-http-client";
import type { RohnerArticleResult } from "./rohner-record";
import type { RohnerCanonicalVehicle } from "./rohner-transform";
import {
  ROHNER_CATALOG,
  ROHNER_YARD,
  type RohnerYard,
} from "./rohner-yard-metadata";

interface RohnerOptions<E, R> {
  startCursor?: RohnerCursor;
  maxPages?: number;
  onBatch: (vehicles: RohnerCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: RohnerYard[]) => Effect.Effect<void, E, R>;
}
export interface RohnerStreamResult {
  source: "rohner";
  status: "paused" | "complete";
  cursor: RohnerCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const validated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new RohnerProviderError({ operation, cause }),
  });

/** One unit is one serial native GET. Emit only after the complete donor graph,
 * quality checks and every closing membership observation have passed.
 */
export function streamRohnerInventoryWithRequestGate<E, R>(
  options: RohnerOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 3;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 3)
      return yield* new RohnerProviderError({
        operation: "request budget",
        cause: "Use an integer request-unit budget from 1 through 3",
      });
    let cursor: RohnerCursor = yield* validated("checkpoint", () =>
      RohnerCursorSchema.parse(options.startCursor ?? RohnerCursor.initial),
    );
    const empty: RohnerStreamResult = {
      source: "rohner",
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
      return { ...empty, status: "complete" as const };
    const stopAt = Date.now() + 90_000;
    let pagesProcessed = 0;
    while (
      cursor.phase !== "complete" &&
      pagesProcessed < maxPages &&
      stopAt - Date.now() >= 25_000
    ) {
      yield* validated("remaining run capacity", () => {
        const used = inspectRohnerCursor(cursor);
        if (
          used.requests >= ROHNER_MAX_RUN_REQUESTS ||
          used.bytes > ROHNER_MAX_RUN_BYTES - ROHNER_MAX_RESPONSE_BYTES
        )
          throw new Error(
            "Run has no remaining request or full-response byte allowance; inspect source growth before resuming",
          );
      });
      if (cursor.phase === "catalog") {
        const nextPage = cursor.pages.length + 1;
        const url: string | undefined =
          cursor.pages.length === 0
            ? ROHNER_CATALOG
            : cursor.pages
                .at(-1)
                ?.links.find(
                  (link) => rohnerCatalogPage(link.href) === nextPage,
                )?.href;
        if (!url)
          return yield* new RohnerProviderError({
            operation: "native pagination",
            cause: "The next page has no literal published continuation URL",
          });
        const html = yield* fetchRohnerPage(url, gate);
        const page: RohnerCatalog = yield* validated("listing " + url, () =>
          parseRohnerCatalog(html, url),
        );
        const pages: RohnerCatalog[] = [...cursor.pages, page];
        cursor = yield* validated("listing prefix", () =>
          RohnerCursor.checkpoint({
            ...cursor,
            pages,
            phase: pages.length === page.lastPage ? "details" : "catalog",
          }),
        );
      } else if (cursor.phase === "details") {
        const post = cursor.pages.flatMap((page) => page.posts)[
          cursor.records.length
        ];
        if (!post)
          return yield* new RohnerProviderError({
            operation: "donor prefix",
            cause: "The next donor has no literal published detail URL",
          });
        const html = yield* fetchRohnerPage(post.url, gate);
        const record = yield* validated("donor " + post.url, () =>
          parseRohnerDetail(html, post),
        );
        const records: RohnerArticleResult[] = [...cursor.records, record];
        const total: number = cursor.pages.reduce(
          (sum, page) => sum + page.posts.length,
          0,
        );
        cursor = yield* validated("donor prefix", () =>
          RohnerCursor.checkpoint({
            ...cursor,
            records,
            phase: records.length === total ? "closing" : "details",
          }),
        );
      } else {
        const opening = cursor.pages[cursor.closing.length];
        if (!opening)
          return yield* new RohnerProviderError({
            operation: "closing prefix",
            cause: "The opening listing for this closing page is missing",
          });
        const html = yield* fetchRohnerPage(opening.url, gate);
        const page = yield* validated("closing listing " + opening.url, () =>
          parseRohnerCatalog(html, opening.url),
        );
        const closing: RohnerCatalog[] = [...cursor.closing, page];
        cursor = yield* validated("closing membership", () =>
          RohnerCursor.checkpoint({
            ...cursor,
            closing,
            phase:
              closing.length === cursor.pages.length ? "complete" : "closing",
          }),
        );
      }
      pagesProcessed++;
    }
    if (cursor.phase !== "complete" && pagesProcessed === 0)
      return yield* new RohnerProviderError({
        operation: "chunk progress",
        cause: "No control fits the remaining request and gate allowance",
      });
    if (cursor.phase !== "complete")
      return { ...empty, cursor, pagesProcessed };
    const result = yield* validated("terminal classification", () =>
      inspectRohnerCursor(cursor),
    );
    yield* options.onBatch(result.vehicles);
    if (options.onYards) yield* options.onYards([{ ...ROHNER_YARD }]);
    return {
      ...empty,
      status: "complete",
      cursor,
      count: result.vehicles.length,
      pagesProcessed,
      observedVins: result.observedVins,
      accounting: result.accounting,
      warnings: result.accounting.recordsRejected
        ? [
            "Rohner quarantined conflicting or incomplete required donor claims; valid rejected identities supply presence only.",
          ]
        : [],
    } satisfies RohnerStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new RohnerProviderError({
          operation: "chunk deadline",
          cause:
            "90-second active chunk deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamRohnerInventory<E, R>(options: RohnerOptions<E, R>) {
  return Effect.scoped(
    Effect.gen(function* () {
      yield* Effect.sleep("1600 millis");
      const limit = yield* RateLimiter.make({
        limit: 1,
        interval: "1600 millis",
      });
      const gate: ProviderRequestGate = (request) =>
        limit(request).pipe(Effect.ensuring(Effect.sleep("1600 millis")));
      return yield* streamRohnerInventoryWithRequestGate(options, gate);
    }),
  ).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new RohnerProviderError({
          operation: "live chunk deadline",
          cause:
            "Two-minute total chunk deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
