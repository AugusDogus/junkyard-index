import { Duration, Effect, Schedule } from "effect";
import {
  ProviderRequestError,
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";

const FETCH_TIMEOUT_MS = 30_000;
const RETRY_LIMIT = 4;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

function isRetryableError(error: Error): boolean {
  return (
    error instanceof RetryableHttpStatusError ||
    error instanceof RequestTimeoutError ||
    error instanceof ProviderRequestError
  );
}

function buildRetrySchedule() {
  return Schedule.intersect(
    Schedule.recurs(RETRY_LIMIT),
    Schedule.exponential(Duration.millis(RETRY_BASE_DELAY_MS), 2),
  ).pipe(Schedule.jittered);
}

export interface ProviderRequestGate {
  <A, E, R>(request: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

export function fetchProviderText(params: {
  url: string;
  context: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  requestGate?: ProviderRequestGate;
  onResponse?: (response: Response) => void;
}): Effect.Effect<string, Error> {
  const requestAttempt = Effect.gen(function* () {
    const requestHeaders =
      typeof params.headers === "function" ? params.headers() : params.headers;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(params.url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
            ...requestHeaders,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      catch: (cause) =>
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? new RequestTimeoutError({
              context: params.context,
              cause: new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms`),
            })
          : new ProviderRequestError({ context: params.context, cause }),
    });
    if (params.onResponse) {
      yield* Effect.try({
        try: () => params.onResponse?.(response),
        catch: (cause) =>
          new ProviderRequestError({ context: params.context, cause }),
      });
    }

    if (RETRYABLE_STATUS_CODES.has(response.status)) {
      return yield* Effect.fail(
        new RetryableHttpStatusError({
          context: params.context,
          status: response.status,
        }),
      );
    }

    if (!response.ok) {
      return yield* Effect.fail(
        new Error(`${params.context} returned HTTP ${response.status}`),
      );
    }

    return yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new Error(
          `${params.context} returned an unreadable body: ${String(cause)}`,
        ),
    });
  });
  const gatedRequest = params.requestGate
    ? params.requestGate(requestAttempt)
    : requestAttempt;

  return gatedRequest.pipe(
    Effect.retry(
      buildRetrySchedule().pipe(
        Schedule.whileInput<Error>((error) => isRetryableError(error)),
      ),
    ),
  );
}
