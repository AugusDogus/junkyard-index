import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { pickapartvaPageUrl } from "./pickapartva-yard-metadata";

export class PickapartvaProviderError extends Data.TaggedError(
  "PickapartvaProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Pick-A-Part VA ${this.operation}: ${detail}. No advanced checkpoint accepted; previous inventory is preserved. Inspect the native catalog before restarting.`;
  }
}
export function fetchPickapartvaPage(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    if (pickapartvaPageUrl(url) !== url)
      return yield* Effect.fail(new Error("Unverified native catalog URL"));
    const response = yield* fetchProviderResponse({
      url,
      context: "Pick-A-Part VA " + url,
      redirect: "manual",
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
      return yield* Effect.fail(
        new Error("Unexpected native inventory content type"),
      );
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Pick-A-Part VA catalog",
          AbortSignal.timeout(25_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new PickapartvaProviderError({ operation: url, cause }),
    ),
  );
}
