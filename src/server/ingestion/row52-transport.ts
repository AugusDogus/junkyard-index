import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Duration, Effect, Schedule, Schema } from "effect";
import type { Row52ODataResponse } from "~/lib/types";
import { API_ENDPOINTS } from "~/lib/constants";
import { RequestTimeoutError, RetryableHttpStatusError } from "./errors";

const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504] as const;

function row52ODataResponseSchema<T, I, R>(
  itemSchema: Schema.Schema<T, I, R>,
) {
  return Schema.Struct({
    "@odata.context": Schema.String,
    "@odata.count": Schema.optional(Schema.Number),
    value: Schema.Array(itemSchema),
  });
}

function isRetryableRow52Error(error: unknown): boolean {
  return (
    error instanceof RetryableHttpStatusError ||
    error instanceof RequestTimeoutError
  );
}

interface Row52FetchOptions {
  timeoutMs: number;
  retryLimit: number;
  retryBaseDelayMs: number;
  retryableStatusCodes?: ReadonlyArray<number>;
}

export function fetchRow52OData<T, I, R>(params: {
  endpoint: string;
  queryString: string;
  itemSchema: Schema.Schema<T, I, R>;
} & Row52FetchOptions): Effect.Effect<
  Row52ODataResponse<T>,
  Error,
  HttpClient.HttpClient | R
> {
  const url = `${API_ENDPOINTS.ROW52_BASE}${params.endpoint}${params.queryString}`;
  const retryableStatusCodes =
    params.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
  const retrySchedule = Schedule.intersect(
    Schedule.recurs(params.retryLimit),
    Schedule.exponential(Duration.millis(params.retryBaseDelayMs), 2),
  );

  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeaders({
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json",
      }),
    );

    const response = yield* client.execute(request).pipe(
      Effect.raceFirst(
        Effect.sleep(Duration.millis(params.timeoutMs)).pipe(
          Effect.flatMap(() =>
            Effect.fail(
              new RequestTimeoutError({
                context: params.endpoint,
                cause: new Error(`Timed out after ${params.timeoutMs}ms`),
              }),
            ),
          ),
        ),
      ),
    );

    if (retryableStatusCodes.includes(response.status)) {
      return yield* Effect.fail(
        new RetryableHttpStatusError({
          context: params.endpoint,
          status: response.status,
        }),
      );
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new Error(`Row52 API error: ${response.status}`),
      );
    }

    const data = yield* HttpClientResponse.schemaBodyJson(
      row52ODataResponseSchema(params.itemSchema),
    )(response);

    return {
      "@odata.context": data["@odata.context"],
      "@odata.count": data["@odata.count"],
      value: [...data.value],
    };
  }).pipe(
    Effect.retry(
      retrySchedule.pipe(
        Schedule.whileInput<Error>((error) => isRetryableRow52Error(error)),
      ),
    ),
  );
}
