import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { IDIPULL_ORIGIN } from "./idipull-yard-metadata";

export class IdipullProviderError extends Data.TaggedError(
  "IdipullProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Idaho Falls " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". Reconciliation is blocked and previous inventory is preserved. Inspect the native inventory before retrying the start checkpoint."
    );
  }
}

export function fetchIdipullPage(
  path: "/" | "/inventory/",
  gate: ProviderRequestGate,
) {
  const url = IDIPULL_ORIGIN + path;
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Idaho Falls " + path,
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (response) => {
        const mime = response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        if (
          response.status !== 200 ||
          response.redirected ||
          response.headers.has("content-range") ||
          (response.url && response.url !== url) ||
          mime !== "text/html"
        ) {
          throw new Error(
            "Expected complete HTTP 200 HTML at the verified destination, received " +
              response.status,
          );
        }
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Idaho Falls " + path,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new IdipullProviderError({ operation: path, cause }),
    ),
  );
}
