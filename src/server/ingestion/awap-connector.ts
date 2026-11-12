import { Effect } from "effect";
import type {
  ConnectorChunkAccounting,
  ConnectorChunkStatus,
} from "./connector-chunk";
import { AwapProviderError, fetchAwapPage } from "./awap-client";
import {
  AWAP_MAX_REQUESTS,
  AwapCursor,
  AwapCursorSchema,
  type AwapProgress,
} from "./awap-cursor";
import {
  awapPageHash,
  parseAwapIdentity,
  parseAwapPage,
  type AwapRecord,
} from "./awap-parser";
import {
  awapSnapshot,
  validateAwapSnapshot,
  type AwapCanonicalVehicle,
} from "./awap-transform";
import {
  AWAP_ABOUT,
  AWAP_CATALOG,
  AWAP_YARD,
  type AwapYard,
} from "./awap-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

interface AwapOptions<E, R> {
  startCursor?: AwapCursor;
  /** One request unit is one serial native About, listing or closing GET. */
  maxPages?: number;
  onBatch: (vehicles: AwapCanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: AwapYard[]) => Effect.Effect<void, E, R>;
}
export interface AwapStreamResult {
  source: "awap";
  status: ConnectorChunkStatus;
  cursor: AwapCursor;
  count: number;
  pagesProcessed: number;
  errors: string[];
  warnings: string[];
  observedVins: string[];
  accounting: ConnectorChunkAccounting;
}
const attempt = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new AwapProviderError({ operation, cause }),
  });
function nextUrl(cursor: Exclude<AwapCursor, { phase: "complete" }>): string {
  if (cursor.phase === "identity") return AWAP_ABOUT;
  if (cursor.phase === "catalog")
    return cursor.pages.at(-1)?.next ?? AWAP_CATALOG;
  const page = cursor.pages[cursor.closing];
  if (!page) throw new Error("AWAP next native closing control is missing");
  return page.url;
}
const requiredIdentity = (record: AwapRecord) => ({
  detailsUrl: record.detailsUrl,
  title: record.title,
  vinClaims: record.vinClaims,
  year: record.year,
  make: record.make,
  model: record.model,
});
function advance(
  cursor: Exclude<AwapCursor, { phase: "complete" }>,
  raw: string,
): AwapProgress {
  if (cursor.phase === "identity") {
    parseAwapIdentity(raw);
    return AwapCursor.begin();
  }
  const page = parseAwapPage(raw, nextUrl(cursor));
  if (cursor.phase === "catalog") {
    const pages = [...cursor.pages, page];
    return AwapCursor.checkpoint(
      page.next === null
        ? { ...cursor, phase: "closing", pages, closing: 0 }
        : { ...cursor, pages },
    );
  }
  const expected = cursor.pages[cursor.closing];
  if (!expected) throw new Error("AWAP native closing context is missing");
  const identity = (value: typeof page) => ({
    url: value.url,
    page: value.page,
    total: value.total,
    next: value.next,
    records: value.records.map(requiredIdentity),
  });
  if (JSON.stringify(identity(expected)) !== JSON.stringify(identity(page)))
    throw new Error(
      "AWAP closing catalog changed its ordered donor identities, count or pagination; inspect source drift and restart",
    );
  const records = expected.records.map((record, index) => {
    const actual = page.records[index];
    if (!actual) throw new Error("AWAP closing donor binding is missing");
    return {
      ...record,
      skuClaim: record.skuClaim === actual.skuClaim ? record.skuClaim : null,
      color: record.color === actual.color ? record.color : null,
      imageUrl: record.imageUrl === actual.imageUrl ? record.imageUrl : null,
      engine: record.engine === actual.engine ? record.engine : null,
      transmission:
        record.transmission === actual.transmission
          ? record.transmission
          : null,
    };
  });
  const changed = { ...expected, records };
  const pages = cursor.pages.map((value, index) =>
    index === cursor.closing
      ? { ...changed, hash: awapPageHash(changed) }
      : value,
  );
  return AwapCursor.checkpoint({
    ...cursor,
    pages,
    closing: cursor.closing + 1,
  });
}
export function streamAwapInventoryWithRequestGate<E, R>(
  options: AwapOptions<E, R>,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const maxPages = options.maxPages ?? 8;
    if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 8)
      return yield* new AwapProviderError({
        operation: "request budget",
        cause: "Use an integer native GET budget from 1 to 8",
      });
    let cursor = yield* attempt("checkpoint", () =>
      AwapCursorSchema.parse(options.startCursor ?? AwapCursor.initial),
    );
    const summary: AwapStreamResult = {
      source: "awap",
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
    const started = Date.now();
    while (cursor.phase !== "complete") {
      if (
        cursor.phase === "closing" &&
        cursor.closing === cursor.pages.length
      ) {
        const current = cursor;
        const snapshot = yield* attempt("complete native donor census", () => {
          const result = awapSnapshot(
            current.pages.flatMap((page) => page.records),
          );
          validateAwapSnapshot(result);
          return result;
        });
        if (options.onYards) yield* options.onYards([{ ...AWAP_YARD }]);
        yield* options.onBatch(
          snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
        );
        summary.count = snapshot.vehicles.length;
        summary.accounting = { ...snapshot.accounting };
        summary.observedVins = [...snapshot.observedVins];
        summary.warnings = snapshot.accounting.recordsRejected
          ? [
              "AWAP retained all required-field rejects and independently valid VIN presence; optional conflicts remain null.",
            ]
          : [];
        cursor = { source: "awap", version: 1, phase: "complete" };
        break;
      }
      if (summary.pagesProcessed >= maxPages || Date.now() - started > 150_000)
        break;
      const current = cursor;
      const used =
        current.phase === "identity"
          ? 0
          : 1 +
            current.pages.length +
            (current.phase === "closing" ? current.closing : 0);
      if (used >= AWAP_MAX_REQUESTS)
        return yield* new AwapProviderError({
          operation: "total request budget",
          cause: "Native census exceeded the finite request limit",
        });
      const url = yield* attempt("next native control", () => nextUrl(current));
      const raw = yield* fetchAwapPage(url, gate);
      cursor = yield* attempt("native control " + url, () =>
        advance(current, raw),
      );
      summary.pagesProcessed++;
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
    } satisfies AwapStreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new AwapProviderError({
          operation: "chunk deadline",
          cause:
            "Three-minute limit exceeded; retain the last validated checkpoint",
        }),
    }),
  );
}
export function streamAwapInventory<E, R>(options: AwapOptions<E, R>) {
  const gate: ProviderRequestGate = (request) =>
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis")));
  return streamAwapInventoryWithRequestGate(options, gate);
}
