import { Effect, Schedule } from "effect";
import {
  ProviderRequestError,
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";

/** Server errors a later attempt can plausibly clear. */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);

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

/** Error options marking a refused response as a transient server error.
 * The caller keeps its own message; only the cause classifies it. */
export function transientStatusCause(
  context: string,
  status: number,
): ErrorOptions | undefined {
  return TRANSIENT_STATUSES.has(status)
    ? {
        cause: new RetryableHttpStatusError({
          context,
          status,
          retryAfterMs: 0,
        }),
      }
    : undefined;
}

/** True when `failure` or one of its causes is a transport failure, a 5xx
 * answer or (when `timeouts`) a request deadline. Validation, redirects,
 * 403/429 and body/encoding failures are never transient. */
export function isTransientRequestFailure(
  failure: unknown,
  options: { timeouts: boolean },
): boolean {
  let current = failure;
  for (
    let depth = 0;
    depth < 8 && current !== null && current !== undefined;
    depth++
  ) {
    if (
      current instanceof RetryableHttpStatusError ||
      current instanceof ProviderRequestError
    )
      return true;
    if (
      options.timeouts &&
      (current instanceof RequestTimeoutError ||
        (current instanceof DOMException && current.name === "TimeoutError"))
    )
      return true;
    current =
      typeof current === "object" && "cause" in current
        ? current.cause
        : undefined;
  }
  return false;
}

/** Two more attempts after about two and four seconds. Retrying the gated
 * request re-enters the gate, so pacing and deadlines apply every time. */
export function retryTransientRequest<A, E, R>(
  request: Effect.Effect<A, E, R>,
  options: { timeouts: boolean },
): Effect.Effect<A, E, R> {
  return Effect.retry(request, {
    schedule: Schedule.exponential("2 seconds").pipe(
      Schedule.intersect(Schedule.recurs(2)),
    ),
    while: (error) => isTransientRequestFailure(error, options),
  });
}
