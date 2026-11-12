import { Data, Effect } from "effect";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { AERO_ORIGIN } from "./aero-yard-metadata";

export class AeroProviderError extends Data.TaggedError("AeroProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Aero " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". Reconciliation is blocked and previous inventory is preserved. Inspect the native catalog before retrying the start checkpoint."
    );
  }
}

export function fetchAeroPage(
  path: "/" | "/directions/" | "/vehicle-inventory/",
  gate: ProviderRequestGate,
) {
  const url = AERO_ORIGIN + path;
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Aero " + path,
      requestGate: gate,
      headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
      retry: {
        timeoutMs: 20_000,
        retryLimit: 2,
        retryNetworkErrors: false,
        jitter: false,
      },
      onResponse: (r) => {
        if (r.status === 206 || r.headers.has("content-range"))
          throw new Error(
            "Partial Aero response cannot establish completeness",
          );
        if (r.url && r.url !== url)
          throw new Error(
            "Aero endpoint redirected away from its verified destination",
          );
      },
    });
    if (!response.ok)
      return yield* Effect.fail(new Error("HTTP " + response.status));
    if (
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "text/html"
    )
      return yield* Effect.fail(new Error("Unexpected Aero content type"));
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Aero " + path,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new AeroProviderError({ operation: path, cause }),
    ),
  );
}
