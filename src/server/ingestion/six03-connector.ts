import { ingestionValidation } from "./ingestion-validation";
import { Effect, RateLimiter } from "effect";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import { fetchSix03Page, Six03ProviderError } from "./six03-client";
import {
  Six03Cursor,
  Six03CursorSchema,
  type Six03Progress,
} from "./six03-cursor";
import {
  parseSix03Catalog,
  parseSix03Contact,
  parseSix03Detail,
  six03Hash,
} from "./six03-parser";
import {
  six03PendingPosts,
  six03Snapshot,
  validateSix03Snapshot,
} from "./six03-snapshot";
import type { Six03CanonicalVehicle } from "./six03-transform";
import {
  SIX03_CATALOG,
  SIX03_CONTACT,
  SIX03_ORIGIN,
  SIX03_YARD,
  type Six03Yard,
} from "./six03-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";
import { withBrowserDocumentFetch } from "./browser-document-fetch";
import { httpDocumentFetch, type DocumentFetch } from "./document-fetch";

interface Six03Options<E, R> {
  startCursor?: Six03Cursor;
  maxPages?: number;
  onBatch: (vehicles: Six03CanonicalVehicle[]) => Effect.Effect<void, E, R>;
  onYards?: (yards: Six03Yard[]) => Effect.Effect<void, E, R>;
}
export interface Six03StreamResult {
  source: "six03";
  status: "paused" | "complete" | "failed";
  cursor: Six03Cursor;
  count: number;
  pagesProcessed: number;
  accounting: ConnectorChunkAccounting;
  observedVins: string[];
  errors: string[];
  warnings: string[];
}
const parse = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new Six03ProviderError({ operation, cause }),
  });
const nativeDetailProjection = (record: ReturnType<typeof parseSix03Detail>) =>
  six03Hash([
    record.path,
    record.kind,
    record.fields,
    record.headings,
    record.image,
  ]);

/** One page is one native GET. No rows, VIN presence, yard or accounting are
 * emitted until the complete graph and all closing controls pass quality guards. */
export function streamSix03InventoryWithRequestGate<E, R>(
  options: Six03Options<E, R>,
  gate: ProviderRequestGate,
  fetchDocument: DocumentFetch = httpDocumentFetch,
) {
  return Effect.gen(function* () {
    const validated = Six03CursorSchema.safeParse(
      options.startCursor ?? Six03Cursor.initial,
    );
    const budget = options.maxPages ?? 8;
    if (
      !validated.success ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 8
    )
      return yield* Effect.fail(
        new Six03ProviderError({
          operation: "checkpoint",
          cause: "Use a validated 603 checkpoint and 1-8 native GET units",
        }),
      );
    let cursor = validated.data;
    let pagesProcessed = 0;
    let count = 0;
    let observedVins: string[] = [];
    let accounting: ConnectorChunkAccounting = {
      recordsProcessed: 0,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    };
    while (cursor.phase !== "complete" && pagesProcessed < budget) {
      const state: Six03Progress = cursor;
      switch (state.phase) {
        case "contact": {
          const html = yield* fetchSix03Page(
            SIX03_CONTACT,
            gate,
            fetchDocument,
          );
          const contact = yield* parse("native contact", () =>
            parseSix03Contact(html),
          );
          cursor = yield* parse("contact checkpoint", () =>
            Six03Cursor.checkpoint({
              ...state,
              contact,
              phase: "catalog",
              requests: state.requests + 1,
            }),
          );
          break;
        }
        case "catalog": {
          const html = yield* fetchSix03Page(
            SIX03_CATALOG,
            gate,
            fetchDocument,
          );
          const catalog = yield* parse("complete native catalog", () =>
            parseSix03Catalog(html),
          );
          cursor = yield* parse("catalog checkpoint", () =>
            Six03Cursor.checkpoint({
              ...state,
              catalog,
              phase: six03PendingPosts(catalog).length ? "details" : "closing",
              requests: state.requests + 1,
            }),
          );
          break;
        }
        case "details": {
          if (!state.catalog)
            return yield* Effect.fail(
              new Six03ProviderError({
                operation: "details",
                cause: "Native catalog evidence is missing",
              }),
            );
          const posts = six03PendingPosts(state.catalog);
          const post = posts[state.details.length];
          if (!post)
            return yield* Effect.fail(
              new Six03ProviderError({
                operation: "details",
                cause: "Native donor control is missing",
              }),
            );
          const html = yield* fetchSix03Page(
            SIX03_ORIGIN + post[0],
            gate,
            fetchDocument,
          );
          const record = yield* parse("native donor " + post[0], () =>
            parseSix03Detail(html, post),
          );
          const details = [...state.details, record];
          cursor = yield* parse("detail checkpoint", () =>
            Six03Cursor.checkpoint({
              ...state,
              details,
              phase: details.length === posts.length ? "closing" : "details",
              requests: state.requests + 1,
            }),
          );
          break;
        }
        case "closing": {
          const catalog = state.catalog;
          if (!catalog)
            return yield* Effect.fail(
              new Six03ProviderError({
                operation: "closing",
                cause: "Native catalog evidence is missing",
              }),
            );
          if (state.closing === 0) {
            const html = yield* fetchSix03Page(
              SIX03_CONTACT,
              gate,
              fetchDocument,
            );
            const actual = yield* parse("closing physical contact", () =>
              parseSix03Contact(html),
            );
            if (actual !== state.contact)
              return yield* Effect.fail(
                new Six03ProviderError({
                  operation: "closing contact",
                  cause: "Native physical identity changed; restart the census",
                }),
              );
          } else if (state.closing === 1) {
            const html = yield* fetchSix03Page(
              SIX03_CATALOG,
              gate,
              fetchDocument,
            );
            const actual = yield* parse("closing complete native catalog", () =>
              parseSix03Catalog(html),
            );
            if (
              six03Hash([
                actual.runtime,
                actual.posts,
                actual.embedded.map(nativeDetailProjection),
              ]) !==
              six03Hash([
                catalog.runtime,
                catalog.posts,
                catalog.embedded.map(nativeDetailProjection),
              ])
            )
              return yield* Effect.fail(
                new Six03ProviderError({
                  operation: "closing catalog",
                  cause:
                    "Ordered donor controls, embedded identity or local reveal graph changed; restart the census",
                }),
              );
          } else {
            const posts = six03PendingPosts(catalog);
            const index = state.closing === 2 ? 0 : posts.length - 1;
            const post = posts[index];
            const expected = state.details[index];
            if (post && expected) {
              const html = yield* fetchSix03Page(
                SIX03_ORIGIN + post[0],
                gate,
                fetchDocument,
              );
              const actual = yield* parse("closing native donor", () =>
                parseSix03Detail(html, post),
              );
              if (
                nativeDetailProjection(actual) !==
                nativeDetailProjection(expected)
              )
                return yield* Effect.fail(
                  new Six03ProviderError({
                    operation: "closing donor",
                    cause:
                      "Native first/last donor observation changed; restart the census",
                  }),
                );
            } else
              return yield* Effect.fail(
                new Six03ProviderError({
                  operation: "closing donor",
                  cause:
                    "Finite graph has no first/last native detail controls",
                }),
              );
          }
          if (state.closing === 3) {
            const snapshot = yield* parse(
              "complete native source quality",
              () => {
                const value = six03Snapshot(catalog, state.details);
                validateSix03Snapshot(value);
                return value;
              },
            );
            if (options.onYards) yield* options.onYards([{ ...SIX03_YARD }]);
            yield* options.onBatch(
              snapshot.vehicles.map((vehicle) => ({ ...vehicle })),
            );
            count = snapshot.vehicles.length;
            observedVins = snapshot.observedVins;
            accounting = snapshot.accounting;
            cursor = { source: "six03", version: 1, phase: "complete" };
          } else
            cursor = yield* parse("closing checkpoint", () =>
              Six03Cursor.checkpoint({
                ...state,
                closing: state.closing + 1,
                requests: state.requests + 1,
              }),
            );
          break;
        }
      }
      pagesProcessed++;
    }
    return {
      source: "six03",
      status: cursor.phase === "complete" ? "complete" : "paused",
      cursor,
      count,
      pagesProcessed,
      accounting,
      observedVins,
      errors: [],
      warnings: accounting.recordsRejected
        ? [
            "603 retained every required-identity rejection and quarantined all conflicting owned-donor groups. Valid rejected VINs supply presence only.",
          ]
        : [],
    } satisfies Six03StreamResult;
  }).pipe(
    Effect.timeoutFail({
      duration: "3 minutes",
      onTimeout: () =>
        new Six03ProviderError({
          operation: "chunk",
          cause: "Three-minute native GET budget exceeded",
        }),
    }),
  );
}

export function streamSix03Inventory<E, R>(options: Six03Options<E, R>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const limit = yield* RateLimiter.make({
        limit: 1,
        interval: "1600 millis",
      });
      const gate: ProviderRequestGate = (request) =>
        limit(request).pipe(Effect.ensuring(Effect.sleep("1600 millis")));
      // Cloudflare challenges datacenter IPs regardless of headers, so
      // production reads through a browser session on the yard's origin.
      return yield* withBrowserDocumentFetch(
        SIX03_ORIGIN,
        gate,
        (fetchDocument) =>
          streamSix03InventoryWithRequestGate(options, gate, fetchDocument),
      );
    }),
  );
}
