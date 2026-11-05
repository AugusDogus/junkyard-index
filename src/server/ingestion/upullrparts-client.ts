import { Data, Effect, Schema } from "effect";
import {
  fetchProviderJson,
  type ProviderRequestGate,
} from "./provider-http-client";

export const UPULLRPARTS_INVENTORY_URL = "https://upullrparts.com/inventory/";
export const UPULLRPARTS_API_URL =
  "https://upullrparts.com/wp-admin/admin-ajax.php";

export class UpullRPartsProviderError extends Data.TaggedError(
  "UpullRPartsProviderError",
)<{
  cause: unknown;
}> {
  override get message() {
    return `U Pull R Parts catalog: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

const optionalText = Schema.optional(Schema.NullOr(Schema.String));
export const UpullRPartsVehicleSchema = Schema.Struct({
  Store: Schema.Number.pipe(Schema.int(), Schema.positive()),
  VIN: optionalText,
  Year: Schema.optional(Schema.NullOr(Schema.Number)),
  Model: optionalText,
  Color: optionalText,
  StockNumber: optionalText,
  Row: Schema.optional(
    Schema.NullOr(Schema.Union(Schema.Number, Schema.String)),
  ),
  DateSetData: optionalText,
});
export type UpullRPartsVehicle = Schema.Schema.Type<
  typeof UpullRPartsVehicleSchema
>;

export const UPULLRPARTS_MAX_MAKES = 64;
export const UPULLRPARTS_MAX_CATALOG_RECORDS = 20_000;
const providerLabel = Schema.String.pipe(
  Schema.maxLength(100),
  Schema.filter((value) => value.trim().length > 0),
);
export const UpullRPartsMakesSchema = Schema.Array(providerLabel).pipe(
  Schema.minItems(1),
  Schema.maxItems(UPULLRPARTS_MAX_MAKES),
);
export const UpullRPartsModelsSchema = Schema.Array(providerLabel).pipe(
  Schema.maxItems(500),
);

function fetchUpullRPartsJson<A, I>(
  apiAction: "getMakes" | "getModels" | "getYears",
  params: Record<string, string>,
  schema: Schema.Schema<A, I>,
  requestGate?: ProviderRequestGate,
) {
  return fetchProviderJson({
    url: UPULLRPARTS_API_URL,
    context: `U Pull R Parts ${apiAction} ${JSON.stringify(params)}`,
    method: "POST",
    // The shared legacy browser UA receives HTTP 403 here. Identify the
    // actual client instead; this public endpoint accepts this agent.
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "JunkyardIndex/1.0",
    },
    body: new URLSearchParams({
      action: "doAaaApiCall",
      apiAction,
      ...params,
    }).toString(),
    schema,
    onResponse: (response) => {
      if (
        response.status === 206 ||
        response.headers.has("content-range") ||
        response.headers.has("link")
      ) {
        throw new Error(
          `U Pull R Parts ${apiAction} returned a partial or linked response; verify its pagination before accepting this catalog or make mapping`,
        );
      }
    },
    requestGate,
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
  }).pipe(Effect.mapError((cause) => new UpullRPartsProviderError({ cause })));
}

export function fetchUpullRPartsMakes(requestGate: ProviderRequestGate) {
  return fetchUpullRPartsJson(
    "getMakes",
    {},
    UpullRPartsMakesSchema,
    requestGate,
  );
}

export const UpullRPartsYearsSchema = Schema.Array(
  Schema.String.pipe(Schema.pattern(/^\d{4}$/)),
).pipe(Schema.maxItems(200));

export function fetchUpullRPartsYears(
  make: string,
  model: string,
  requestGate: ProviderRequestGate,
) {
  return fetchUpullRPartsJson(
    "getYears",
    { Make: make, Model: model },
    UpullRPartsYearsSchema,
    requestGate,
  );
}

export function fetchUpullRPartsModels(
  make: string,
  requestGate: ProviderRequestGate,
) {
  return fetchUpullRPartsJson(
    "getModels",
    { Make: make, ModelYear: "0" },
    UpullRPartsModelsSchema,
    requestGate,
  );
}
