import { Clock, Duration, Effect, Schedule, Schema } from "effect";
import {
  ProviderRequestError,
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504] as const;
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

export type ProviderRetryPolicy = {
  timeoutMs: number;
  retryLimit: number;
  retryBaseDelayMs: number;
  retryableStatusCodes: ReadonlyArray<number>;
  retryNetworkErrors: boolean;
  jitter: boolean;
};

const DEFAULT_RETRY_POLICY: ProviderRetryPolicy = {
  timeoutMs: 30_000,
  retryLimit: 4,
  retryBaseDelayMs: 1_000,
  retryableStatusCodes: DEFAULT_RETRYABLE_STATUS_CODES,
  retryNetworkErrors: true,
  jitter: true,
};

export interface ProviderRequestGate {
  <A, E, R>(request: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
}

type ProviderRequestParams = {
  url: string;
  context: string;
  method?: "GET" | "POST";
  redirect?: RequestRedirect;
  body?: string;
  headers?: Record<string, string> | (() => Record<string, string>);
  requestGate?: ProviderRequestGate;
  onResponse?: (response: Response) => void;
  retry?: Partial<ProviderRetryPolicy>;
};

function resolveRetryPolicy(
  retry: Partial<ProviderRetryPolicy> | undefined,
): ProviderRetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...retry };
}

function isRetryableError(error: Error, policy: ProviderRetryPolicy): boolean {
  return (
    error instanceof RetryableHttpStatusError ||
    error instanceof RequestTimeoutError ||
    (policy.retryNetworkErrors && error instanceof ProviderRequestError)
  );
}

function parseRetryAfterMs(value: string | null, now: number): number {
  if (value === null) return 0;
  if (/^\d+$/.test(value)) {
    const delayMs = Number(value) * 1_000;
    return Number.isSafeInteger(delayMs) ? delayMs : Infinity;
  }

  let httpDate = value;
  const rfc850 =
    /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\d{2})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2}) GMT$/.exec(
      value,
    );
  const asctime =
    /^([A-Z][a-z]{2}) ([A-Z][a-z]{2}) ([ \d]\d) (\d{2}:\d{2}:\d{2}) (\d{4})$/.exec(
      value,
    );
  if (rfc850) {
    const [, weekday, day, month, shortYear, time] = rfc850;
    const futureLimit = new Date(now);
    futureLimit.setUTCFullYear(futureLimit.getUTCFullYear() + 50);
    let year =
      Math.floor(futureLimit.getUTCFullYear() / 100) * 100 + Number(shortYear);
    const formatDate = () =>
      `${weekday?.slice(0, 3)}, ${day} ${month} ${year} ${time} GMT`;
    // RFC 9110 interprets two-digit years at most 50 years in the future.
    if (Date.parse(formatDate()) > futureLimit.getTime()) year -= 100;
    httpDate = formatDate();
  } else if (asctime) {
    const [, weekday, month, day, time, year] = asctime;
    httpDate = `${weekday}, ${day?.trim().padStart(2, "0")} ${month} ${year} ${time} GMT`;
  }

  const retryAt = Date.parse(httpDate);
  // Round-trip validation rejects non-HTTP dates and normalized invalid dates.
  return Number.isNaN(retryAt) || new Date(retryAt).toUTCString() !== httpDate
    ? 0
    : Math.max(0, retryAt - now);
}

function prepareRetryDelay(delayMs: number): Effect.Effect<number> {
  return Effect.gen(function* () {
    if (!Number.isFinite(delayMs)) return yield* Effect.never;
    let remainingMs = delayMs;
    // Effect's live clock treats larger individual sleeps as infinite.
    while (remainingMs > MAX_TIMER_DELAY_MS) {
      yield* Effect.sleep(MAX_TIMER_DELAY_MS);
      remainingMs -= MAX_TIMER_DELAY_MS;
    }
    return remainingMs;
  });
}

function buildRetrySchedule(policy: ProviderRetryPolicy) {
  const schedule = Schedule.intersect(
    Schedule.recurs(policy.retryLimit),
    Schedule.exponential(Duration.millis(policy.retryBaseDelayMs), 2),
  );
  const backoff = policy.jitter ? schedule.pipe(Schedule.jittered) : schedule;
  return backoff.pipe(
    Schedule.zipRight(Schedule.identity<Error>()),
    Schedule.whileInput((error) => isRetryableError(error, policy)),
    // Apply the provider's minimum after jitter so it cannot shorten the wait.
    Schedule.modifyDelayEffect((error, delay) =>
      prepareRetryDelay(
        error instanceof RetryableHttpStatusError
          ? Math.max(Duration.toMillis(delay), error.retryAfterMs)
          : Duration.toMillis(delay),
      ).pipe(Effect.map(Duration.millis)),
    ),
  );
}

export function fetchProviderResponse(
  params: ProviderRequestParams,
): Effect.Effect<Response, Error> {
  const policy = resolveRetryPolicy(params.retry);
  const requestAttempt = Effect.gen(function* () {
    const requestHeaders =
      typeof params.headers === "function" ? params.headers() : params.headers;
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(params.url, {
          method: params.method ?? "GET",
          redirect: params.redirect,
          body: params.body,
          headers: {
            "User-Agent": DEFAULT_USER_AGENT,
            Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
            ...requestHeaders,
          },
          signal: AbortSignal.timeout(policy.timeoutMs),
        }),
      catch: (cause) =>
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? new RequestTimeoutError({
              context: params.context,
              cause: new Error(`Timed out after ${policy.timeoutMs}ms`),
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

    if (policy.retryableStatusCodes.includes(response.status)) {
      const now = yield* Clock.currentTimeMillis;
      return yield* Effect.fail(
        new RetryableHttpStatusError({
          context: params.context,
          status: response.status,
          retryAfterMs: parseRetryAfterMs(
            response.headers.get("Retry-After"),
            now,
          ),
        }),
      );
    }
    return response;
  });
  const gatedRequest = params.requestGate
    ? params.requestGate(requestAttempt)
    : requestAttempt;

  return gatedRequest.pipe(Effect.retry(buildRetrySchedule(policy)));
}

export function fetchProviderText(
  params: ProviderRequestParams & {
    responseError?: (response: Response) => Error;
  },
): Effect.Effect<string, Error> {
  return fetchProviderResponse(params).pipe(
    Effect.flatMap((response) => {
      if (!response.ok) {
        return Effect.fail(
          params.responseError?.(response) ??
            new Error(`${params.context} returned HTTP ${response.status}`),
        );
      }
      return Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) =>
          new Error(
            `${params.context} returned an unreadable body: ${String(cause)}`,
          ),
      });
    }),
  );
}

export function fetchProviderJson<A, I, R>(
  params: ProviderRequestParams & {
    schema: Schema.Schema<A, I, R>;
    responseError?: (response: Response) => Error;
  },
): Effect.Effect<A, Error, R> {
  return fetchProviderText(params).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) =>
          new Error(
            `${params.context} returned invalid JSON: ${String(cause)}`,
          ),
      }),
    ),
    Effect.flatMap((body) =>
      Schema.decodeUnknown(params.schema)(body).pipe(
        Effect.mapError(
          (cause) =>
            new Error(
              `${params.context} returned invalid data: ${String(cause)}`,
            ),
        ),
      ),
    ),
  );
}
