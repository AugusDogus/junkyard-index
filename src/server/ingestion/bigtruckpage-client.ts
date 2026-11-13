import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  BIGTRUCKPAGE_YARD,
  bigtruckpageCatalogUrl,
} from "./bigtruckpage-yard-metadata";

export class BigtruckpageProviderError extends Data.TaggedError(
  "BigtruckpageProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `BigTruckPage ${this.operation}: ${detail}. No advanced checkpoint accepted; previous inventory is preserved. Inspect the native source before retrying.`;
  }
}
function page(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "BigTruckPage " + url,
      requestGate: gate,
      redirect: "manual",
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
        new Error("Unexpected native inventory content type"),
      );
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "BigTruckPage inventory",
          AbortSignal.timeout(25_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new BigtruckpageProviderError({ operation: url, cause }),
    ),
  );
}
export const fetchBigtruckpageProfile = (gate: ProviderRequestGate) =>
  page(BIGTRUCKPAGE_YARD.websiteUrl, gate);
export const fetchBigtruckpageCatalog = (
  number: number,
  gate: ProviderRequestGate,
) =>
  Number.isSafeInteger(number) && number >= 1 && number <= 500
    ? page(bigtruckpageCatalogUrl(number), gate)
    : Effect.fail(
        new BigtruckpageProviderError({
          operation: "catalog page",
          cause: "Expected page 1-500",
        }),
      );
