import { Duration, Effect, Schedule, Schema } from "effect";
import {
  RequestTimeoutError,
  RetryableHttpStatusError,
} from "./errors";

const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504] as const;
const FETCH_TIMEOUT_MS = 30_000;
const RETRY_LIMIT = 2;
const RETRY_BASE_DELAY_MS = 1_000;

function isRetryableTapError(error: unknown): boolean {
  return (
    error instanceof RetryableHttpStatusError ||
    error instanceof RequestTimeoutError
  );
}

function buildRetrySchedule() {
  return Schedule.intersect(
    Schedule.recurs(RETRY_LIMIT),
    Schedule.exponential(Duration.millis(RETRY_BASE_DELAY_MS), 2),
  );
}

export interface TapInventorySiteConfig {
  source: "upullitne";
  siteName: string;
  inventoryPageUrl: string;
  ajaxUrl: string;
  pluginUrl: string;
  nonce: string;
  stores: Record<
    string,
    {
      locationName: string;
      locationCity: string;
      state: string;
      stateAbbr: string;
      zipCode: string;
      phone: string;
      address: string;
      lat: number;
      lng: number;
    }
  >;
}

function tapRequest<T, I, R>(params: {
  url: string;
  context: string;
  schema: Schema.Schema<T, I, R>;
  formData: Record<string, string>;
}): Effect.Effect<T, Error, R> {
  const retrySchedule = buildRetrySchedule();

  return Effect.gen(function* () {
    const body = new URLSearchParams(params.formData).toString();
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(params.url, {
          method: "POST",
          body,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: "application/json, text/html;q=0.9, */*;q=0.8",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Referer: params.url,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      catch: (cause) =>
        cause instanceof DOMException && cause.name === "TimeoutError"
          ? new RequestTimeoutError({
              context: params.context,
              cause: new Error(`Timed out after ${FETCH_TIMEOUT_MS}ms`),
            })
          : new Error(String(cause)),
    });

    if (
      DEFAULT_RETRYABLE_STATUS_CODES.includes(
        response.status as (typeof DEFAULT_RETRYABLE_STATUS_CODES)[number],
      )
    ) {
      return yield* Effect.fail(
        new RetryableHttpStatusError({
          context: params.context,
          status: response.status,
        }),
      );
    }

    if (response.status < 200 || response.status >= 300) {
      return yield* Effect.fail(
        new Error(`${params.context} API error: ${response.status}`),
      );
    }

    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause) =>
        new Error(`${params.context} returned unreadable body: ${String(cause)}`),
    });

    return yield* Schema.decodeUnknown(params.schema)(text);
  }).pipe(
    Effect.retry(
      retrySchedule.pipe(
        Schedule.whileInput<Error>((error) => isRetryableTapError(error)),
      ),
    ),
  );
}

export const TapInventorySearchProductSchema = Schema.Struct({
  s3clientid: Schema.String,
  crush_version: Schema.String,
  yard_name: Schema.String,
  yard_city: Schema.String,
  yard_state: Schema.String,
  stocknumber: Schema.String,
  istatus: Schema.String,
  location: Schema.String,
  iyear: Schema.String,
  make: Schema.String,
  model: Schema.String,
  hol_year: Schema.String,
  hol_mfr_code: Schema.String,
  hol_mfr_name: Schema.String,
  hol_model: Schema.String,
  vehicle_row: Schema.String,
  yard_date: Schema.String,
  yard_in_date: Schema.String,
  batch_number: Schema.String,
  lastupdate: Schema.String,
  color: Schema.String,
  vin: Schema.String,
  reference: Schema.String,
  mileage: Schema.String,
  image_url: Schema.String,
});

export type TapInventorySearchProduct = Schema.Schema.Type<
  typeof TapInventorySearchProductSchema
>;

const TapInventorySearchResponseSchema = Schema.Struct({
  success: Schema.Boolean,
  message: Schema.String,
  products: Schema.Array(TapInventorySearchProductSchema),
});

export type TapInventorySearchResponse = Schema.Schema.Type<
  typeof TapInventorySearchResponseSchema
>;

function decodeSearchResponse(text: string): TapInventorySearchResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`TAP inventory search returned invalid JSON: ${String(error)}`);
  }
  return Schema.decodeUnknownSync(TapInventorySearchResponseSchema)(parsed);
}

const HtmlOptionsSchema = Schema.Array(
  Schema.Struct({
    value: Schema.String,
    label: Schema.String,
    selected: Schema.Boolean,
  }),
);

function decodeHtmlOptions(text: string) {
  const optionRegex = /<option\s+value="([^"]*)"([^>]*)>([\s\S]*?)<\/option>/gi;
  const options: Array<{
    value: string;
    label: string;
    selected: boolean;
  }> = [];
  let match: RegExpExecArray | null;
  while ((match = optionRegex.exec(text)) !== null) {
    const [, value = "", attrs = "", rawLabel = ""] = match;
    const label = rawLabel.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    options.push({
      value,
      label,
      selected: /\bselected\b/i.test(attrs),
    });
  }
  return Schema.decodeUnknownSync(HtmlOptionsSchema)(options);
}

export function fetchTapOptions(params: {
  ajaxUrl: string;
  nonce: string;
  action:
    | "sif_get_stores"
    | "sif_get_locations"
    | "sif_get_makes"
    | "sif_update_models";
  extra?: Record<string, string>;
}): Effect.Effect<
  Array<{ value: string; label: string; selected: boolean }>,
  Error
> {
  return tapRequest({
    url: params.ajaxUrl,
    context: `TAP option request ${params.action}`,
    schema: Schema.String,
    formData: {
      action: params.action,
      sif_verify_request: params.nonce,
      ...(params.extra ?? {}),
    },
  }).pipe(Effect.map(decodeHtmlOptions));
}

export function searchTapInventory(params: {
  config: TapInventorySiteConfig;
  store: string;
  make: string;
  model: string;
}): Effect.Effect<TapInventorySearchResponse, Error> {
  return tapRequest({
    url: params.config.ajaxUrl,
    context: `TAP inventory search store=${params.store} make=${params.make} model=${params.model}`,
    schema: Schema.String,
    formData: {
      action: "sif_search_products",
      sif_verify_request: params.config.nonce,
      sif_form_field_store: params.store,
      sif_form_field_make: params.make,
      sif_form_field_model: params.model,
      "sorting[key]": "iyear",
      "sorting[state]": "0",
      "sorting[type]": "int",
    },
  }).pipe(Effect.map(decodeSearchResponse));
}
