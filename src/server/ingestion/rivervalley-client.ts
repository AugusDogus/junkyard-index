import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { RIVERVALLEY_MAX_PAGES } from "./rivervalley-cursor";
import {
  parseRivervalleyControl,
  parseRivervalleyPage,
} from "./rivervalley-parser";
import { RIVERVALLEY_CATALOG } from "./rivervalley-yard-metadata";
import type { TruckPartsCatalogRecord } from "./truck-parts-catalog";

export class RivervalleyProviderError extends Data.TaggedError(
  "RivervalleyProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "River Valley " +
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
      context: "River Valley " + url,
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
          "River Valley HTML",
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new RivervalleyProviderError({ operation: url, cause }),
    ),
  );
}

export function fetchRivervalleyPage(page: number, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    if (!Number.isSafeInteger(page) || page < 1 || page > RIVERVALLEY_MAX_PAGES)
      return yield* new RivervalleyProviderError({
        operation: "page budget",
        cause: "Expected a native page from 1 to " + RIVERVALLEY_MAX_PAGES,
      });
    const url =
      RIVERVALLEY_CATALOG.origin +
      RIVERVALLEY_CATALOG.listPath +
      "?f-condition=nw" +
      (page === 1 ? "" : "&page_number=" + page);
    const raw = yield* read(url, gate);
    return yield* ingestionValidation({
      try: () => parseRivervalleyPage(raw, page),
      catch: (cause) =>
        new RivervalleyProviderError({
          operation: "native page " + page,
          cause,
        }),
    });
  });
}

export function fetchRivervalleyControl(
  record: TruckPartsCatalogRecord,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    if (
      !/^[1-9]\d{0,11}$/.test(record.id) ||
      record.detailsUrl !==
        RIVERVALLEY_CATALOG.origin +
          RIVERVALLEY_CATALOG.detailPath +
          "?truck=" +
          record.id
    )
      return yield* new RivervalleyProviderError({
        operation: "active donor destination",
        cause: "Expected the source-linked native donor URL",
      });
    const raw = yield* read(record.detailsUrl, gate);
    return yield* ingestionValidation({
      try: () => parseRivervalleyControl(raw, record),
      catch: (cause) =>
        new RivervalleyProviderError({
          operation: "active donor " + record.id,
          cause,
        }),
    });
  });
}
