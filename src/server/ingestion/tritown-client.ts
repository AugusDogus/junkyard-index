import { createHash } from "node:crypto";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { parseTritownContext, parseTritownPage } from "./tritown-parser";
import { TRITOWN_ORIGIN } from "./tritown-yard-metadata";

export class TritownProviderError extends Data.TaggedError(
  "TritownProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "TriTown " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". No advanced checkpoint accepted; retain prior inventory and inspect the native source before retrying."
    );
  }
}

function read(path: string, mime: string, gate: ProviderRequestGate) {
  const url = TRITOWN_ORIGIN + path;
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "TriTown " + path,
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (response) => {
        if (
          response.status !== 200 ||
          response.headers.has("content-range") ||
          (response.url && response.url !== url) ||
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() !== mime
        )
          throw new Error(
            "Expected complete HTTP 200 " +
              mime +
              " from the verified endpoint, received " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "TriTown " + path,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new TritownProviderError({ operation: path, cause }),
    ),
  );
}

export function fetchTritownContext(gate: ProviderRequestGate) {
  return read("/cars/", "text/html", gate).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => parseTritownContext(raw),
        catch: (cause) =>
          new TritownProviderError({
            operation: "current yard ownership",
            cause,
          }),
      }),
    ),
  );
}

export function fetchTritownPage(
  page: number,
  nonce: string,
  gate: ProviderRequestGate,
) {
  const path =
    "/?" +
    new URLSearchParams({
      "wpcm-ajax": "get_vehicle_results",
      nonce,
      page: String(page),
      sort: "power_kw-asc",
    });
  return read(path, "application/json", gate).pipe(
    Effect.flatMap((raw) =>
      Effect.try({
        try: () => ({
          ...parseTritownPage(raw, page),
          hash: createHash("sha256").update(raw).digest("hex"),
        }),
        catch: (cause) =>
          new TritownProviderError({ operation: "native page " + page, cause }),
      }),
    ),
  );
}
