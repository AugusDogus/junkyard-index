import { Schema } from "effect";
import type { Location } from "~/lib/types";
import { normalizeRegion } from "./normalization";

const PypPhotoSchema = Schema.Struct({
  PhotoPath: Schema.String,
  IsPrimary: Schema.Boolean,
  IsInternal: Schema.Boolean,
  InventoryPhoto: Schema.Boolean,
});

const OptionalPypStringField = Schema.optionalWith(Schema.String, {
  nullable: true,
  default: () => "",
});

const PypVehicleJsonSchema = Schema.Struct({
  YardCode: Schema.String,
  Section: OptionalPypStringField,
  Row: OptionalPypStringField,
  SpaceNumber: OptionalPypStringField,
  Color: OptionalPypStringField,
  Year: Schema.String,
  Make: Schema.String,
  Model: Schema.String,
  InYardDate: Schema.String,
  StockNumber: Schema.String,
  Vin: Schema.String,
  Photos: Schema.Array(PypPhotoSchema),
});

const PypFilterResponseSchema = Schema.Struct({
  Success: Schema.Boolean,
  Errors: Schema.Array(Schema.String),
  ResponseData: Schema.Struct({
    Request: Schema.Struct({
      YardCode: Schema.Array(Schema.String),
      Filter: Schema.String,
      PageSize: Schema.Number,
      PageNumber: Schema.Number,
      FilterDeals: Schema.Boolean,
    }),
    Vehicles: Schema.Array(PypVehicleJsonSchema),
  }),
  Messages: Schema.Array(Schema.String),
});

export type PypFilterResponse = Schema.Schema.Type<
  typeof PypFilterResponseSchema
>;

export const decodePypFilterResponse = Schema.decodeUnknownSync(
  PypFilterResponseSchema,
);

interface PypRawLocation {
  LocationCode: string;
  LocationPageURL: string;
  Name: string;
  DisplayName: string;
  Address: string;
  City: string;
  State: string;
  StateAbbr: string;
  Zip: string;
  Phone: string;
  Lat: number;
  Lng: number;
  Distance: number;
  LegacyCode: string;
  Primo: string;
  Urls: {
    Store: string;
    Interchange: string;
    Inventory: string;
    Prices: string;
    Directions: string;
    SellACar: string;
    Contact: string;
    CustomerServiceChat: string | null;
    CarbuyChat: string | null;
    Deals: string;
    Parts: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPypUrls(value: unknown): value is PypRawLocation["Urls"] {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.Store) &&
    isString(value.Interchange) &&
    isString(value.Inventory) &&
    isString(value.Prices) &&
    isString(value.Directions) &&
    isString(value.SellACar) &&
    isString(value.Contact) &&
    (value.CustomerServiceChat === null ||
      isString(value.CustomerServiceChat)) &&
    (value.CarbuyChat === null || isString(value.CarbuyChat)) &&
    isString(value.Deals) &&
    isString(value.Parts)
  );
}

function isPypRawLocation(value: unknown): value is PypRawLocation {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.LocationCode) &&
    isString(value.LocationPageURL) &&
    isString(value.Name) &&
    isString(value.DisplayName) &&
    isString(value.Address) &&
    isString(value.City) &&
    isString(value.State) &&
    isString(value.StateAbbr) &&
    isString(value.Zip) &&
    isString(value.Phone) &&
    isNumber(value.Lat) &&
    isNumber(value.Lng) &&
    isNumber(value.Distance) &&
    isString(value.LegacyCode) &&
    isString(value.Primo) &&
    isPypUrls(value.Urls)
  );
}

function mapRawLocation(raw: PypRawLocation): Location {
  const region = normalizeRegion(raw.State, raw.StateAbbr);

  return {
    locationCode: raw.LocationCode,
    locationPageURL: raw.LocationPageURL,
    name: raw.Name,
    displayName: raw.DisplayName,
    address: raw.Address,
    city: raw.City,
    state: region.state,
    stateAbbr: region.stateAbbr,
    zip: raw.Zip,
    phone: raw.Phone,
    lat: raw.Lat,
    lng: raw.Lng,
    distance: raw.Distance,
    legacyCode: raw.LegacyCode,
    primo: raw.Primo,
    source: "pyp",
    urls: {
      store: raw.Urls.Store,
      interchange: raw.Urls.Interchange,
      inventory: raw.Urls.Inventory,
      prices: raw.Urls.Prices,
      directions: raw.Urls.Directions,
      sellACar: raw.Urls.SellACar,
      contact: raw.Urls.Contact,
      customerServiceChat: raw.Urls.CustomerServiceChat,
      carbuyChat: raw.Urls.CarbuyChat,
      deals: raw.Urls.Deals,
      parts: raw.Urls.Parts,
    },
  };
}

export function decodePypLocations(value: unknown): Location[] {
  return Array.isArray(value)
    ? value.filter(isPypRawLocation).map(mapRawLocation)
    : [];
}
