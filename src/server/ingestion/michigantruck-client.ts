import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { DocumentTransport, type BrowserSessions } from "./document-transport";
import { michigantruckDetailUrl } from "./michigantruck-record";
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

/** The response and its body each get 20 seconds. The transport's status,
 * range, destination and MIME are checked before any body is read. */
async function readMichigantruckDocument(
  url: string,
  lifetime: AbortSignal,
  transport: DocumentTransport,
): Promise<string> {
  const response = await transport(url, {
    signal: AbortSignal.any([lifetime, AbortSignal.timeout(20_000)]),
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  });
  const refusal =
    response.status !== 200 || response.headers.has("content-range")
      ? "Expected complete HTTP 200, received " + response.status
      : response.redirected || (response.url && response.url !== url)
        ? "Native endpoint redirected away from its verified destination"
        : response.headers
              .get("content-type")
              ?.split(";")[0]
              ?.trim()
              .toLowerCase() !== "text/html"
          ? "Expected native HTML content type"
          : null;
  if (refusal !== null) {
    await response.body?.cancel();
    throw new Error(refusal);
  }
  return readIPullUPullResponseText(
    response,
    "Michigan Truck",
    AbortSignal.any([lifetime, AbortSignal.timeout(20_000)]),
  );
}

export function fetchMichigantruckPage(
  url: string,
  gate: ProviderRequestGate,
  transport: DocumentTransport = DocumentTransport.native,
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
    return yield* gate(
      Effect.suspend(() => {
        const lifetime = new AbortController();
        let pending: Promise<string> | null = null;
        return Effect.tryPromise({
          try: (interrupted) => {
            pending = readMichigantruckDocument(
              url,
              AbortSignal.any([lifetime.signal, interrupted]),
              transport,
            );
            return pending;
          },
          catch: (cause) => cause,
        }).pipe(
          Effect.ensuring(
            Effect.promise(async () => {
              lifetime.abort();
              // The request owns its failure; cleanup only waits for the
              // transport and body to release.
              if (pending)
                await pending.then(
                  () => undefined,
                  () => undefined,
                );
            }),
          ),
        );
      }),
    );
  }).pipe(
    Effect.mapError(
      (cause) =>
        new MichigantruckProviderError({ operation: "request " + url, cause }),
    ),
  );
}

/** Cloudflare refuses native requests from Vercel, so a browser session loads
 * every document by top-level navigation, as for Big D. */
export const acquireMichigantruckBrowser = (sessions: BrowserSessions) =>
  DocumentTransport.acquireBrowser(sessions, "navigation");
