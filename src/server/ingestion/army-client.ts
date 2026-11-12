import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { ARMY_INVENTORY_URL } from "./army-yard-metadata";

export class ArmyProviderError extends Data.TaggedError("ArmyProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Army " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". Reconciliation is blocked and previous inventory is preserved. Inspect the native inventory before retrying the start checkpoint."
    );
  }
}

export function fetchArmyCatalog(gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url: ARMY_INVENTORY_URL,
      context: "Army complete inventory",
      requestGate: gate,
      headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
      retry: {
        timeoutMs: 20_000,
        retryLimit: 0,
        retryNetworkErrors: false,
        jitter: false,
      },
      onResponse: (response) => {
        if (response.status === 206 || response.headers.has("content-range"))
          throw new Error(
            "Partial Army response cannot establish completeness",
          );
        if (
          response.redirected ||
          (response.url && response.url !== ARMY_INVENTORY_URL)
        )
          throw new Error(
            "Army inventory redirected away from its verified destination",
          );
      },
    });
    if (response.status !== 200)
      return yield* Effect.fail(
        new Error("Army inventory returned HTTP " + response.status),
      );
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "text/html"
    )
      return yield* Effect.fail(
        new Error("Unexpected Army inventory content type"),
      );
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Army inventory",
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new ArmyProviderError({ operation: "catalog request", cause }),
    ),
  );
}
