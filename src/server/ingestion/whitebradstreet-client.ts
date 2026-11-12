import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";
import { WHITEBRADSTREET_MAX_PAGES } from "./whitebradstreet-cursor";
import {
  parseWhitebradstreetControl,
  parseWhitebradstreetPage,
} from "./whitebradstreet-parser";
import { WHITEBRADSTREET_CATALOG } from "./whitebradstreet-yard-metadata";

export class WhitebradstreetProviderError extends Data.TaggedError(
  "WhitebradstreetProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "White & Bradstreet " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted. Previously published inventory is preserved; inspect the native response and retry the last validated checkpoint."
    );
  }
}

function read(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "White & Bradstreet " + url,
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (response) => {
        if (
          response.status !== 200 ||
          response.redirected ||
          response.headers.has("content-range") ||
          (response.url && response.url !== url) ||
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== "text/html"
        )
          throw new Error(
            "Expected complete HTTP 200 text/html from the native endpoint, received HTTP " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "White & Bradstreet HTML",
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new WhitebradstreetProviderError({ operation: url, cause }),
    ),
  );
}

export function fetchWhitebradstreetPage(
  page: number,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > WHITEBRADSTREET_MAX_PAGES
    )
      return yield* new WhitebradstreetProviderError({
        operation: "page budget",
        cause: "Expected native page from 1 to " + WHITEBRADSTREET_MAX_PAGES,
      });
    const url =
      WHITEBRADSTREET_CATALOG.origin +
      WHITEBRADSTREET_CATALOG.listPath +
      "?f-condition=nw" +
      (page === 1 ? "" : "&page_number=" + page);
    const raw = yield* read(url, gate);
    return yield* Effect.try({
      try: () => parseWhitebradstreetPage(raw, page),
      catch: (cause) =>
        new WhitebradstreetProviderError({
          operation: "native page " + page,
          cause,
        }),
    });
  });
}

export function fetchWhitebradstreetControl(
  record: TruckPartsCatalogRecord,
  gate: ProviderRequestGate,
) {
  return read(record.detailsUrl, gate).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => parseWhitebradstreetControl(raw, record),
        catch: (cause) =>
          new WhitebradstreetProviderError({
            operation: "active donor " + record.id,
            cause,
          }),
      }),
    ),
  );
}
