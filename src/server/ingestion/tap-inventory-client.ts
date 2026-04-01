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
  baseUrl: string;
  inventoryPageUrl: string;
  ajaxUrl: string;
  pluginUrl: string;
  storeLocations: Record<
    string,
    {
      code: string;
      locationName: string;
      city: string;
      state: string;
      stateAbbr: string;
      zipCode: string;
      phone: string;
      address: string;
      lat: number;
      lng: number;
    }
  >;
  makes: string[];
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

const TapInventoryBootstrapSchema = Schema.Struct({
  ajaxUrl: Schema.String,
  nonce: Schema.String,
  pluginUrl: Schema.String,
});

export type TapInventoryBootstrap = Schema.Schema.Type<
  typeof TapInventoryBootstrapSchema
>;

export function fetchTapBootstrap(
  config: Pick<TapInventorySiteConfig, "inventoryPageUrl">,
): Effect.Effect<TapInventoryBootstrap, Error> {
  return Effect.tryPromise({
    try: async () => {
      const response = await fetch(config.inventoryPageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `TAP inventory page bootstrap error: HTTP ${response.status}`,
        );
      }

      const html = await response.text();
      const match =
        /var\s+sif_ajax_object\s*=\s*\{"sif_ajax_url":"([^"]+)","sif_ajax_nonce":"([^"]+)","sif_plugin_url":"([^"]+)"\}/.exec(
          html,
        );

      if (!match?.[1] || !match[2] || !match[3]) {
        throw new Error("TAP inventory bootstrap payload not found in page HTML");
      }

      return Schema.decodeUnknownSync(TapInventoryBootstrapSchema)({
        ajaxUrl: match[1],
        nonce: match[2],
        pluginUrl: match[3],
      });
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });
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
  hol_year: Schema.optional(Schema.String),
  hol_mfr_code: Schema.optional(Schema.String),
  hol_mfr_name: Schema.optional(Schema.String),
  hol_model: Schema.optional(Schema.String),
  vehicle_row: Schema.String,
  yard_date: Schema.String,
  yard_in_date: Schema.optional(Schema.String),
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

function decodeSearchResponse(
  text: string,
): Effect.Effect<TapInventorySearchResponse, Error> {
  return Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause) =>
      new Error(`TAP inventory search returned invalid JSON: ${String(cause)}`),
  }).pipe(
    Effect.flatMap((parsed) =>
      Schema.decodeUnknown(TapInventorySearchResponseSchema)(parsed),
    ),
  );
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

export type TapInventoryOption = ReturnType<typeof decodeHtmlOptions>[number];
export type TapStoreOption = TapInventoryOption;
export type TapInventoryStoreConfig =
  TapInventorySiteConfig["storeLocations"][string];

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
  }).pipe(Effect.map((options) => [...decodeHtmlOptions(options)]));
}

export function fetchTapStores(config: TapInventorySiteConfig) {
  return fetchTapBootstrap(config).pipe(
    Effect.flatMap((bootstrap) =>
      fetchTapOptions({
        ajaxUrl: bootstrap.ajaxUrl,
        nonce: bootstrap.nonce,
        action: "sif_get_stores",
      }),
    ),
  );
}

export function fetchTapModels(config: TapInventorySiteConfig, make: string) {
  return fetchTapBootstrap(config).pipe(
    Effect.flatMap((bootstrap) =>
      fetchTapOptions({
        ajaxUrl: bootstrap.ajaxUrl,
        nonce: bootstrap.nonce,
        action: "sif_update_models",
        extra: {
          make,
          state: "0",
        },
      }),
    ),
  );
}

export function searchTapInventory(params: {
  config: TapInventorySiteConfig;
  store: string;
  make: string;
  model: string;
}): Effect.Effect<TapInventorySearchResponse, Error> {
  return fetchTapBootstrap(params.config).pipe(
    Effect.flatMap((bootstrap) =>
      tapRequest({
        url: bootstrap.ajaxUrl,
        context: `TAP inventory search store=${params.store} make=${params.make} model=${params.model}`,
        schema: Schema.String,
        formData: {
          action: "sif_search_products",
          sif_verify_request: bootstrap.nonce,
          sif_form_field_store: params.store,
          sif_form_field_make: params.make,
          sif_form_field_model: params.model,
          "sorting[key]": "iyear",
          "sorting[state]": "0",
          "sorting[type]": "int",
        },
      }).pipe(
        Effect.flatMap(decodeSearchResponse),
        Effect.flatMap((response) =>
          response.success
            ? Effect.succeed(response)
            : Effect.fail(
                new Error(
                  `TAP inventory search failed for store=${params.store} make=${params.make} model=${params.model}: ${response.message || "unknown provider error"}`,
                ),
              ),
        ),
      ),
    ),
  );
}

export const UPULLITNE_SITE_CONFIG: TapInventorySiteConfig = {
  source: "upullitne",
  siteName: "U Pull-It Nebraska",
  baseUrl: "https://upullitne.com",
  inventoryPageUrl: "https://upullitne.com/search-inventory/",
  ajaxUrl: "https://upullitne.com/wp-admin/admin-ajax.php",
  pluginUrl:
    "https://upullitne.com/wp-content/plugins/tap-inventory-search-system/",
  storeLocations: {
    LINCOLN: {
      code: "LINCOLN",
      locationName: "U Pull-It Nebraska - Lincoln",
      city: "Lincoln",
      state: "Nebraska",
      stateAbbr: "NE",
      zipCode: "68507",
      phone: "402-467-4101",
      address: "6300 N. 70th Street",
      lat: 40.8715,
      lng: -96.6256,
    },
    "OMAHA NORTH": {
      code: "OMAHA NORTH",
      locationName: "U Pull-It Nebraska - Omaha North",
      city: "Omaha",
      state: "Nebraska",
      stateAbbr: "NE",
      zipCode: "68110",
      phone: "402-342-0831",
      address: "1405 Grace Street",
      lat: 41.2801,
      lng: -95.9658,
    },
    "OMAHA SOUTH": {
      code: "OMAHA SOUTH",
      locationName: "U Pull-It Nebraska - Omaha South",
      city: "Omaha",
      state: "Nebraska",
      stateAbbr: "NE",
      zipCode: "68117",
      phone: "402-734-6029",
      address: "5600 S. 60th Street",
      lat: 41.2042,
      lng: -96.0011,
    },
    "DES MOINES": {
      code: "DES MOINES",
      locationName: "U Pull-It Nebraska - Des Moines",
      city: "Des Moines",
      state: "Iowa",
      stateAbbr: "IA",
      zipCode: "50313",
      phone: "515-528-3600",
      address: "1600 NE 44th Ave",
      lat: 41.6387,
      lng: -93.5566,
    },
  },
  makes: [
    "ACURA",
    "AUDI",
    "BMW",
    "BUICK",
    "CADILLAC",
    "CHEVROLET",
    "CHRYSLER",
    "DODGE",
    "FIAT",
    "FORD",
    "GEO",
    "GMC",
    "HONDA",
    "HUMMER",
    "HYUNDAI",
    "INFINITI",
    "ISUZU",
    "JAGUAR",
    "JEEP",
    "KIA",
    "LAND ROVER",
    "LEXUS",
    "LINCOLN",
    "MAZDA",
    "MERCEDES-BENZ",
    "MERCURY",
    "MINI",
    "MITSUBISHI",
    "NISSAN",
    "OLDSMOBILE",
    "PLYMOUTH",
    "PONTIAC",
    "SAAB",
    "SATURN",
    "SCION",
    "SUBARU",
    "SUZUKI",
    "TOYOTA",
    "VOLKSWAGEN",
    "VOLVO",
  ],
};
