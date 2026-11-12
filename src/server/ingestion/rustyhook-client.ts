import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { isRustyhookDonorUrl, rustyhookListingPage } from "./rustyhook-parser";

export class RustyhookProviderError extends Data.TaggedError(
  "RustyhookProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Rusty Hook Pittsburgh ${this.operation}: ${detail}. No advanced checkpoint is accepted; previous inventory is preserved. Inspect the native source and retain the last validated checkpoint.`;
  }
}
export function fetchRustyhookPage(url: string, gate: ProviderRequestGate) {
  if (rustyhookListingPage(url) === null && !isRustyhookDonorUrl(url))
    return Effect.fail(
      new RustyhookProviderError({
        operation: "destination",
        cause: "URL is outside the bounded Pittsburgh donor catalog",
      }),
    );
  return gate(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(25_000);
      return Effect.gen(function* () {
        const response = yield* fetchProviderResponse({
          url,
          context: "Rusty Hook Pittsburgh " + url,
          redirect: "manual",
          retry: {
            timeoutMs: 25_000,
            retryLimit: 0,
            retryNetworkErrors: false,
          },
          onResponse: (result) => {
            if (
              result.status !== 200 ||
              result.redirected ||
              result.headers.has("content-range") ||
              (result.url && result.url !== url) ||
              result.headers
                .get("content-type")
                ?.split(";")[0]
                ?.trim()
                .toLowerCase() !== "text/html"
            )
              throw new Error(
                `Expected complete, unredirected HTTP 200 HTML from ${url}, received ${result.status}`,
              );
          },
        });
        return yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(
              response,
              "Rusty Hook Pittsburgh " + url,
              deadline,
            ),
          catch: (cause) => cause,
        });
      }).pipe(
        Effect.timeoutFail({
          duration: "25 seconds",
          onTimeout: () =>
            new Error(
              "Combined request and complete-body deadline exceeded 25 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new RustyhookProviderError({ operation: url, cause }),
    ),
  );
}
