import { Data, Effect } from "effect";
import { ProviderRequestError, RequestTimeoutError } from "./errors";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  parseRetryAfterMs,
  type ProviderRequestGate,
} from "./provider-http-client";
import { DocumentTransport, type DocumentResponse } from "./document-transport";
import {
  citymotorsCatalogPage,
  isCitymotorsDonorUrl,
} from "./citymotors-yard-metadata";

export class CitymotorsProviderError extends Data.TaggedError(
  "CitymotorsProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `City Motors ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume from the last validated checkpoint.`;
  }
}
/**
 * One GET that timed out, answered HTTP 5xx or was rate-limited with HTTP 429.
 * None says anything about the page, so the connector may send the same GET
 * again while it fits the chunk deadline. A rate limit carries the host's
 * parsed Retry-After (zero when absent or past, Infinity when unbounded),
 * which the connector waits out first. Every other failure stays a
 * `CitymotorsProviderError`.
 */
export class CitymotorsTransientFailure extends Data.TaggedError(
  "CitymotorsTransientFailure",
)<{
  url: string;
  cause: unknown;
  rateLimited: null | { retryAfterMs: number };
}> {}
class CitymotorsServerStatus extends Error {}
class CitymotorsRateLimited extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfter: string | null) {
    const retryAfterMs = parseRetryAfterMs(retryAfter, Date.now());
    const wait =
      retryAfterMs === 0
        ? "zero, past or unreadable, so no wait"
        : Number.isFinite(retryAfterMs)
          ? `a ${Math.ceil(retryAfterMs / 1000)} s wait`
          : "longer than any finite wait";
    super(
      "City Motors origin answered HTTP 429 " +
        (retryAfter === null
          ? "without a Retry-After header"
          : `with Retry-After ${JSON.stringify(retryAfter)} (${wait})`),
    );
    this.retryAfterMs = retryAfterMs;
  }
}
const statusCause = (cause: unknown) =>
  cause instanceof ProviderRequestError ? cause.cause : null;
const isTransientCause = (cause: unknown) =>
  cause instanceof RequestTimeoutError ||
  statusCause(cause) instanceof CitymotorsServerStatus ||
  statusCause(cause) instanceof CitymotorsRateLimited ||
  (cause instanceof DOMException && cause.name === "TimeoutError");
/**
 * Per-GET budget for headers, body and the combined deadline. The origin can
 * take 12 to 14 seconds to first byte for a page its cache does not hold, so
 * 20 seconds left too little headroom, and in a Kernel soak on November 25,
 * 2026 one donor page took longer than 28 seconds twice.
 */
export const CITYMOTORS_REQUEST_BUDGET_MS = 45_000;
/** The chunk browser's own timeout for each document. It outlasts the GET
 * budget, so a slow page ends on that budget as a transient failure that may
 * be sent once more, never as a browser error that fails the chunk. */
export const CITYMOTORS_BROWSER_REQUEST_TIMEOUT_MS =
  CITYMOTORS_REQUEST_BUDGET_MS + 5_000;

/** Why a City Motors answer is refused before its body is read, or null. */
function refusal(response: DocumentResponse, url: string): Error | null {
  if (response.status >= 500)
    return new CitymotorsServerStatus(
      `City Motors origin answered HTTP ${response.status}`,
    );
  if (response.status === 429)
    return new CitymotorsRateLimited(response.headers.get("retry-after"));
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
    return new Error(
      "Expected complete unredirected City Motors HTTP200 text/html, received " +
        response.status +
        (response.headers.get("cf-mitigated") === "challenge"
          ? " (a Cloudflare challenge)"
          : ""),
    );
  return null;
}

async function readCitymotorsDocument(
  url: string,
  signal: AbortSignal,
  documents: DocumentTransport,
): Promise<string> {
  const context = "City Motors " + url;
  let response: DocumentResponse;
  try {
    response = await documents(url, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    });
  } catch (cause) {
    throw cause instanceof DOMException && cause.name === "TimeoutError"
      ? new RequestTimeoutError({ context, cause })
      : new ProviderRequestError({ context, cause });
  }
  const refused = refusal(response, url);
  if (refused) {
    try {
      if (response.body) await response.body.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [refused, cleanup],
        refused.message +
          "; cancelling its unread response body also failed. Inspect both failures before resuming.",
      );
    }
    throw new ProviderRequestError({ context, cause: refused });
  }
  const raw = await readIPullUPullResponseText(response, context, signal);
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
    throw new Error(
      "City Motors document exceeds 2 MiB; inspect source growth before resuming",
    );
  return raw;
}

/** One City Motors document through `documents`, the chunk's browser page in
 * production and native fetch by default. */
export function fetchCitymotorsPage(
  url: string,
  gate: ProviderRequestGate,
  documents: DocumentTransport = DocumentTransport.native,
) {
  return gate(
    Effect.suspend(() => {
      if (citymotorsCatalogPage(url) === null && !isCitymotorsDonorUrl(url))
        return Effect.fail(
          new Error("Destination is outside the native City Motors Cars graph"),
        );
      // Ending the GET for any reason aborts its request and body read.
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(CITYMOTORS_REQUEST_BUDGET_MS);
      return Effect.tryPromise({
        try: (interruption) =>
          readCitymotorsDocument(
            url,
            AbortSignal.any([lifetime.signal, interruption, deadline]),
            documents,
          ),
        catch: (cause) => cause,
      }).pipe(
        Effect.ensuring(Effect.sync(() => lifetime.abort())),
        Effect.timeoutFail({
          duration: CITYMOTORS_REQUEST_BUDGET_MS,
          onTimeout: () =>
            new RequestTimeoutError({
              context: "City Motors " + url,
              cause: new Error(
                `Combined City Motors request/body deadline exceeded ${CITYMOTORS_REQUEST_BUDGET_MS / 1000} seconds`,
              ),
            }),
        }),
      );
    }),
  ).pipe(
    Effect.mapError((cause) => {
      if (!isTransientCause(cause))
        return new CitymotorsProviderError({ operation: url, cause });
      const status = statusCause(cause);
      return new CitymotorsTransientFailure({
        url,
        cause,
        rateLimited:
          status instanceof CitymotorsRateLimited
            ? { retryAfterMs: status.retryAfterMs }
            : null,
      });
    }),
  );
}
