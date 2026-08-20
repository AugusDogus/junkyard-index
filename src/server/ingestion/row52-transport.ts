import { Effect, Schema } from "effect";
import { API_ENDPOINTS } from "~/lib/constants";
import type { Row52ODataResponse } from "~/lib/types";
import { fetchProviderJson } from "./provider-http-client";

const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504] as const;

function row52ODataResponseSchema<T, I, R>(itemSchema: Schema.Schema<T, I, R>) {
  return Schema.Struct({
    "@odata.context": Schema.String,
    "@odata.count": Schema.optional(Schema.Number),
    value: Schema.Array(itemSchema),
  });
}

type Row52FetchOptions = {
  timeoutMs: number;
  retryLimit: number;
  retryBaseDelayMs: number;
  retryableStatusCodes?: ReadonlyArray<number>;
};

export function fetchRow52OData<T, I, R>(
  params: {
    endpoint: string;
    queryString: string;
    itemSchema: Schema.Schema<T, I, R>;
  } & Row52FetchOptions,
): Effect.Effect<Row52ODataResponse<T>, Error, R> {
  const url = `${API_ENDPOINTS.ROW52_BASE}${params.endpoint}${params.queryString}`;

  return fetchProviderJson({
    url,
    context: params.endpoint,
    schema: row52ODataResponseSchema(params.itemSchema),
    headers: { Accept: "application/json" },
    retry: {
      timeoutMs: params.timeoutMs,
      retryLimit: params.retryLimit,
      retryBaseDelayMs: params.retryBaseDelayMs,
      retryableStatusCodes:
        params.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES,
      retryNetworkErrors: false,
      jitter: false,
    },
    responseError: (response) =>
      new Error(`Row52 API error: ${response.status}`),
  }).pipe(
    Effect.map((data) => ({
      "@odata.context": data["@odata.context"],
      "@odata.count": data["@odata.count"],
      value: [...data.value],
    })),
  );
}
