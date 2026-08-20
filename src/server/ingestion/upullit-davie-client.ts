import { Effect, Schema } from "effect";
import { fetchProviderJson } from "./provider-http-client";

export const UPULLIT_DAVIE_ORIGIN = "https://upullitdavie.com";

export const UpullitDavieVehicleSchema = Schema.Struct({
  id: Schema.String,
  stockNumber: Schema.NullOr(Schema.String),
  vin: Schema.String,
  year: Schema.Number,
  make: Schema.String,
  model: Schema.String,
  trim: Schema.NullOr(Schema.String),
  color: Schema.NullOr(Schema.String),
  engine: Schema.NullOr(Schema.String),
  transmission: Schema.NullOr(Schema.String),
  dateArrived: Schema.NullOr(Schema.String),
  row: Schema.NullOr(Schema.String),
  space: Schema.NullOr(Schema.String),
  imageUrl: Schema.NullOr(Schema.String),
});

export type UpullitDavieVehicle = Schema.Schema.Type<
  typeof UpullitDavieVehicleSchema
>;

const PositiveIntegerSchema = Schema.Int.pipe(Schema.positive());
const NonNegativeIntegerSchema = Schema.Int.pipe(Schema.nonNegative());

const UpullitDaviePageSchema = Schema.Struct({
  vehicles: Schema.Array(UpullitDavieVehicleSchema),
  totalCount: NonNegativeIntegerSchema,
  page: PositiveIntegerSchema,
  pageSize: PositiveIntegerSchema,
  totalPages: PositiveIntegerSchema,
});

export type UpullitDaviePage = Schema.Schema.Type<
  typeof UpullitDaviePageSchema
>;

export function fetchUpullitDaviePage(
  page: number,
): Effect.Effect<UpullitDaviePage, Error> {
  const url = new URL("/api/inventory/search", UPULLIT_DAVIE_ORIGIN);
  url.searchParams.set("page", String(page));

  return fetchProviderJson({
    url: url.toString(),
    context: `U Pull It Davie inventory page ${page}`,
    schema: UpullitDaviePageSchema,
    headers: { Referer: `${UPULLIT_DAVIE_ORIGIN}/inventory` },
  });
}
