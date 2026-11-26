import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "~/server/ingestion/provider-http-client";
import { readIPullUPullResponseText } from "~/server/ingestion/ipullupull-response-text";
import {
  ProviderChunkClock,
  ProviderNotReadyDeferred,
} from "./provider-chunk-clock";
import { WEBERBROTHERS_MAX_RESPONSE_BYTES } from "./weberbrothers-html";
import {
  isWeberbrothersDonorUrl,
  weberbrothersListingPage,
} from "./weberbrothers-parser";

export class WeberbrothersProviderError extends Data.TaggedError(
  "WeberbrothersProviderError",
)<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Weber Brothers ${this.operation}: ${detail}. No advanced checkpoint is accepted; prior inventory is preserved. Check the named native page or parser rule before the next run.`;
  }
}

/** Weber's server intermittently answers single pages with HTTP 500, 502,
 * 503 or 504, drops or resets the connection, or stalls, and the same page
 * succeeds later. Such a GET defers instead of failing the source. Every
 * other outcome, including other 5xx statuses and DNS, TLS or refused
 * connections, stays a `WeberbrothersProviderError` and fails fast. */
const transient = (url: string, outcome: string) =>
  new ProviderNotReadyDeferred({
    provider: "Weber Brothers",
    detail: `${url} ${outcome}.`,
  });
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504]);
/** Socket codes for a connection that opened and then dropped, reset or
 * timed out (Node undici and Bun spellings). */
const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "ConnectionClosed",
  "ConnectionReset",
]);
function networkCode(error: unknown): string | null {
  for (let current = error, depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) return null;
    if ("code" in current && typeof current.code === "string")
      return current.code;
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

async function readDocument(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  }).catch((cause: unknown) => {
    const code = networkCode(cause);
    if (code === null || !TRANSIENT_NETWORK_CODES.has(code)) throw cause;
    throw transient(
      url,
      `failed before a response (${code}: ${cause instanceof Error ? cause.message : String(cause)})`,
    );
  });
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
  ) {
    const failure = TRANSIENT_STATUSES.has(response.status)
      ? transient(url, `answered HTTP ${response.status}`)
      : new Error(
          `Expected complete, unredirected HTTP 200 HTML from ${url}; received ${response.status}`,
        );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread body cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Weber Brothers " + url,
    signal,
    WEBERBROTHERS_MAX_RESPONSE_BYTES,
  );
}

/** The gate owns fetch, complete-body consumption and pending-call cleanup. */
export function fetchWeberbrothersPage(url: string, gate: ProviderRequestGate) {
  if (weberbrothersListingPage(url) === null && !isWeberbrothersDonorUrl(url))
    return Effect.fail(
      new WeberbrothersProviderError({
        operation: "destination",
        cause: "URL is outside the native vehicle catalog",
      }),
    );
  return gate(
    Effect.suspend(() => {
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(25_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readDocument(
            url,
            AbortSignal.any([lifetime.signal, deadline, interruption]),
          );
          return pending;
        },
        catch: (cause) =>
          deadline.aborted && !ProviderChunkClock.isDeferral(cause)
            ? transient(url, "did not finish within 25 seconds")
            : cause,
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            if (pending)
              await pending.then(
                () => undefined,
                () => undefined,
              );
          }),
        ),
        Effect.timeoutFail({
          duration: "25 seconds",
          onTimeout: () =>
            transient(
              url,
              "exceeded the combined 25-second request and complete-body deadline",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError((cause) =>
      ProviderChunkClock.isDeferral(cause)
        ? cause
        : new WeberbrothersProviderError({ operation: url, cause }),
    ),
  );
}
