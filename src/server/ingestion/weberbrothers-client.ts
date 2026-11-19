import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "~/server/ingestion/provider-http-client";
import { readIPullUPullResponseText } from "~/server/ingestion/ipullupull-response-text";
import { WEBERBROTHERS_MAX_RESPONSE_BYTES } from "./weberbrothers-html";
import {
  fetchTransportResponse,
  retryTransientRequest,
  transientStatusCause,
} from "./transient-request";
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
    return `Weber Brothers ${this.operation}: ${detail}. No advanced checkpoint is accepted; prior inventory is preserved. Inspect the saved native response before any retry and retain the last validated checkpoint.`;
  }
}

async function readDocument(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetchTransportResponse("Weber Brothers " + url, url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
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
    const failure = new Error(
      `Expected complete, unredirected HTTP 200 HTML from ${url}; received ${response.status}`,
      transientStatusCause("Weber Brothers " + url, response),
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

/** The gate owns fetch, complete-body consumption and pending-call cleanup.
 * Transport failures and 5xx answers get two paced retries that honor
 * Retry-After; past those the chunk ends in a durable cooldown. Deadlines are
 * not retried: three 25-second attempts would overrun the 90-second chunk. */
export function fetchWeberbrothersPage(url: string, gate: ProviderRequestGate) {
  if (weberbrothersListingPage(url) === null && !isWeberbrothersDonorUrl(url))
    return Effect.fail(
      new WeberbrothersProviderError({
        operation: "destination",
        cause: "URL is outside the native vehicle catalog",
      }),
    );
  return retryTransientRequest(
    gate(
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
          catch: (cause) => cause,
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
              new Error(
                "Combined Weber request and complete-body deadline exceeded 25 seconds",
              ),
          }),
        );
      }),
    ),
    { context: "Weber Brothers " + url, timeouts: false },
  ).pipe(
    Effect.mapError(
      (cause) => new WeberbrothersProviderError({ operation: url, cause }),
    ),
  );
}
