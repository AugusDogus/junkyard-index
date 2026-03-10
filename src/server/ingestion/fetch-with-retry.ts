import { Effect, Schedule, Duration } from "effect";

interface FetchWithRetryOptions {
  context: string;
  logPrefix: string;
  timeoutMs: number;
  retries: number;
  baseDelayMs: number;
  retryStatusCodes?: number[];
}

function isRetryable(
  error: unknown,
  _retryStatusCodes: ReadonlySet<number>,
): boolean {
  if (
    error instanceof Error &&
    error.message.startsWith("Retryable HTTP status:")
  ) {
    return true;
  }
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return (
    error.name === "TimeoutError" ||
    error.name === "AbortError" ||
    lower.includes("aborted due to timeout") ||
    lower.includes("timeout")
  );
}

/**
 * Effect-based fetch with timeout and exponential-backoff retries.
 * Replaces the old p-retry implementation with Effect.retry + Schedule.
 */
export function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: FetchWithRetryOptions,
): Effect.Effect<Response, Error> {
  const retryStatusCodes = new Set(options.retryStatusCodes ?? []);
  const totalAttempts = options.retries + 1;

  const attempt = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs) }),
      catch: (cause) =>
        cause instanceof Error ? cause : new Error(String(cause)),
    });

    if (retryStatusCodes.has(response.status)) {
      return yield* Effect.fail(
        new Error(`Retryable HTTP status: ${response.status}`),
      );
    }

    return response;
  });

  const retrySchedule = Schedule.intersect(
    Schedule.recurs(options.retries),
    Schedule.exponential(Duration.millis(options.baseDelayMs), 2),
  );

  return attempt.pipe(
    Effect.retry(
      retrySchedule.pipe(
        Schedule.whileInput<Error>((error) =>
          isRetryable(error, retryStatusCodes),
        ),
      ),
    ),
    Effect.tapError((error) =>
      Effect.sync(() =>
        console.error(
          `${options.logPrefix} ${options.context} failed after ${totalAttempts} attempts: ${error.message}`,
        ),
      ),
    ),
  );
}

