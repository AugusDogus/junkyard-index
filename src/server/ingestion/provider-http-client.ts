import { Duration, Effect, Schedule, Schema } from "effect";
import {
  ProviderRequestError,
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504] as const;

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

function buildRetrySchedule(policy: ProviderRetryPolicy) {
  const schedule = Schedule.intersect(
    Schedule.recurs(policy.retryLimit),
    Schedule.exponential(Duration.millis(policy.retryBaseDelayMs), 2),
  );
  return policy.jitter ? schedule.pipe(Schedule.jittered) : schedule;
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
      return yield* Effect.fail(
        new RetryableHttpStatusError({
          context: params.context,
          status: response.status,
        }),
      );
    }
    return response;
  });
  const gatedRequest = params.requestGate
    ? params.requestGate(requestAttempt)
    : requestAttempt;

  return gatedRequest.pipe(
    Effect.retry(
      buildRetrySchedule(policy).pipe(
        Schedule.whileInput<Error>((error) => isRetryableError(error, policy)),
      ),
    ),
  );
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
