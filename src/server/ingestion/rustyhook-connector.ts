import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { fetchRustyhookPage, RustyhookProviderError } from "./rustyhook-client";
import {
  inspectRustyhookCursor,
  RUSTYHOOK_MAX_RUN_BYTES,
  RUSTYHOOK_MAX_RUN_REQUESTS,
  RustyhookCursor,
  RustyhookCursorSchema,
} from "./rustyhook-cursor";
import {
  parseRustyhookCatalog,
  parseRustyhookDetail,
  RUSTYHOOK_MAX_RESPONSE_BYTES,
  type RustyhookCatalog,
  type RustyhookRecord,
} from "./rustyhook-parser";
import type { ProviderRequestGate } from "./provider-http-client";
import type { RustyhookCanonicalVehicle } from "./rustyhook-transform";
import {
  RUSTYHOOK_CATALOG,
  RUSTYHOOK_YARD,
  type RustyhookYard,
} from "./rustyhook-yard-metadata";

interface RustyhookOptions<E, R> {
  startCursor?: RustyhookCursor;
  maxPages?: number;
  onBatch: (vehicles: RustyhookCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: RustyhookYard[]) => Effect.Effect<void, E, R>;
}
export interface RustyhookStreamResult {
  source: "rustyhook";
  status: "paused" | "complete";
  cursor: RustyhookCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const validated = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new RustyhookProviderError({ operation, cause }),
  });

/** Emit only after every native listing and detail, then every closing listing,
 * has passed the same validated durable prefix. One unit is one serial GET.
 */
export function streamRustyhookInventoryWithRequestGate<E, R>(
  options: RustyhookOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 3;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 3)
      return yield* new RustyhookProviderError({
        operation: "request budget",
        cause: "Use an integer request-unit budget from 1 through 3",
      });
    let cursor: RustyhookCursor = yield* validated("checkpoint", () =>
      RustyhookCursorSchema.parse(
        options.startCursor ?? RustyhookCursor.initial,
      ),
    );
    const empty: RustyhookStreamResult = {
      source: "rustyhook",
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
      stopAt - Date.now() >= 55_000
    ) {
      yield* validated("remaining run capacity", () => {
        const used = inspectRustyhookCursor(cursor);
        if (
          used.requests >= RUSTYHOOK_MAX_RUN_REQUESTS ||
          used.bytes > RUSTYHOOK_MAX_RUN_BYTES - RUSTYHOOK_MAX_RESPONSE_BYTES
        )
          throw new Error(
            "Run has no remaining request or full-response byte allowance; inspect source growth before resuming",
          );
      });
      if (cursor.phase === "catalog") {
        const nextPage = cursor.pages.length + 1;
        const url: string | undefined =
          cursor.pages.length === 0
            ? RUSTYHOOK_CATALOG
            : cursor.pages.at(-1)?.links.find((link) => link.page === nextPage)
                ?.url;
        if (!url)
          return yield* new RustyhookProviderError({
            operation: "native pagination",
            cause: "The next page has no literal published continuation URL",
          });
        const html: string = yield* fetchRustyhookPage(url, gate);
        const page: RustyhookCatalog = yield* validated("listing " + url, () =>
          parseRustyhookCatalog(html, url),
        );
        const pages: RustyhookCatalog[] = [...cursor.pages, page];
        cursor = yield* validated("listing prefix", () =>
          RustyhookCursor.checkpoint({
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
          return yield* new RustyhookProviderError({
            operation: "donor prefix",
            cause: "The next donor has no literal published detail URL",
          });
        const html = yield* fetchRustyhookPage(post.url, gate);
        const record = yield* validated("donor " + post.url, () =>
          parseRustyhookDetail(html, post),
        );
        const records: RustyhookRecord[] = [...cursor.records, record];
        const total: number = cursor.pages.reduce(
          (sum, page) => sum + page.posts.length,
          0,
        );
        cursor = yield* validated("donor prefix", () =>
          RustyhookCursor.checkpoint({
            ...cursor,
            records,
            phase: records.length === total ? "closing" : "details",
          }),
        );
      } else {
        const opening = cursor.pages[cursor.closing.length];
        if (!opening)
          return yield* new RustyhookProviderError({
            operation: "closing prefix",
            cause:
              "The opening listing corresponding to this closing page is missing",
          });
        const html = yield* fetchRustyhookPage(opening.url, gate);
        const page = yield* validated("closing listing " + opening.url, () =>
          parseRustyhookCatalog(html, opening.url),
        );
        const closing: RustyhookCatalog[] = [...cursor.closing, page];
        cursor = yield* validated("closing membership", () =>
          RustyhookCursor.checkpoint({
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
      return yield* new RustyhookProviderError({
        operation: "chunk progress",
        cause: "No control fits the remaining 55-second gate/request allowance",
      });
    if (cursor.phase !== "complete")
      return { ...empty, cursor, pagesProcessed };
    const result = yield* validated("terminal classification", () =>
      inspectRustyhookCursor(cursor),
    );
    const terminal: RustyhookStreamResult = {
      ...empty,
      status: "complete",
      cursor,
      count: result.vehicles.length,
      pagesProcessed,
      observedVins: result.observedVins,
      warnings: result.rejections.length
        ? [
            "Rusty Hook rejected conflicting or incomplete required donor metadata; all genuine rejected identities supply presence evidence only.",
          ]
        : [],
      accounting: {
        recordsProcessed: result.processed,
        recordsExcluded: 0,
        recordsRejected: result.rejections.length,
        duplicateVehicles: 0,
      },
    };
    yield* options.onBatch(result.vehicles);
    if (options.onYards) yield* options.onYards([{ ...RUSTYHOOK_YARD }]);
    return terminal;
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new RustyhookProviderError({
          operation: "chunk deadline",
          cause:
            "90-second active chunk deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}

export function streamRustyhookInventory<E, R>(
  options: RustyhookOptions<E, R>,
) {
  // A fresh limiter has an immediate token. Delay that token so a resumed chunk
  // also preserves the source's 30-second spacing after the prior chunk ends.
  return Effect.scoped(
    Effect.sleep("30 seconds").pipe(
      Effect.zipRight(RateLimiter.make({ limit: 1, interval: "30 seconds" })),
      Effect.flatMap((gate) =>
        streamRustyhookInventoryWithRequestGate(options, gate),
      ),
    ),
  ).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new RustyhookProviderError({
          operation: "live chunk deadline",
          cause:
            "Two-minute total live chunk deadline exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
