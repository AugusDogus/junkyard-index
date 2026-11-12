import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { AWAP_ABOUT, awapCatalogPage } from "./awap-yard-metadata";

export class AwapProviderError extends Data.TaggedError("AwapProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `AWAP ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume from the last validated checkpoint.`;
  }
}
export function fetchAwapPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(20_000);
      return Effect.gen(function* () {
        if (url !== AWAP_ABOUT && awapCatalogPage(url) === null)
          return yield* Effect.fail(
            new Error(
              "Destination is outside the verified AWAP About and Cars at Yard graph",
            ),
          );
        const response = yield* fetchProviderResponse({
          url,
          method: "GET",
          redirect: "manual",
          context: "AWAP " + url,
          retry: {
            timeoutMs: 20_000,
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
                "Expected complete unredirected AWAP HTTP200 text/html, received HTTP " +
                  result.status,
              );
          },
        });
        const raw = yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(
              response,
              "AWAP " + url,
              deadline,
              2 * 1024 * 1024,
            ),
          catch: (cause) => cause,
        });
        if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
          return yield* Effect.fail(
            new Error(
              "AWAP document exceeds 2 MiB; inspect source growth before resuming",
            ),
          );
        return raw;
      }).pipe(
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new Error(
              "Combined AWAP request/body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new AwapProviderError({ operation: url, cause }),
    ),
  );
}
