import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import type { PullsavewaYard } from "./pullsavewa-yard-metadata";

export class PullsavewaProviderError extends Data.TaggedError(
  "PullsavewaProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return `Pull & Save ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Reconciliation is blocked and previous inventory is preserved. Inspect the native yard catalog before retrying the last validated checkpoint.`;
  }
}

export function fetchPullsavewaPage(
  yard: PullsavewaYard,
  url: string,
  gate: ProviderRequestGate,
) {
  return Effect.gen(function* () {
    const terminal =
      url.startsWith(yard.inventoryUrl + "?start=") &&
      /^[1-9]\d*$/.test(url.slice((yard.inventoryUrl + "?start=").length));
    if (
      url !== yard.websiteUrl &&
      url !== yard.inventoryUrl &&
      url !== yard.inventoryUrl + "?recperpage=ALL" &&
      !terminal
    )
      return yield* Effect.fail(
        new Error("URL is outside the pinned native yard controls"),
      );
    const response = yield* fetchProviderResponse({
      url,
      context: "Pull & Save " + yard.code,
      requestGate: gate,
      headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
      retry: {
        timeoutMs: 20_000,
        retryLimit: 0,
        retryNetworkErrors: false,
        jitter: false,
      },
      onResponse: (r) => {
        if (r.status !== 200 || r.headers.has("content-range"))
          throw new Error(
            "Expected complete HTTP 200, received HTTP " + r.status,
          );
        if (r.url && r.url !== url)
          throw new Error(
            "Native yard endpoint redirected away from its verified destination",
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
      return yield* Effect.fail(new Error("Expected native HTML content type"));
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Pull & Save " + yard.code,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) =>
        new PullsavewaProviderError({
          operation: yard.code + " request",
          cause,
        }),
    ),
  );
}
