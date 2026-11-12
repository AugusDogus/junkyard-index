import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import {
  RIGHTWAY_ORIGIN,
  RIGHTWAY_SCRIPT_PATH,
} from "./rightway-yard-metadata";

export class RightwayProviderError extends Data.TaggedError(
  "RightwayProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    return (
      "Rightway " +
      this.operation +
      ": " +
      (this.cause instanceof Error ? this.cause.message : String(this.cause)) +
      ". Reconciliation is blocked and previous inventory is preserved. Inspect the native source before retrying the start checkpoint."
    );
  }
}
export function fetchRightwayPage(
  path: "/" | "/vehicle-search/" | typeof RIGHTWAY_SCRIPT_PATH,
  gate: ProviderRequestGate,
) {
  const url = RIGHTWAY_ORIGIN + path;
  return Effect.gen(function* () {
    const response = yield* fetchProviderResponse({
      url,
      context: "Rightway " + path,
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (response) => {
        const mime = response.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase();
        const expectedMimes =
          path === RIGHTWAY_SCRIPT_PATH
            ? ["application/javascript", "text/javascript"]
            : ["text/html"];
        if (
          response.status !== 200 ||
          response.headers.has("content-range") ||
          response.redirected ||
          (response.url && response.url !== url) ||
          !mime ||
          !expectedMimes.includes(mime)
        )
          throw new Error(
            "Expected complete HTTP 200 with the verified MIME and destination, received " +
              response.status,
          );
      },
    });
    return yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "Rightway " + path,
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) => new RightwayProviderError({ operation: path, cause }),
    ),
  );
}
