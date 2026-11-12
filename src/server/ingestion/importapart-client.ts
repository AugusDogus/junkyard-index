import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { isImportapartDonorUrl } from "./importapart-parser";
import { importapartCatalogUrl } from "./importapart-yard-metadata";

export class ImportapartProviderError extends Data.TaggedError(
  "ImportapartProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Importapart ${this.operation}: ${detail}. No advanced checkpoint accepted; previous inventory is preserved. Inspect the native source before retrying.`;
  }
}
function page(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Importapart " + url,
      requestGate: gate,
      retry: { timeoutMs: 25_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (result) => {
        if (
          result.status !== 200 ||
          result.redirected ||
          result.headers.has("content-range") ||
          (result.url && result.url !== url)
        )
          throw new Error(
            `Expected complete unredirected HTTP 200, received ${result.status}`,
          );
      },
    });
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "text/html"
    )
      return yield* Effect.fail(
        new Error("Unexpected donor inventory content type"),
      );
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Importapart inventory",
          AbortSignal.timeout(25_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new ImportapartProviderError({ operation: url, cause }),
    ),
  );
}
export const fetchImportapartCatalog = (
  number: number,
  gate: ProviderRequestGate,
) =>
  Number.isSafeInteger(number) && number >= 1 && number <= 1000
    ? page(importapartCatalogUrl(number), gate)
    : Effect.fail(
        new ImportapartProviderError({
          operation: "catalog page",
          cause: "Expected page 1-1000",
        }),
      );
export const fetchImportapartDetail = (
  url: string,
  gate: ProviderRequestGate,
) =>
  isImportapartDonorUrl(url)
    ? page(url, gate)
    : Effect.fail(
        new ImportapartProviderError({
          operation: "donor URL",
          cause: "URL is outside the native donor inventory",
        }),
      );
