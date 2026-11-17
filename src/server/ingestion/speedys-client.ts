import { ingestionValidation } from "./ingestion-validation";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { hasHttpPaginationLink } from "./provider-http-pagination";
import {
  SPEEDYS_MAX_RESPONSE_BYTES,
  speedysCatalogCategory,
  speedysDonorId,
} from "./speedys-yard-metadata";

export class SpeedysProviderError extends Data.TaggedError(
  "SpeedysProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Speedys ${this.operation}: ${detail}. Previously published inventory is preserved; no advanced checkpoint is accepted. Inspect the exact native response and resume from the last validated checkpoint.`;
  }
}
export const speedysValidated = <A>(operation: string, run: () => A) =>
  ingestionValidation({
    try: run,
    catch: (cause) => new SpeedysProviderError({ operation, cause }),
  });
export function fetchSpeedysPage(url: string, gate: ProviderRequestGate) {
  if (speedysCatalogCategory(url) === null && speedysDonorId(url) === null)
    return Effect.fail(
      new SpeedysProviderError({
        operation: "destination",
        cause: "URL is outside the supported source-owned donor graph",
      }),
    );
  return gate(
    Effect.suspend(() => {
      const signal = AbortSignal.timeout(20_000);
      return Effect.gen(function* () {
        const response = yield* fetchProviderResponse({
          url,
          context: "Speedys " + url,
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
              hasHttpPaginationLink(response.headers) ||
              (response.url && response.url !== url) ||
              response.headers
                .get("content-type")
                ?.split(";")[0]
                ?.trim()
                .toLowerCase() !== "text/html"
            )
              throw new Error(
                `Expected complete unredirected HTTP 200 HTML without HTTP pagination from ${url}; received ${response.status}`,
              );
          },
        });
        return yield* Effect.tryPromise({
          try: () =>
            readIPullUPullResponseText(
              response,
              "Speedys " + url,
              signal,
              SPEEDYS_MAX_RESPONSE_BYTES,
            ),
          catch: (cause) => cause,
        });
      }).pipe(
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new Error(
              "Combined request and complete-body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new SpeedysProviderError({ operation: url, cause }),
    ),
  );
}
