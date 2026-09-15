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

/** The shipped form has no paging. Omitting site returns all three stores. */
export function fetchUpullRPartsCatalog(requestGate?: ProviderRequestGate) {
  return fetchProviderJson({
    url: UPULLRPARTS_API_URL,
    context: "U Pull R Parts complete vehicle catalog",
    method: "POST",
    // The shared legacy browser UA receives HTTP 403 here. Identify the
    // actual client instead; this public endpoint accepts this agent.
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "JunkyardIndex/1.0",
    },
    body: new URLSearchParams({
      action: "doApiCall",
      apiAction: "getVehicles",
    }).toString(),
    // Validate the envelope here, then count individual rejected rows in the connector.
    schema: Schema.Array(Schema.Unknown),
    requestGate,
    retry: { retryLimit: 2, retryNetworkErrors: false, jitter: false },
  }).pipe(Effect.mapError((cause) => new UpullRPartsProviderError({ cause })));
}
