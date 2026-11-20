import { Data, Effect } from "effect";
import {
  ProviderRequestError,
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";
import { findCause } from "./error-cause";
import { parseRetryAfterMs } from "./provider-http-client";

/** Server errors a later attempt can plausibly clear. */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
/** Retries inside the chunk, after about two and four seconds. */
const IN_CHUNK_RETRIES = 2;
const IN_CHUNK_BACKOFF_MS = 2_000;
/** Shortest durable cooldown once the in-chunk retries are spent, so the
 * chunk is not rerun against the failing host within seconds. */
export const PROVIDER_COOLDOWN_MS = 2 * 60_000;
/** Longest durable cooldown a source waits within one run. A longer
 * Retry-After stops the source for the run instead. */
export const MAX_PROVIDER_COOLDOWN_MS = 30 * 60_000;

/** A provider kept failing transiently, or asked (Retry-After) for a longer
 * wait than a chunk can hold. The chunk returns no checkpoint; the workflow
 * sleeps durably for `retryAfterMs`, then reruns the same checkpoint. */
export class ProviderCooldownError extends Data.TaggedError(
  "ProviderCooldownError",
)<{ context: string; retryAfterMs: number; cause: unknown }> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    const wait = Number.isFinite(this.retryAfterMs)
      ? `${Math.ceil(this.retryAfterMs / 1000)} seconds`
      : "an unbounded time";
    return `${this.context} is failing transiently (${detail}). The chunk stopped without advancing its checkpoint, and published inventory is preserved; the source cools down for ${wait} before retrying the same checkpoint.`;
  }
}

/** Fetches response headers, tagging transport rejections (fetch rejects
 * DNS, reset and TLS failures with TypeError) as ProviderRequestError so
 * retries can tell them from body or parse failures. Aborts, including the
 * request deadline, and any other rejection pass through unchanged. */
export async function fetchTransportResponse(
  context: string,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (cause) {
    if (init.signal.aborted || !(cause instanceof TypeError)) throw cause;
    throw new ProviderRequestError({ context, cause });
  }
}

/** Error options marking a refused response as a transient server error,
 * carrying its Retry-After. The caller keeps its own message; only the cause
 * classifies it. */
export function transientStatusCause(
  context: string,
  response: Pick<Response, "status" | "headers">,
): ErrorOptions | undefined {
  return TRANSIENT_STATUSES.has(response.status)
    ? {
        cause: new RetryableHttpStatusError({
          context,
          status: response.status,
          retryAfterMs: parseRetryAfterMs(
            response.headers.get("Retry-After"),
            Date.now(),
          ),
        }),
      }
    : undefined;
}

/** The wait a transient failure asks for (0 without Retry-After), or null
 * when `failure` and its causes hold no transport failure, 5xx answer or
 * (when `timeouts`) request deadline. Validation, redirects, 403/429 and
 * body/encoding failures are never transient. */
function transientRetryAfterMs(
  failure: unknown,
  options: { timeouts: boolean },
): number | null {
  let current = failure;
  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth++
  ) {
    if (current instanceof RetryableHttpStatusError)
      return current.retryAfterMs;
    if (current instanceof ProviderRequestError) return 0;
    if (
      options.timeouts &&
      (current instanceof RequestTimeoutError ||
        (current instanceof DOMException && current.name === "TimeoutError"))
    )
      return 0;
    current =
      typeof current === "object" && "cause" in current
        ? current.cause
        : undefined;
  }
  return null;
}

export function isTransientRequestFailure(
  failure: unknown,
  options: { timeouts: boolean },
): boolean {
  return transientRetryAfterMs(failure, options) !== null;
}

/** Two more attempts after about two and four seconds. Retrying the gated
 * request re-enters the gate, so pacing and deadlines apply every time. A
 * failure still transient after that, or one whose Retry-After asks for more
 * than the next backoff, becomes a ProviderCooldownError: the workflow waits
 * durably instead of spending its step retries on the same host. */
export function retryTransientRequest<A, E, R>(
  request: Effect.Effect<A, E, R>,
  options: { context: string; timeouts: boolean },
): Effect.Effect<A, E | ProviderCooldownError, R> {
  const attempt = (
    retries: number,
  ): Effect.Effect<A, E | ProviderCooldownError, R> =>
    Effect.catchAll(request, (error) => {
      const retryAfterMs = transientRetryAfterMs(error, options);
      if (retryAfterMs === null) return Effect.fail(error);
      // Chunk deadlines budget for the backoff only, so a longer requested
      // wait ends the chunk now instead of being cut off by the deadline.
      const backoffMs = IN_CHUNK_BACKOFF_MS * 2 ** retries;
      if (retries >= IN_CHUNK_RETRIES || retryAfterMs > backoffMs)
        return Effect.fail(
          new ProviderCooldownError({
            context: options.context,
            retryAfterMs: Math.max(PROVIDER_COOLDOWN_MS, retryAfterMs),
            cause: error,
          }),
        );
      return Effect.sleep(backoffMs).pipe(
        Effect.zipRight(attempt(retries + 1)),
      );
    });
  return attempt(0);
}

/** Finds a cooldown through Error causes, Effect fiber failures and the
 * wrappers connectors add, so the workflow can wait instead of retrying. */
export const findProviderCooldownError = (error: unknown) =>
  findCause(
    error,
    (cause): cause is ProviderCooldownError =>
      cause instanceof ProviderCooldownError,
  );
