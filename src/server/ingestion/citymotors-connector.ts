import { ingestionValidation } from "./ingestion-validation";
import { Effect, Either } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import {
  CITYMOTORS_REQUEST_BUDGET_MS,
  CitymotorsProviderError,
  CitymotorsTransientFailure,
  fetchCitymotorsPage,
} from "./citymotors-client";
import {
  CitymotorsCursor,
  CitymotorsCursorSchema,
  type CitymotorsProgress,
} from "./citymotors-cursor";
import {
  citymotorsCatalogHash,
  parseCitymotorsCatalog,
  parseCitymotorsDetail,
} from "./citymotors-parser";
import {
  citymotorsSnapshot,
  validateCitymotorsSnapshot,
  type CitymotorsCanonicalVehicle,
} from "./citymotors-transform";
import {
  CITYMOTORS_CATALOG,
  CITYMOTORS_YARD,
  type CitymotorsYard,
} from "./citymotors-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface CitymotorsOptions<E, R> {
  startCursor?: CitymotorsCursor;
  /** One unit is one serial native catalog, donor detail or closing GET. */
  maxPages?: number;
  onBatch: (
    vehicles: CitymotorsCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: CitymotorsYard[]) => Effect.Effect<void, E, R>;
}
export interface CitymotorsStreamResult {
  source: "citymotors";
  status: ConnectorChunkStatus;
  cursor: CitymotorsCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
export const CITYMOTORS_CHUNK_DEADLINE_MS = 180_000;
const CITYMOTORS_REQUEST_GAP_MS = 1_600;
/** One GET at its full budget plus the serialized gap that follows it. */
export const CITYMOTORS_WORST_CASE_REQUEST_MS =
  CITYMOTORS_REQUEST_BUDGET_MS + CITYMOTORS_REQUEST_GAP_MS;
/**
 * Time kept after the last GET for census validation, onYards and onBatch,
 * which run inside the same chunk deadline.
 */
export const CITYMOTORS_COMPLETION_RESERVE_MS = 10_000;
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new CitymotorsProviderError({ operation, cause }),
  });
function nextUrl(cursor: CitymotorsProgress): string {
  if (cursor.phase === "catalog")
    return cursor.pages.at(-1)?.next ?? CITYMOTORS_CATALOG;
  if (cursor.phase === "details") {
    const post = cursor.pages.flatMap((page) => page.posts)[
      cursor.records.length
    ];
    if (!post) throw new Error("City Motors next native donor is missing");
    return post.url;
  }
  const page = cursor.pages[cursor.closing];
  if (!page) throw new Error("City Motors next catalog closing is missing");
  return page.url;
}
function advance(cursor: CitymotorsProgress, raw: string): CitymotorsProgress {
  switch (cursor.phase) {
    case "catalog": {
      const page = parseCitymotorsCatalog(raw, nextUrl(cursor));
      const pages = [...cursor.pages, page];
      return CitymotorsCursor.checkpoint(
        page.next === null
          ? { ...cursor, phase: "details", pages, records: [] }
          : { ...cursor, pages },
      );
    }
    case "details": {
      const posts = cursor.pages.flatMap((page) => page.posts);
      const post = posts[cursor.records.length];
      if (!post) throw new Error("City Motors native donor context is missing");
      const records = [...cursor.records, parseCitymotorsDetail(raw, post)];
      return CitymotorsCursor.checkpoint(
        records.length === posts.length
          ? { ...cursor, phase: "closing", records, closing: 0 }
          : { ...cursor, records },
      );
    }
    case "closing": {
      const expected = cursor.pages[cursor.closing];
      if (!expected)
        throw new Error("City Motors native closing context is missing");
      const actual = parseCitymotorsCatalog(raw, expected.url);
      // Required source population/order and literal pagination must remain stable.
      // Optional photo changes are nullable metadata, never census failures.
      const identity = (page: typeof expected) => ({
        page: page.page,
        lastPage: page.lastPage,
        next: page.next,
        posts: page.posts.map(({ url, title }) => ({ url, title })),
      });
      if (
        JSON.stringify(identity(expected)) !== JSON.stringify(identity(actual))
      )
        throw new Error(
          "City Motors closing catalog changed its ordered donor population or pagination; restart after inspecting native drift",
        );
      const changed = new Set(
        expected.posts
          .filter(
            (post, index) => post.imageUrl !== actual.posts[index]?.imageUrl,
          )
          .map((post) => post.url),
      );
      const pages = cursor.pages.map((page, index) => {
        if (index !== cursor.closing || changed.size === 0) return page;
        const value = {
          ...page,
          posts: page.posts.map((post) =>
            changed.has(post.url) ? { ...post, imageUrl: null } : post,
          ),
        };
        return { ...value, hash: citymotorsCatalogHash(value) };
      });
      const records = cursor.records.map((record) =>
        changed.has(record.post.url)
          ? { ...record, post: { ...record.post, imageUrl: null } }
          : record,
      );
      return CitymotorsCursor.checkpoint({
        ...cursor,
        pages,
        records,
        closing: cursor.closing + 1,
      });
    }
  }
}
export function streamCitymotorsInventoryWithRequestGate<E, R>(
  options: CitymotorsOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 8;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 32)
      return yield* new CitymotorsProviderError({
        operation: "request budget",
        cause: "Use an integer native GET budget from 1 to 32",
      });
    let cursor = yield* attempt("checkpoint", () =>
      CitymotorsCursorSchema.parse(
        options.startCursor ?? CitymotorsCursor.initial,
      ),
    );
    const summary: CitymotorsStreamResult = {
      source: "citymotors",
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
    const started = Date.now();
    const requestFits = () =>
      Date.now() -
        started +
        CITYMOTORS_WORST_CASE_REQUEST_MS +
        CITYMOTORS_COMPLETION_RESERVE_MS <=
      CITYMOTORS_CHUNK_DEADLINE_MS;
    while (summary.pagesProcessed < maxPages && cursor.phase !== "complete") {
      if (!requestFits()) break;
      const current: CitymotorsProgress = cursor;
      const url: string = yield* attempt("next native control", (): string =>
        nextUrl(current),
      );
      // The slow origin occasionally stalls or answers 5xx. Such a GET is sent
      // once more if a full request still fits. If it still fails, a chunk that
      // already validated pages returns that checkpoint so the next chunk
      // resumes there; one that has not fails without advancing.
      let fetched = yield* Effect.either(fetchCitymotorsPage(url, gate));
      if (
        Either.isLeft(fetched) &&
        fetched.left instanceof CitymotorsTransientFailure &&
        requestFits()
      )
        fetched = yield* Effect.either(fetchCitymotorsPage(url, gate));
      if (Either.isLeft(fetched)) {
        const failure = fetched.left;
        if (failure instanceof CitymotorsProviderError)
          return yield* Effect.fail(failure);
        if (summary.pagesProcessed > 0) break;
        return yield* new CitymotorsProviderError({
          operation: url,
          cause: failure.cause,
        });
      }
      const raw: string = fetched.right;
      const next: CitymotorsProgress = yield* attempt(
        "native control " + url,
        (): CitymotorsProgress => advance(current, raw),
      );
      summary.pagesProcessed++;
      if (next.phase === "closing" && next.closing === next.pages.length) {
        const snapshot = yield* attempt("complete native donor census", () => {
          const result = citymotorsSnapshot(next.records);
          validateCitymotorsSnapshot(result);
          return result;
        });
        summary.count = snapshot.vehicles.length;
        summary.accounting = { ...snapshot.accounting };
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = snapshot.accounting.recordsRejected
          ? [
              "City Motors retained all required identity rejects and their valid VIN presence; optional conflicts remain null.",
            ]
          : [];
        if (options.onYards) yield* options.onYards([{ ...CITYMOTORS_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        cursor = { source: "citymotors", version: 1, phase: "complete" };
      } else cursor = next;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies CitymotorsStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: CITYMOTORS_CHUNK_DEADLINE_MS,
      onTimeout: () =>
        new CitymotorsProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamCitymotorsInventory<E, R>(
  options: CitymotorsOptions<E, R>,
) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep(CITYMOTORS_REQUEST_GAP_MS)));
  return streamCitymotorsInventoryWithRequestGate(options, gate);
}
