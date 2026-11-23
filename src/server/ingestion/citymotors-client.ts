import { Data, Effect } from "effect";
import { ProviderRequestError, RequestTimeoutError } from "./errors";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  citymotorsCatalogPage,
  isCitymotorsDonorUrl,
} from "./citymotors-yard-metadata";

export class CitymotorsProviderError extends Data.TaggedError(
  "CitymotorsProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `City Motors ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume from the last validated checkpoint.`;
  }
}
/**
 * One GET that timed out or answered HTTP 5xx. Neither says anything about the
 * page, so the connector may send the same GET again while it fits the chunk
 * deadline. Every other failure stays a `CitymotorsProviderError`.
 */
export class CitymotorsTransientFailure extends Data.TaggedError(
  "CitymotorsTransientFailure",
)<{ url: string; cause: unknown }> {}
class CitymotorsServerStatus extends Error {}
const isTransientCause = (cause: unknown) =>
  cause instanceof RequestTimeoutError ||
  (cause instanceof ProviderRequestError &&
    cause.cause instanceof CitymotorsServerStatus) ||
  (cause instanceof DOMException && cause.name === "TimeoutError");
/**
 * Per-GET budget for headers, body and the combined deadline. The origin can
 * take 12 to 14 seconds to first byte, so 20 seconds left too little headroom.
 */
export const CITYMOTORS_REQUEST_BUDGET_MS = 45_000;
export function fetchCitymotorsPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      const deadline = AbortSignal.timeout(CITYMOTORS_REQUEST_BUDGET_MS);
      return Effect.gen(function* () {
        if (citymotorsCatalogPage(url) === null && !isCitymotorsDonorUrl(url))
          return yield* Effect.fail(
            new Error(
              "Destination is outside the native City Motors Cars graph",
            ),
          );
        const response = yield* fetchProviderResponse({
          url,
          method: "GET",
          context: "City Motors " + url,
          redirect: "manual",
          retry: {
            timeoutMs: CITYMOTORS_REQUEST_BUDGET_MS,
            retryLimit: 0,
            retryNetworkErrors: false,
          },
          onResponse: (result) => {
            if (result.status >= 500)
              throw new CitymotorsServerStatus(
                "City Motors origin answered HTTP" + result.status,
              );
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
                "Expected complete unredirected City Motors HTTP200 text/html, received " +
                  result.status,
              );
          },
        });
        const raw = yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(
              response,
              "City Motors " + url,
              deadline,
            ),
          catch: (cause) => cause,
        });
        if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
          return yield* Effect.fail(
            new Error(
              "City Motors document exceeds 2 MiB; inspect source growth before resuming",
            ),
          );
        return raw;
      }).pipe(
        Effect.timeoutFail({
          duration: CITYMOTORS_REQUEST_BUDGET_MS,
          onTimeout: () =>
            new RequestTimeoutError({
              context: "City Motors " + url,
              cause: new Error(
                `Combined City Motors request/body deadline exceeded ${CITYMOTORS_REQUEST_BUDGET_MS / 1000} seconds`,
              ),
            }),
        }),
      );
    }),
  ).pipe(
    Effect.mapError((cause) =>
      isTransientCause(cause)
        ? new CitymotorsTransientFailure({ url, cause })
        : new CitymotorsProviderError({ operation: url, cause }),
    ),
  );
}
