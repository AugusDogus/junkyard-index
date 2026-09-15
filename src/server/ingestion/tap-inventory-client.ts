import { Effect, Schema } from "effect";
import type { IngestionSource } from "~/lib/ingestion-source";
import {
  fetchProviderText,
  type ProviderRetryPolicy,
} from "./provider-http-client";

const TAP_RETRY_POLICY = {
  retryLimit: 2,
  retryBaseDelayMs: 1_000,
  retryNetworkErrors: false,
  jitter: false,
} satisfies Partial<ProviderRetryPolicy>;

export interface TapInventoryStoreConfig {
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

export interface TapInventorySiteConfig<
  Source extends IngestionSource = IngestionSource,
> {
  source: Source;
  siteName: string;
  inventoryPageUrl: string;
  expectedPluginPath: string;
  partsPricelistPath: string;
  storeLocations: Record<string, TapInventoryStoreConfig>;
}

function tapRequest<T, I, R>(params: {
  url: string;
  context: string;
  schema: Schema.Schema<T, I, R>;
  formData: Record<string, string>;
}): Effect.Effect<T, Error, R> {
  return fetchProviderText({
    url: params.url,
    context: params.context,
    method: "POST",
    body: new URLSearchParams(params.formData).toString(),
    headers: {
      "User-Agent": "JunkyardIndex/1.0",
      Accept: "application/json, text/html;q=0.9, */*;q=0.8",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: params.url,
    },
    retry: TAP_RETRY_POLICY,
    responseError: (response) =>
      new Error(`${params.context} API error: ${response.status}`),
  }).pipe(Effect.flatMap((text) => Schema.decodeUnknown(params.schema)(text)));
}

function fetchTapBootstrapHtml(url: string): Effect.Effect<string, Error> {
  return fetchProviderText({
    url,
    context: "TAP inventory page bootstrap",
    headers: {
      "User-Agent": "JunkyardIndex/1.0",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    retry: {
      retryLimit: 0,
      retryNetworkErrors: false,
      jitter: false,
    },
    responseError: (response) =>
      new Error(`TAP inventory page bootstrap error: HTTP ${response.status}`),
  });
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
  config: Pick<
    TapInventorySiteConfig,
    "inventoryPageUrl" | "expectedPluginPath"
  >,
): Effect.Effect<TapInventoryBootstrap, Error> {
  return fetchTapBootstrapHtml(config.inventoryPageUrl).pipe(
    Effect.flatMap((html) =>
      Effect.try({
        try: () => {
          const match =
            /var\s+sif_ajax_object\s*=\s*\{"sif_ajax_url":"([^"]+)","sif_ajax_nonce":"([^"]+)","sif_plugin_url":"([^"]+)"\}/.exec(
              html,
            );

          if (!match?.[1] || !match[2] || !match[3]) {
            throw new Error(
              "TAP inventory bootstrap payload not found in page HTML",
            );
          }

          if (!match[3].includes(config.expectedPluginPath)) {
            throw new Error(
              `TAP inventory bootstrap plugin mismatch: expected plugin path "${config.expectedPluginPath}" in "${match[3]}"`,
            );
          }

          return Schema.decodeUnknownSync(TapInventoryBootstrapSchema)({
            ajaxUrl: match[1],
            nonce: match[2],
            pluginUrl: match[3],
          });
        },
        catch: (cause) =>
          cause instanceof Error ? cause : new Error(String(cause)),
      }),
    ),
  );
}

export const TapInventorySearchProductSchema = Schema.Struct({
  stocknumber: Schema.String,
  iyear: Schema.String,
  make: Schema.String,
  model: Schema.String,
  vehicle_row: Schema.optional(Schema.String),
  yard_in_date: Schema.optional(Schema.String),
  color: Schema.String,
  vin: Schema.String,
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
    const label = rawLabel
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
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
