import { Data, Effect, Schema } from "effect";
import {
  fetchProviderJson,
  type ProviderRequestGate,
  type ProviderRetryPolicy,
} from "./provider-http-client";
import { PULLNSAVE_ORIGIN } from "./pullnsave-config";

export class PullNSaveProviderError extends Data.TaggedError(
  "PullNSaveProviderError",
)<{
  page: number;
  cause: unknown;
}> {
  override get message() {
    return `Pull-N-Save page ${this.page}: ${
      this.cause instanceof Error ? this.cause.message : String(this.cause)
    }`;
  }
}

const PULLNSAVE_RETRY_POLICY = {
  retryLimit: 2,
  retryBaseDelayMs: 1_000,
  retryNetworkErrors: false,
  jitter: false,
} satisfies Partial<ProviderRetryPolicy>;

export const PullNSaveVehicleSchema = Schema.Struct({
  astStoreNumber: Schema.Number,
  stockId: Schema.String,
  rcvdDtTm: Schema.optional(Schema.NullOr(Schema.String)),
  vin: Schema.optional(Schema.NullOr(Schema.String)),
  year: Schema.optional(Schema.NullOr(Schema.Number)),
  make: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
  color: Schema.optional(Schema.NullOr(Schema.String)),
  transmissionDesc: Schema.optional(Schema.NullOr(Schema.String)),
  engineDesc: Schema.optional(Schema.NullOr(Schema.String)),
  yardRow: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type PullNSaveVehicle = Schema.Schema.Type<
  typeof PullNSaveVehicleSchema
>;

export const PullNSaveSearchPageSchema = Schema.Array(PullNSaveVehicleSchema);

export type PullNSaveSearchPage = Schema.Schema.Type<
  typeof PullNSaveSearchPageSchema
>;

export function buildPullNSaveImageUrl(stockId: string, order: number): string {
  return `${PULLNSAVE_ORIGIN}/v1/Vehicles/Images/StockId/${encodeURIComponent(
    stockId,
  )}/OrderId/${order}`;
}

export function fetchPullNSavePage(params: {
  pageNumber: number;
  pageSize: number;
  requestGate?: ProviderRequestGate;
}): Effect.Effect<PullNSaveSearchPage, Error> {
  return fetchProviderJson({
    url: `${PULLNSAVE_ORIGIN}/v1/Vehicles/Search`,
    context: `Pull-N-Save vehicle search page ${params.pageNumber}`,
    method: "POST",
    body: JSON.stringify({
      pageNumber: params.pageNumber,
      pageSize: params.pageSize,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    schema: PullNSaveSearchPageSchema,
    requestGate: params.requestGate,
    retry: PULLNSAVE_RETRY_POLICY,
    responseError: (response) =>
      new Error(
        `Pull-N-Save vehicle search returned HTTP ${response.status} for page ${params.pageNumber}`,
      ),
  });
}
