import { Schema } from "effect";

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

export const UpullitDaviePageSchema = Schema.Struct({
  vehicles: Schema.Array(UpullitDavieVehicleSchema),
  totalCount: NonNegativeIntegerSchema,
  page: PositiveIntegerSchema,
  pageSize: PositiveIntegerSchema,
  totalPages: PositiveIntegerSchema,
});

export type UpullitDaviePage = Schema.Schema.Type<
  typeof UpullitDaviePageSchema
>;
