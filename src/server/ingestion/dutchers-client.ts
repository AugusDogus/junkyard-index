import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  DUTCHERS_MAX_BYTES,
  DUTCHERS_MAX_PAGES,
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  dutchersCatalogUrl,
} from "./dutchers-yard-metadata";

export class DutchersProviderError extends Data.TaggedError(
  "DutchersProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Dutcher ${this.operation}: ${detail}. Previous inventory and checkpoint remain preserved. Inspect the source before another request.`;
  }
}
export const dutchersValidated = <A>(operation: string, run: () => A) =>
  Effect.try({
    try: run,
    catch: (cause) => new DutchersProviderError({ operation, cause }),
  });
const allowed = new Set([
  DUTCHERS_SCOPE,
  DUTCHERS_STORE,
  ...(["DESC", "ASC"] as const).flatMap((d) =>
    Array.from({ length: DUTCHERS_MAX_PAGES }, (_, i) =>
      dutchersCatalogUrl(d, i + 1),
    ),
  ),
]);
export function fetchDutchersPage(url: string, gate: ProviderRequestGate) {
  if (!allowed.has(url))
    return Effect.fail(
      new DutchersProviderError({
        operation: url,
        cause: "URL is outside the exact Dutcher owner/store controls",
      }),
    );
  return gate(
    Effect.gen(function* () {
      const response = yield* fetchProviderResponse({
        url,
        context: "Dutcher " + url,
        redirect: "manual",
        // Every status is inspected here so the body is cancelled before stopping.
        retry: {
          timeoutMs: 25_000,
          retryLimit: 0,
          retryNetworkErrors: false,
          retryableStatusCodes: [],
        },
      });
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
        yield* Effect.tryPromise({
          try: async () => {
            await response.body?.cancel();
          },
          catch: (cause) => cause,
        });
        return yield* Effect.fail(
          new Error(
            `Expected complete unredirected HTML HTTP 200, received ${response.status}`,
          ),
        );
      }
      return yield* Effect.tryPromise({
        try: () =>
          readIPullUPullResponseText(
            response,
            "Dutcher inventory",
            AbortSignal.timeout(25_000),
            DUTCHERS_MAX_BYTES,
          ),
        catch: (cause) => cause,
      });
    }).pipe(
      // The caller's shared-host gate covers the complete body and completed gap.
      Effect.ensuring(Effect.sleep("4 seconds")),
      Effect.mapError(
        (cause) => new DutchersProviderError({ operation: url, cause }),
      ),
    ),
  );
}
