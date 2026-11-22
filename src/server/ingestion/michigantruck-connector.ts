import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import {
  acquireMichigantruckBrowser,
  fetchMichigantruckPage,
  MichigantruckProviderError,
} from "./michigantruck-client";
import {
  MichigantruckCursor,
  MichigantruckCursorSchema,
} from "./michigantruck-cursor";
import { parseMichigantruckControl } from "./michigantruck-control";
import { michigantruckDocument } from "./michigantruck-html";
import {
  parseMichigantruckPage,
  MICHIGANTRUCK_MAX_PAGES,
  type MichigantruckPage,
} from "./michigantruck-parser";
import {
  transformMichigantruckRecord,
  type MichigantruckCanonicalVehicle,
  type MichigantruckRecord,
} from "./michigantruck-record";
import {
  appendMichigantruckPage,
  michigantruckProgressKey,
  validateMichigantruckCompletion,
  type MichigantruckProgress,
} from "./michigantruck-snapshot";
import {
  MICHIGANTRUCK_CATALOG,
  MICHIGANTRUCK_ORIGIN,
  MICHIGANTRUCK_YARD,
  type MichigantruckYard,
} from "./michigantruck-yard-metadata";
import type { ConnectorChunkResult } from "./connector-chunk";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  DocumentTransport,
  type BrowserOpenError,
  type BrowserSessions,
  type LazyDocumentTransport,
} from "./document-transport";
import { Config } from "./context";
import {
  ProviderChunkClock,
  type ProviderChunkWallTimeout,
} from "./provider-chunk-clock";

interface MichigantruckOptions<E, R> {
  startCursor?: MichigantruckCursor;
  /** Newly consumed catalog pages. Prefix and terminal controls are separately bounded. */
  maxPages?: number;
  onBatch: (
    vehicles: MichigantruckCanonicalVehicle[],
  ) => Effect.Effect<void, E, R>;
  onYards?: (yards: MichigantruckYard[]) => Effect.Effect<void, E, R>;
}
export type MichigantruckStreamResult = ConnectorChunkResult<
  "michigantruck",
  MichigantruckCursor
>;
const failure = (operation: string, cause: unknown) =>
  new MichigantruckProviderError({ operation, cause });
const attempt = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => failure(operation, cause),
  });

export function streamMichigantruckInventoryWithRequestGate<E, R>(
  options: MichigantruckOptions<E, R>,
  gate: ProviderRequestGate,
  transport: LazyDocumentTransport = DocumentTransport.nativeLazy,
): Effect.Effect<
  MichigantruckStreamResult,
  E | MichigantruckProviderError | BrowserOpenError | ProviderChunkWallTimeout,
  R
> {
  return Effect.gen(function* () {
    const parsed = MichigantruckCursorSchema.safeParse(
      options.startCursor ?? MichigantruckCursor.initial,
    );
    const maxPages = options.maxPages ?? 1;
    if (
      !parsed.success ||
      !Number.isSafeInteger(maxPages) ||
      maxPages < 1 ||
      maxPages > MICHIGANTRUCK_MAX_PAGES
    )
      return yield* failure(
        "checkpoint",
        "Use a validated cursor and a 1-8 new catalog page budget",
      );
    let cursor: MichigantruckCursor = parsed.data;
    const summary: MichigantruckStreamResult = {
      source: "michigantruck",
      status: "complete",
      cursor: { source: "michigantruck", phase: "complete" },
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
    if (cursor.phase === "complete") return summary;
    let requests = 0;
    const fetchPage = (url: string) =>
      Effect.gen(function* () {
        if (++requests > 32)
          return yield* failure(
            "request budget",
            "The 32-request chunk limit was reached; no advanced checkpoint returned",
          );
        const documents = yield* transport.open;
        return yield* fetchMichigantruckPage(url, gate, documents);
      });
    const contact = yield* fetchPage(MICHIGANTRUCK_ORIGIN + "/contact/");
    yield* attempt("physical ownership", () => michigantruckDocument(contact));
    let progress: MichigantruckProgress | null = null;
    let nextUrl: string | null = MICHIGANTRUCK_CATALOG;
    if (cursor.phase === "pages") {
      for (const saved of cursor.pages) {
        if (nextUrl !== saved.url)
          return yield* failure(
            "resume prefix",
            "Checkpoint URL chain differs from the source-published Next links",
          );
        const raw: string = yield* fetchPage(saved.url);
        const page: MichigantruckPage = yield* attempt("resume page", () =>
          parseMichigantruckPage(raw, (progress?.pages.length ?? 0) + 1),
        );
        if (page.hash !== saved.hash)
          return yield* failure(
            "resume prefix",
            "A retained native page payload changed; restart instead of skipping changed donors",
          );
        progress = yield* attempt(
          "resume identities",
          () => appendMichigantruckPage(progress, page, saved.url).progress,
        );
        nextUrl = page.nextUrl;
      }
      if (
        progress === null ||
        nextUrl !== cursor.nextUrl ||
        michigantruckProgressKey(progress) !== michigantruckProgressKey(cursor)
      )
        return yield* failure(
          "resume prefix",
          "Checkpoint identities or cumulative counters differ from the rebuilt native prefix",
        );
    }
    while (nextUrl !== null && summary.pagesProcessed < maxPages) {
      const url: string = nextUrl;
      const raw = yield* fetchPage(url);
      const page = yield* attempt("catalog page", () =>
        parseMichigantruckPage(raw, (progress?.pages.length ?? 0) + 1),
      );
      const snapshot = yield* attempt("catalog identities", () =>
        appendMichigantruckPage(progress, page, url),
      );
      const terminal = page.nextUrl === null;
      let nextCursor: MichigantruckCursor;
      if (terminal) {
        yield* attempt("terminal quality", () =>
          validateMichigantruckCompletion(snapshot.progress),
        );
        let verified: MichigantruckProgress | null = null;
        let verificationUrl: string | null = MICHIGANTRUCK_CATALOG;
        const records: MichigantruckRecord[] = [];
        for (const saved of snapshot.progress.pages) {
          if (verificationUrl !== saved.url)
            return yield* failure(
              "terminal prefix",
              "Retained native Next chain changed",
            );
          const savedRaw: string = yield* fetchPage(saved.url);
          const checked: MichigantruckPage = yield* attempt(
            "terminal page",
            () =>
              parseMichigantruckPage(
                savedRaw,
                (verified?.pages.length ?? 0) + 1,
              ),
          );
          if (checked.hash !== saved.hash)
            return yield* failure(
              "terminal prefix",
              "A previously consumed native payload changed; completion is blocked",
            );
          verified = yield* attempt(
            "terminal identities",
            () =>
              appendMichigantruckPage(verified, checked, saved.url).progress,
          );
          records.push(...checked.records);
          verificationUrl = checked.nextUrl;
        }
        if (
          verificationUrl !== null ||
          verified === null ||
          michigantruckProgressKey(verified) !==
            michigantruckProgressKey(snapshot.progress)
        )
          return yield* failure(
            "terminal accounting",
            "Rebuilt native traversal differs from the retained complete prefix",
          );
        const control = records.find(
          (record) =>
            transformMichigantruckRecord(record).status === "available",
        );
        if (!control)
          return yield* failure(
            "active control",
            "No valid Salvage donor is available for native detail verification",
          );
        const detail = yield* fetchPage(control.detailsUrl);
        const selectorUrl = yield* attempt("active detail", () =>
          parseMichigantruckControl(detail, control),
        );
        const selectedRaw = yield* fetchPage(selectorUrl);
        const selected = yield* attempt("Salvage bookend", () =>
          parseMichigantruckPage(selectedRaw, 1, true),
        );
        if (
          selected.total !== snapshot.progress.salvageTotal ||
          JSON.stringify(selected.records) !==
            JSON.stringify(
              records
                .filter((record) => record.condition === "Salvage")
                .slice(0, 25),
            )
        )
          return yield* failure(
            "Salvage bookend",
            "The native selected Salvage census or first donor fields changed",
          );
        nextCursor = { source: "michigantruck", phase: "complete" };
      } else {
        nextCursor = yield* attempt("checkpoint evidence", () =>
          MichigantruckCursorSchema.parse({
            source: "michigantruck",
            phase: "pages",
            nextUrl: page.nextUrl,
            ...snapshot.progress,
          }),
        );
      }
      if (terminal && options.onYards)
        yield* options.onYards([MICHIGANTRUCK_YARD]);
      if (snapshot.vehicles.length) yield* options.onBatch(snapshot.vehicles);
      progress = snapshot.progress;
      nextUrl = page.nextUrl;
      cursor = nextCursor;
      summary.count += snapshot.vehicles.length;
      summary.pagesProcessed++;
      summary.observedVins?.push(...snapshot.observedVins);
      if (summary.accounting) {
        summary.accounting.recordsProcessed +=
          snapshot.accounting.recordsProcessed;
        summary.accounting.recordsExcluded +=
          snapshot.accounting.recordsExcluded;
        summary.accounting.recordsRejected +=
          snapshot.accounting.recordsRejected;
        summary.accounting.duplicateVehicles +=
          snapshot.accounting.duplicateVehicles;
      }
    }
    return {
      ...summary,
      cursor,
      status: cursor.phase === "complete" ? "complete" : "paused",
      warnings: summary.accounting?.recordsRejected
        ? [
            "Michigan Truck rejected incomplete Salvage donors; valid rejected identities supply presence evidence only. Complete retail vehicles are separate exclusions.",
          ]
        : [],
    } satisfies MichigantruckStreamResult;
  }).pipe(
    // Waiting for the browser session lease is not provider work.
    ProviderChunkClock.deadline({
      duration: "3 minutes",
      onTimeout: () =>
        failure(
          "chunk budget",
          "Three-minute limit exceeded; no advanced checkpoint returned",
        ),
    }),
  );
}
/** At most one browser session per chunk, opened by the first request under
 * the Hyperbrowser session lease and stopped when the chunk ends. `sessions`
 * defaults to Hyperbrowser. */
export function streamMichigantruckInventory<E, R>(
  options: MichigantruckOptions<E, R>,
  sessions?: BrowserSessions,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const transport = yield* acquireMichigantruckBrowser(
        sessions ??
          DocumentTransport.hyperbrowser(
            (yield* Config).hyperbrowserApiKey,
            "michigantruck",
            "page",
          ),
      );
      const gate = yield* RateLimiter.make({
        limit: 1,
        interval: "1600 millis",
      });
      return yield* streamMichigantruckInventoryWithRequestGate(
        options,
        gate,
        transport,
      );
    }),
  );
}
