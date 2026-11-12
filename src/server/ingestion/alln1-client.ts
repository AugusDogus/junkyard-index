import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { parseAlln1Owner, parseAlln1Page } from "./alln1-parser";
import { ALLN1_ORIGIN, alln1PageNumber } from "./alln1-yard-metadata";

export class Alln1ProviderError extends Data.TaggedError("Alln1ProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "All-N-1 " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; previous inventory is preserved. Inspect native owner, scope and pagination before retrying from the last validated checkpoint."
    );
  }
}
function read(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "All-N-1 " + url,
      requestGate: gate,
      retry: { timeoutMs: 25_000, retryLimit: 0, retryNetworkErrors: false },
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
            "Expected complete unredirected HTTP 200 text/html from the verified endpoint, received " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "All-N-1 " + url,
          AbortSignal.timeout(25_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new Alln1ProviderError({ operation: url, cause }),
    ),
  );
}
export const fetchAlln1Owner = (gate: ProviderRequestGate) =>
  read(ALLN1_ORIGIN + "/", gate).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => parseAlln1Owner(raw),
        catch: (cause) =>
          new Alln1ProviderError({ operation: "physical ownership", cause }),
      }),
    ),
  );
export function fetchAlln1Page(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    const page = alln1PageNumber(url);
    if (page === null)
      return yield* new Alln1ProviderError({
        operation: "page destination",
        cause: "URL is not a verified unfiltered native inventory continuation",
      });
    const raw = yield* read(url, gate);
    return yield* Effect.try({
      try: () => parseAlln1Page(raw, page),
      catch: (cause) =>
        new Alln1ProviderError({
          operation: "native inventory page " + page,
          cause,
        }),
    });
  });
}
