import { ingestionValidation } from "./ingestion-validation";
import { Effect, Option } from "effect";
import type { ProviderRequestGate } from "~/server/ingestion/provider-http-client";
import type { ConnectorChunkAccounting } from "~/server/ingestion/connector-chunk";
import { ProviderChunkClock } from "./provider-chunk-clock";
import {
  fetchWeberbrothersPage,
  WeberbrothersProviderError,
} from "./weberbrothers-client";
import {
  WeberbrothersCursor,
  WeberbrothersCursorSchema,
  inspectWeberbrothersCursor,
  WEBERBROTHERS_MAX_RUN_BYTES,
  WEBERBROTHERS_MAX_RUN_REQUESTS,
} from "./weberbrothers-cursor";
import { WEBERBROTHERS_MAX_RESPONSE_BYTES } from "./weberbrothers-html";
import {
  parseWeberbrothersCatalog,
  parseWeberbrothersDetail,
  weberbrothersCatalogMembership,
  type WeberbrothersCatalog,
  type WeberbrothersRecord,
  type WeberbrothersPost,
} from "./weberbrothers-parser";
import { validateWeberbrothersSnapshot } from "./weberbrothers-snapshot";
import type { WeberbrothersCanonicalVehicle } from "./weberbrothers-transform";
import {
  WEBERBROTHERS_CATALOG,
  WEBERBROTHERS_YARD,
  type WeberbrothersYard,
} from "./weberbrothers-yard-metadata";

interface WeberbrothersOptions<E, R> {
  startCursor?: WeberbrothersCursor;
  maxPages?: number;
  minimumUniqueInventory: number;
  previousUniqueInventory: number | null;
  onBatch: (
    vehicles: WeberbrothersCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: WeberbrothersYard[]) => Effect.Effect<void, E, R>;
}
export interface WeberbrothersStreamResult {
  source: "weberbrothers";
  status: "paused" | "complete";
  cursor: WeberbrothersCursor;
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
    catch: (cause) => new WeberbrothersProviderError({ operation, cause }),
  });
/** A transient GET failure (`fetchWeberbrothersPage` defers it) becomes
 * `Option.none()` once the chunk has `advanced`, so the chunk returns its
 * validated checkpoint and the next chunk resends that GET. Before any advance
 * the deferral fails the chunk and the source retries the same cursor later. */
const unlessTransient =
  (advanced: boolean) =>
  <A, E, R>(
    request: Effect.Effect<A, E, R>,
  ): Effect.Effect<Option.Option<A>, E, R> =>
    request.pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (error: E): boolean => advanced && ProviderChunkClock.isDeferral(error),
        (error) =>
          Effect.logWarning(
            `${error instanceof Error ? error.message : String(error)} Returning this chunk's validated checkpoint so the next chunk resends this GET.`,
          ).pipe(Effect.as(Option.none<A>())),
      ),
    );
const serial = Effect.runSync(Effect.makeSemaphore(1));
const requestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("2 seconds"))),
  );

/** Disabled until root wiring. Serial native GETs, all donor details and every
 * closing listing precede the first callback. Each returned cursor is resumable. */
export function streamWeberbrothersInventoryWithRequestGate<E, R>(
  options: WeberbrothersOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 10;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 20)
      return yield* new WeberbrothersProviderError({
        operation: "chunk request budget",
        cause:
          "Use an integer from 1 through 20; this limits a chunk, never source enumeration",
      });
    let cursor: WeberbrothersCursor = yield* validated("checkpoint", () =>
      WeberbrothersCursorSchema.parse(
        options.startCursor ?? WeberbrothersCursor.initial,
      ),
    );
    const empty: WeberbrothersStreamResult = {
      source: "weberbrothers",
      status: "paused",
      cursor,
      count: 0,
      pagesProcessed: 0,
      errors: [],
      warnings: [],
      observedVins: [],
      accounting: {
        recordsProcessed: 0,
        recordsRejected: 0,
        recordsExcluded: 0,
        duplicateVehicles: 0,
      },
    };
    if (cursor.phase === "complete")
      return { ...empty, status: "complete" as const };
    const usage = yield* validated("run capacity", () =>
      inspectWeberbrothersCursor(cursor),
    );
    let requests = usage.requests,
      bytes = usage.bytes,
      pagesProcessed = 0;
    const stopAt = Date.now() + 85_000;
    while (
      cursor.phase !== "complete" &&
      pagesProcessed < maxPages &&
      stopAt - Date.now() >= 27_000
    ) {
      if (
        requests >= WEBERBROTHERS_MAX_RUN_REQUESTS ||
        bytes > WEBERBROTHERS_MAX_RUN_BYTES - WEBERBROTHERS_MAX_RESPONSE_BYTES
      )
        return yield* new WeberbrothersProviderError({
          operation: "run capacity",
          cause:
            "No complete request/body allowance remains; inspect native source growth",
        });
      if (cursor.phase === "catalog") {
        const url: string | null | undefined =
          cursor.pages.length === 0
            ? WEBERBROTHERS_CATALOG
            : cursor.pages.at(-1)?.next;
        if (!url)
          return yield* new WeberbrothersProviderError({
            operation: "pagination",
            cause: "No literal next listing URL",
          });
        const html = yield* fetchWeberbrothersPage(url, gate).pipe(
          unlessTransient(pagesProcessed > 0),
        );
        if (Option.isNone(html)) break;
        const page: WeberbrothersCatalog = yield* validated(
          "listing " + url,
          () => parseWeberbrothersCatalog(html.value, url),
        );
        if (
          page.page !== cursor.pages.length + 1 ||
          (cursor.pages[0] && page.lastPage !== cursor.pages[0].lastPage)
        )
          return yield* new WeberbrothersProviderError({
            operation: "pagination",
            cause: "Native page order or terminal page changed",
          });
        cursor = {
          ...cursor,
          pages: [...cursor.pages, page],
          phase: page.next === null ? "details" : "catalog",
        };
        bytes += page.receipt.bytes;
      } else if (cursor.phase === "details") {
        const posts: WeberbrothersPost[] = cursor.pages.flatMap(
          (page) => page.posts,
        );
        const post = posts[cursor.records.length];
        if (!post)
          return yield* new WeberbrothersProviderError({
            operation: "donor prefix",
            cause: "No next native donor destination",
          });
        const html = yield* fetchWeberbrothersPage(post.url, gate).pipe(
          unlessTransient(pagesProcessed > 0),
        );
        if (Option.isNone(html)) break;
        const record = yield* validated("detail " + post.url, () =>
          parseWeberbrothersDetail(html.value, post),
        );
        const records: WeberbrothersRecord[] = [...cursor.records, record];
        cursor = {
          ...cursor,
          records,
          phase: records.length === posts.length ? "closing" : "details",
        };
        bytes += record.receipt.bytes;
      } else {
        const opening = cursor.pages[cursor.closing.length];
        if (!opening)
          return yield* new WeberbrothersProviderError({
            operation: "closing",
            cause: "No corresponding opening listing",
          });
        const html = yield* fetchWeberbrothersPage(opening.url, gate).pipe(
          unlessTransient(pagesProcessed > 0),
        );
        if (Option.isNone(html)) break;
        const page = yield* validated("closing " + opening.url, () =>
          parseWeberbrothersCatalog(html.value, opening.url),
        );
        if (
          JSON.stringify(weberbrothersCatalogMembership(opening)) !==
          JSON.stringify(weberbrothersCatalogMembership(page))
        )
          return yield* new WeberbrothersProviderError({
            operation: "closing membership",
            cause:
              "Native membership, titles or pagination changed; reconciliation is blocked",
          });
        const closing: WeberbrothersCatalog[] = [...cursor.closing, page];
        cursor = {
          ...cursor,
          closing,
          phase:
            closing.length === cursor.pages.length ? "complete" : "closing",
        };
        bytes += page.receipt.bytes;
      }
      requests++;
      pagesProcessed++;
    }
    cursor = yield* validated("chunk prefix", () =>
      WeberbrothersCursor.checkpoint(cursor),
    );
    if (cursor.phase !== "complete")
      return { ...empty, cursor, pagesProcessed };
    const snapshot = yield* validated("complete-source quality", () =>
      validateWeberbrothersSnapshot(
        inspectWeberbrothersCursor(cursor).snapshot,
        options,
      ),
    );
    yield* options.onBatch(snapshot.vehicles);
    if (options.onYards) yield* options.onYards([{ ...WEBERBROTHERS_YARD }]);
    return {
      ...empty,
      status: "complete" as const,
      cursor,
      pagesProcessed,
      count: snapshot.vehicles.length,
      accounting: snapshot.accounting,
      observedVins: snapshot.observedVins,
      warnings: snapshot.rejections.length
        ? [
            "Weber Brothers retained required rejects and complete-source identity conflicts as presence evidence only.",
          ]
        : [],
    };
  }).pipe(
    Effect.timeoutFail({
      duration: "90 seconds",
      onTimeout: () =>
        new WeberbrothersProviderError({
          operation: "chunk deadline",
          cause:
            "90-second deadline exceeded; no advanced checkpoint is accepted",
        }),
    }),
  );
}
export function streamWeberbrothersInventory<E, R>(
  options: WeberbrothersOptions<E, R>,
) {
  return streamWeberbrothersInventoryWithRequestGate(options, requestGate);
}
