import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkResult } from "./connector-chunk";
import {
  fetchImportapartCatalog,
  fetchImportapartDetail,
  ImportapartProviderError,
} from "./importapart-client";
import {
  ImportapartCursor,
  ImportapartCursorSchema,
} from "./importapart-cursor";
import {
  parseImportapartCatalog,
  parseImportapartDetail,
} from "./importapart-parser";
import {
  importapartRecordVin,
  transformImportapartRecord,
  type ImportapartCanonicalVehicle,
} from "./importapart-transform";
import {
  IMPORTAPART_YARD,
  type ImportapartYard,
} from "./importapart-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";
import { SourceValidationPolicy } from "./source-validation";

interface ImportapartOptions<E, R> {
  startCursor?: ImportapartCursor;
  maxPages?: number;
  onBatch: (
    vehicles: ImportapartCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: ImportapartYard[]) => Effect.Effect<void, E, R>;
}
export type ImportapartStreamResult = ConnectorChunkResult<
  "importapart",
  ImportapartCursor
>;
const fail = (operation: string, cause: unknown) =>
  Effect.fail(new ImportapartProviderError({ operation, cause }));
const parse = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new ImportapartProviderError({ operation, cause }),
  });

/** One unit is one native listing, donor detail or ordered catalog bookend.
 * Completion requires contiguous enumeration, unique observed VINs and stable
 * first/last pages. Optional photos never add network or admission requirements.
 */
export function streamImportapartInventoryWithRequestGate<E, R>(
  options: ImportapartOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const parsed = ImportapartCursorSchema.safeParse(
      options.startCursor ?? ImportapartCursor.initial,
    );
    const maxPages = options.maxPages ?? 16;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > 32
    )
      return yield* fail(
        "checkpoint",
        "Use a validated Importapart cursor and 1-32 request units",
      );
    let cursor: ImportapartCursor = parsed.data;
    let count = 0;
    let pagesProcessed = 0;
    const observedVins: string[] = [];
    const accounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < maxPages) {
      switch (cursor.phase) {
        case "catalog": {
          const number = cursor.pages.length + 1;
          const html = yield* fetchImportapartCatalog(number, gate);
          const snapshot = yield* parse("catalog page " + number, () =>
            parseImportapartCatalog(html, number),
          );
          const pages = [...cursor.pages, snapshot];
          const posts = pages.flatMap((page) => page.posts);
          if (
            new Set(posts.map((post) => post.url)).size !== posts.length ||
            posts.length > 10_000 ||
            pages.some((page) => page.lastPage !== snapshot.lastPage)
          )
            return yield* fail(
              "native enumeration",
              "Catalog pages changed or repeated a donor URL; restart from the first listing page",
            );
          if (options.onYards) yield* options.onYards([IMPORTAPART_YARD]);
          cursor =
            number === snapshot.lastPage
              ? {
                  source: "importapart",
                  version: 1,
                  phase: "details",
                  pages,
                  records: [],
                }
              : { source: "importapart", version: 1, phase: "catalog", pages };
          break;
        }
        case "details": {
          const posts = cursor.pages.flatMap((page) => page.posts);
          const post = posts[cursor.records.length];
          if (!post)
            return yield* fail(
              "detail checkpoint",
              "Current native donor post is missing",
            );
          const html = yield* fetchImportapartDetail(post.url, gate);
          const record = yield* parse("donor " + post.url, () =>
            parseImportapartDetail(html, post),
          );
          const vin = importapartRecordVin(record);
          if (
            vin &&
            cursor.records.some(
              (previous) => importapartRecordVin(previous) === vin,
            )
          )
            return yield* fail(
              "donor " + post.url,
              "Different native donor posts reuse a valid VIN",
            );
          const result = transformImportapartRecord(record);
          const records = [...cursor.records, record];
          const terminal = records.length === posts.length;
          if (terminal) {
            const accepted = records.filter(
              (r) => transformImportapartRecord(r).status === "available",
            ).length;
            if (
              !accepted ||
              (records.length - accepted) / records.length >
                SourceValidationPolicy.maximumRejectionRatio
            )
              return yield* fail(
                "required-field quality",
                "Required donor rejection exceeds the unchanged 10% limit or leaves no accepted donor",
              );
          }
          accounting.recordsProcessed++;
          if (result.status === "available") {
            if (options.onYards) yield* options.onYards([IMPORTAPART_YARD]);
            yield* options.onBatch([result.vehicle]);
            count++;
          } else {
            accounting.recordsRejected++;
            if (vin) observedVins.push(vin);
          }
          cursor = terminal
            ? { ...cursor, phase: "verify", records, bookend: "first" }
            : { ...cursor, records };
          break;
        }
        case "verify": {
          const expected =
            cursor.bookend === "first" ? cursor.pages[0] : cursor.pages.at(-1);
          if (!expected)
            return yield* fail(
              "bookend checkpoint",
              "Native catalog bookend is missing",
            );
          const html = yield* fetchImportapartCatalog(expected.page, gate);
          const actual = yield* parse("catalog bookend " + expected.page, () =>
            parseImportapartCatalog(html, expected.page),
          );
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            return yield* fail(
              "catalog stability",
              "Native ordered first/last inventory page changed during traversal; restart the census",
            );
          cursor =
            cursor.bookend === "first"
              ? { ...cursor, bookend: "last" }
              : { source: "importapart", version: 1, phase: "complete" };
          break;
        }
      }
      pagesProcessed++;
    }
    return {
      source: "importapart",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      errors: [],
      observedVins,
      accounting,
      warnings: accounting.recordsRejected
        ? [
            "Importapart rejected incomplete or conflicting required donor metadata; valid rejected VINs supply presence evidence only.",
          ]
        : [],
    } satisfies ImportapartStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "2 minutes",
      onTimeout: () =>
        new ImportapartProviderError({
          operation: "crawl budget",
          cause:
            "Two-minute chunk limit exceeded; no completed checkpoint returned",
        }),
    }),
  );
}
export function streamImportapartInventory<E, R>(
  options: ImportapartOptions<E, R>,
) {
  return Effect.scoped(
    RateLimiter.make({ limit: 1, interval: "1600 millis" }).pipe(
      Effect.flatMap((gate) =>
        streamImportapartInventoryWithRequestGate(options, gate),
      ),
    ),
  );
}
