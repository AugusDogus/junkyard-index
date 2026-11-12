import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  AVIATION_CONTACT,
  AVIATION_MAKES,
  AVIATION_PARTS,
  AVIATION_ROOT,
  aviationBrowsePath,
} from "./aviation-yard-metadata";

export class AviationProviderError extends Data.TaggedError(
  "AviationProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Aviation ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

export function fetchAviationPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(20_000);
      return Effect.gen(function* () {
        if (
          ![
            AVIATION_ROOT,
            AVIATION_CONTACT,
            AVIATION_PARTS,
            AVIATION_MAKES,
          ].includes(url) &&
          !aviationBrowsePath(url, 1) &&
          !aviationBrowsePath(url, 2)
        )
          return yield* Effect.fail(
            new Error(
              "Destination is outside the finite Aviation browse graph",
            ),
          );
        const response = yield* fetchProviderResponse({
          url,
          context: "Aviation " + url,
          method: "GET",
          redirect: "manual",
          retry: {
            timeoutMs: 20_000,
            retryLimit: 0,
            retryNetworkErrors: false,
          },
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
                "Expected complete unredirected Aviation HTTP200 text/html, received " +
                  response.status,
              );
          },
        });
        return yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(response, "Aviation " + url, deadline),
          catch: (cause) => cause,
        });
      }).pipe(
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new Error("Combined request/body deadline exceeded 20 seconds"),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new AviationProviderError({ operation: url, cause }),
    ),
  );
}
