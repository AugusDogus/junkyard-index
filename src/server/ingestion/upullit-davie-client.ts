import { Effect, Schema } from "effect";
import { fetchProviderText } from "./provider-http-client";

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

const UpullitDaviePageSchema = Schema.Struct({
  vehicles: Schema.Array(UpullitDavieVehicleSchema),
  totalCount: Schema.Number,
  page: Schema.Number,
  pageSize: Schema.Number,
  totalPages: Schema.Number,
});

export type UpullitDaviePage = Schema.Schema.Type<
  typeof UpullitDaviePageSchema
>;

export function fetchUpullitDaviePage(
  page: number,
): Effect.Effect<UpullitDaviePage, Error> {
  const url = new URL("/api/inventory/search", UPULLIT_DAVIE_ORIGIN);
  url.searchParams.set("page", String(page));

  return fetchProviderText({
    url: url.toString(),
    context: `U Pull It Davie inventory page ${page}`,
    headers: { Referer: `${UPULLIT_DAVIE_ORIGIN}/inventory` },
  }).pipe(
    Effect.flatMap((text) =>
      Effect.try({
        try: () => JSON.parse(text) as unknown,
        catch: (cause) =>
          new Error(
            `U Pull It Davie inventory page ${page} returned invalid JSON: ${String(cause)}`,
          ),
      }),
    ),
    Effect.flatMap((body) =>
      Schema.decodeUnknown(UpullitDaviePageSchema)(body),
    ),
  );
}
