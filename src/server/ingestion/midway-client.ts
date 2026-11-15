import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  MIDWAY_ORIGIN,
  midwayInventoryUrl,
  midwayMakeInventoryUrl,
  type MidwayInventoryCode,
  type MidwayYardCode,
} from "./midway-yard-metadata";

export class MidwayProviderError extends Data.TaggedError(
  "MidwayProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Midway ${this.operation}: ${detail}. No advanced checkpoint accepted; previous inventory is preserved. Inspect the native source before retrying.`;
  }
}

function page(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Midway " + url,
      requestGate: gate,
      retry: { timeoutMs: 25_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (result) => {
        if (
          result.status !== 200 ||
          result.headers.has("content-range") ||
          result.redirected ||
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
      return yield* Effect.fail(new Error("Unexpected inventory content type"));
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Midway inventory",
          AbortSignal.timeout(25_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new MidwayProviderError({ operation: url, cause }),
    ),
  );
}
export const fetchMidwayHome = (gate: ProviderRequestGate) =>
  page(MIDWAY_ORIGIN + "/", gate);
export const fetchMidwayCatalog = (
  code: MidwayYardCode,
  gate: ProviderRequestGate,
) => page(midwayInventoryUrl(code), gate);
export const fetchMidwayMakeCatalog = (
  code: MidwayInventoryCode,
  make: string,
  gate: ProviderRequestGate,
) => page(midwayMakeInventoryUrl(code, make), gate);
