import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  KANDR_CONTROLS,
  KANDR_MAX_BODY_BYTES,
  KandrNative,
} from "./kandr-native";
import { KandrError, kandrBoundary } from "./kandr-contract";
import { RequestTimeoutError } from "./errors";
import {
  fetchTransportResponse,
  retryTransientRequest,
  transientStatusCause,
} from "./transient-request";

export const KANDR_REQUEST_TIMEOUT_MS = 20_000;
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const kandrRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("2500 millis"))),
  );

async function document(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetchTransportResponse("K&R " + url, url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== url) ||
    response.headers.has("content-range") ||
    response.headers.has("cf-mitigated") ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "text/html"
  ) {
    const failure = new Error(
      `Expected complete owned HTTP 200 text/html at ${url}; received HTTP ${response.status}`,
      transientStatusCause("K&R " + url, response),
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread response cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "K&R " + url,
    signal,
    KANDR_MAX_BODY_BYTES,
  );
}

/** One bounded request/body lifetime per attempt; redirects are never
 * followed. Transport failures, deadlines and 5xx answers get two paced
 * retries that honor Retry-After; past those the chunk ends in a durable
 * cooldown. Every failure becomes a KandrError that keeps its cause. */
export function readKandrPage(
  url: string,
  gate: ProviderRequestGate = kandrRequestGate,
): Effect.Effect<string, KandrError> {
  const owned = kandrBoundary("request destination", () => {
    if (url === KANDR_CONTROLS) return;
    const parsed = URL.parse(url);
    const destination = KandrNative.destination(
      url,
      parsed?.searchParams.has("more") ?? false,
    );
    if (destination.url !== url)
      throw new Error("Use the exact published native destination");
  });
  if (!owned.ok) return Effect.fail(owned.error);
  const attempt = Effect.suspend(() => {
    const lifetime = new AbortController(),
      deadline = AbortSignal.timeout(KANDR_REQUEST_TIMEOUT_MS);
    let pending: Promise<string> | null = null;
    return Effect.tryPromise({
      try: (interrupted) => {
        pending = document(
          url,
          AbortSignal.any([lifetime.signal, interrupted, deadline]),
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
        duration: "20 seconds",
        onTimeout: () =>
          new RequestTimeoutError({
            context: "K&R " + url,
            cause: "Combined request and body deadline exceeded 20 seconds",
          }),
      }),
    );
  });
  return retryTransientRequest(gate(attempt), {
    context: "K&R " + url,
    timeouts: true,
  }).pipe(
    Effect.mapError((cause) =>
      KandrError.create(
        "request/body " + url,
        cause instanceof RequestTimeoutError
          ? String(cause.cause)
          : cause instanceof Error
            ? cause.message
            : String(cause),
        cause,
      ),
    ),
  );
}
