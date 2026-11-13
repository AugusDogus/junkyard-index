import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  isRohnerArticleUrl,
  ROHNER_MAX_RESPONSE_BYTES,
  rohnerCatalogPage,
} from "./rohner-parser";

export class RohnerProviderError extends Data.TaggedError(
  "RohnerProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Rohner ${this.operation}: ${detail}. No advanced checkpoint is accepted; previous inventory is preserved. Inspect the native source and retain the last validated checkpoint.`;
  }
}

export function fetchRohnerPage(url: string, gate: ProviderRequestGate) {
  if (rohnerCatalogPage(url) === null && !isRohnerArticleUrl(url))
    return Effect.fail(
      new RohnerProviderError({
        operation: "destination",
        cause: "URL is outside the bounded native vehicle catalog",
      }),
    );
  return gate(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(20_000);
      return Effect.gen(function* () {
        const response = yield* fetchProviderResponse({
          url,
          context: "Rohner " + url,
          redirect: "manual",
          retry: {
            timeoutMs: 20_000,
            retryLimit: 0,
            retryNetworkErrors: false,
          },
        });
        return yield* Effect.tryPromise({
          try: async () => {
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
            ) {
              await response.body?.cancel();
              throw new Error(
                `Expected complete, unredirected HTTP 200 HTML from ${url}, received ${response.status}`,
              );
            }
            return readIPullUPullResponseText(
              response,
              "Rohner " + url,
              deadline,
              ROHNER_MAX_RESPONSE_BYTES,
            );
          },
          catch: (cause) => cause,
        });
      }).pipe(
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new Error(
              "Combined native request and complete-body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new RohnerProviderError({ operation: url, cause }),
    ),
  );
}
