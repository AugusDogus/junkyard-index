import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { isMccauleyDetailUrl } from "./mccauley-parser";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { MCCAULEY_CURRENT, MCCAULEY_INDEX } from "./mccauley-yard-metadata";

export class MccauleyProviderError extends Data.TaggedError(
  "MccauleyProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `McCauley ${this.operation}: ${detail}. No advanced checkpoint accepted; previous inventory is preserved. Inspect the native source before retrying.`;
  }
}

export function fetchMccauleyPage(url: string, gate: ProviderRequestGate) {
  return Effect.gen(function* () {
    if (
      url !== MCCAULEY_INDEX &&
      url !== MCCAULEY_CURRENT &&
      !isMccauleyDetailUrl(url)
    )
      return yield* Effect.fail(
        new Error("Destination is outside the published McCauley donor routes"),
      );
    const response = yield* fetchProviderResponse({
      url,
      context: "McCauley " + url,
      redirect: "manual",
      requestGate: gate,
      retry: { timeoutMs: 20_000, retryLimit: 0, retryNetworkErrors: false },
      onResponse: (result) => {
        if (
          result.status !== 200 ||
          result.redirected ||
          result.headers.has("content-range") ||
          (result.url && result.url !== url)
        )
          throw new Error(
            `Expected complete unredirected HTTP 200, received ${result.status}`,
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
      return yield* Effect.fail(
        new Error("Unexpected McCauley inventory content type"),
      );
    const html = yield* Effect.tryPromise({
      try: () =>
        readIPullUPullResponseText(
          response,
          "McCauley inventory",
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
    if (Buffer.byteLength(html) > 2 * 1024 * 1024)
      return yield* Effect.fail(
        new Error(
          "McCauley document exceeds the inspected 2 MiB resource limit",
        ),
      );
    return html;
  }).pipe(
    Effect.mapError(
      (cause) => new MccauleyProviderError({ operation: url, cause }),
    ),
  );
}
