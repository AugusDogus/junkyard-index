import { Effect, Schema } from "effect";
import type { CrushMvcSiteConfig, CrushMvcYard } from "./crush-mvc-config";
import {
  fetchProviderJson,
  fetchProviderText,
  type ProviderRetryPolicy,
} from "./provider-http-client";

const CRUSH_MVC_RETRY_POLICY = {
  retryLimit: 2,
  retryBaseDelayMs: 1_000,
  retryNetworkErrors: false,
  jitter: false,
} satisfies Partial<ProviderRetryPolicy>;

const CRUSH_MVC_FORM_HEADERS = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
} as const;

const CrushMvcMakeSchema = Schema.Struct({
  makeName: Schema.String,
});

export type CrushMvcMake = Schema.Schema.Type<typeof CrushMvcMakeSchema>;

export const CrushMvcMakesResponseSchema = Schema.Array(CrushMvcMakeSchema);

export type CrushMvcMakesResponse = Schema.Schema.Type<
  typeof CrushMvcMakesResponseSchema
>;

const CrushMvcModelSchema = Schema.Struct({
  model: Schema.String,
});

export type CrushMvcModel = Schema.Schema.Type<typeof CrushMvcModelSchema>;

export const CrushMvcModelsResponseSchema = Schema.Array(CrushMvcModelSchema);

export type CrushMvcModelsResponse = Schema.Schema.Type<
  typeof CrushMvcModelsResponseSchema
>;

function yardFormFields(
  yard: CrushMvcYard | undefined,
): Record<string, string> {
  return yard?.yardId !== null && yard?.yardId !== undefined
    ? { yardId: String(yard.yardId) }
    : {};
}

export function getMakes(
  site: CrushMvcSiteConfig,
  yard?: CrushMvcYard,
): Effect.Effect<CrushMvcMakesResponse, Error> {
  const url = `${site.baseUrl}/Home/GetMakes`;
  const context = `CRUSH MVC makes site=${site.siteId}`;
  return fetchProviderJson({
    url,
    context,
    method: "POST",
    body: new URLSearchParams(yardFormFields(yard)).toString(),
    headers: CRUSH_MVC_FORM_HEADERS,
    retry: CRUSH_MVC_RETRY_POLICY,
    responseError: (response) =>
      new Error(`${context} API error: ${response.status}`),
    schema: CrushMvcMakesResponseSchema,
  });
}

export function getModels(
  site: CrushMvcSiteConfig,
  params: {
    makeName: string;
    yard?: CrushMvcYard;
  },
): Effect.Effect<CrushMvcModelsResponse, Error> {
  const url = `${site.baseUrl}/Home/GetModels`;
  const context = `CRUSH MVC models site=${site.siteId} make=${params.makeName}`;
  return fetchProviderJson({
    url,
    context,
    method: "POST",
    body: new URLSearchParams({
      ...yardFormFields(params.yard),
      makeName: params.makeName,
    }).toString(),
    headers: CRUSH_MVC_FORM_HEADERS,
    retry: CRUSH_MVC_RETRY_POLICY,
    responseError: (response) =>
      new Error(`${context} API error: ${response.status}`),
    schema: CrushMvcModelsResponseSchema,
  });
}

export interface CrushMvcSearchParams {
  makeName?: string;
  modelName?: string;
  yard?: CrushMvcYard;
}

function searchFormFields(
  params: CrushMvcSearchParams,
): Record<string, string> {
  const fields: Record<string, string> = {
    VehicleMake: params.makeName ?? "",
    VehicleModel: params.modelName ?? "",
  };
  if (params.yard?.yardId !== null && params.yard?.yardId !== undefined) {
    fields.YardId = String(params.yard.yardId);
  }
  return fields;
}

export function fetchInventoryPage(
  site: CrushMvcSiteConfig,
  params: CrushMvcSearchParams = {},
): Effect.Effect<string, Error> {
  return fetchProviderText({
    url: new URL(site.inventoryPath, site.baseUrl).toString(),
    context: `CRUSH MVC inventory site=${site.siteId}`,
    method: "POST",
    body: new URLSearchParams(searchFormFields(params)).toString(),
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: new URL(site.inventoryPath, site.baseUrl).toString(),
    },
    retry: CRUSH_MVC_RETRY_POLICY,
    responseError: (response) =>
      new Error(
        `CRUSH MVC inventory error for site=${site.siteId}: HTTP ${response.status}`,
      ),
  });
}
