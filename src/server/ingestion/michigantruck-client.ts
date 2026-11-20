import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  fetchProviderResponse,
  type ProviderRequestGate,
} from "./provider-http-client";
import { michigantruckDetailUrl } from "./michigantruck-record";
import { httpDocumentFetch, type DocumentFetch } from "./document-fetch";
import {
  michigantruckPageUrl,
  MICHIGANTRUCK_MAX_PAGES,
} from "./michigantruck-parser";
import {
  MICHIGANTRUCK_ORIGIN,
  MICHIGANTRUCK_SALVAGE,
} from "./michigantruck-yard-metadata";

export class MichigantruckProviderError extends Data.TaggedError(
  "MichigantruckProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return `Michigan Truck ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Reconciliation is blocked and previous inventory is preserved. Inspect the native catalog and restart from a validated checkpoint.`;
  }
}
export function fetchMichigantruckPage(
  url: string,
  gate: ProviderRequestGate,
  fetchDocument: DocumentFetch = httpDocumentFetch,
) {
  return Effect.gen(function* () {
    const allowed =
      url === MICHIGANTRUCK_ORIGIN + "/contact/" ||
      url === MICHIGANTRUCK_SALVAGE ||
      michigantruckDetailUrl(url) !== null ||
      Array.from(
        { length: MICHIGANTRUCK_MAX_PAGES },
        (_, index) => index + 1,
      ).some((page) => michigantruckPageUrl(url, page));
    if (!allowed)
      return yield* Effect.fail(
        new Error(
          "Request is outside the verified native catalog/detail controls",
        ),
      );
    const response = yield* fetchProviderResponse({
      url,
      context: "Michigan Truck " + url,
      requestGate: gate,
      fetchDocument,
      headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
      retry: {
        timeoutMs: 20_000,
        retryLimit: 0,
        retryNetworkErrors: false,
        jitter: false,
      },
      onResponse: (r) => {
        if (r.status !== 200 || r.headers.has("content-range"))
          throw new Error("Expected complete HTTP 200, received " + r.status);
        if (r.url && r.url !== url)
          throw new Error(
            "Native endpoint redirected away from its verified destination",
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
          "Michigan Truck",
          AbortSignal.timeout(20_000),
        ),
      catch: (cause) => cause,
    });
  }).pipe(
    Effect.mapError(
      (cause) =>
        new MichigantruckProviderError({ operation: "request " + url, cause }),
    ),
  );
}
