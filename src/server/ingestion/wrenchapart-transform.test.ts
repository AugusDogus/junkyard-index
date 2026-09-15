import { expect, test } from "bun:test";
import { Schema } from "effect";
import fixture from "./fixtures/wrenchapart-sample.json";
import {
  WrenchApartVehicleSchema,
  type WrenchApartVehicle,
} from "./wrenchapart-client";
import { transformWrenchApartVehicle } from "./wrenchapart-transform";
import {
  wrenchapartPricesUrl,
  wrenchapartYard,
} from "./wrenchapart-yard-metadata";

const record = Schema.decodeUnknownSync(WrenchApartVehicleSchema)(
  fixture.vehicle,
);
function transform(overrides: Partial<WrenchApartVehicle> = {}) {
  const yard = wrenchapartYard(fixture.location);
  if (!yard || yard.lat === null || yard.lng === null)
    throw new Error("Invalid location fixture");
  return transformWrenchApartVehicle(
    { ...record, ...overrides },
    { ...yard, lat: yard.lat, lng: yard.lng },
    wrenchapartPricesUrl(fixture.location),
  );
}

test("maps VIN, dates, yard coordinates, row and public inventory links", () => {
  expect(transform()).toEqual({
    vin: "1N4AA5AP3AC800856",
    source: "wrenchapart",
    year: 2010,
    make: "Nissan",
    model: "MAXIMA",
    color: "Maroon",
    stockNumber: "AWAP084120",
    imageUrl: fixture.vehicle.photo,
    availableDate: "2026-09-14T13:37:04.000Z",
    locationCode: "2",
    locationName: "Wrench-A-Part - Austin",
    locationCity: "Del Valle",
    state: "Texas",
    stateAbbr: "TX",
    lat: fixture.location.geoLat,
    lng: fixture.location.geoLng,
    section: null,
    row: "17",
    space: null,
    detailsUrl: "https://wrenchapart.com/vehicle-search.html",
    partsUrl: null,
    pricesUrl: "https://wrenchapart.com/austin-price-list.html",
    engine: null,
    trim: null,
    transmission: null,
  });
});

test("preserves legacy provider VINs and normalizes optional fields", () => {
  expect(
    transform({
      vin: " f10gkt44234 ",
      modelYear: 1974,
      dateAdded: "bad-date",
      photo: "javascript:alert(1)",
      stockNumber: " ",
      row: null,
      color: null,
    }),
  ).toMatchObject({
    vin: "F10GKT44234",
    availableDate: null,
    imageUrl: null,
    stockNumber: null,
    row: null,
    color: null,
  });
});

test("rejects records without canonical identity or required vehicle fields", () => {
  for (const overrides of [
    { vin: " " },
    { modelYear: null },
    { modelYear: 2010.5 },
    { make: null },
    { make: { name: " " } },
    { model: { name: "" } },
  ]) {
    expect(transform(overrides)).toBeNull();
  }
});

test("derives new yards from public metadata without a fixed allowlist", () => {
  expect(
    wrenchapartYard({
      ...fixture.location,
      id: 99,
      name: "New Yard",
      city: "New City",
    }),
  ).toMatchObject({
    code: "99",
    name: "Wrench-A-Part - New Yard",
    city: "New City",
    state: "TX",
    operator: "Wrench-A-Part",
    address: fixture.location.street,
    phone: fixture.location.phone,
  });
  expect(wrenchapartYard({ id: 99 })).toBeNull();
  for (const coords of [
    { geoLat: null, geoLng: null },
    { geoLat: 0, geoLng: 0 },
    { geoLat: 91, geoLng: 12 },
    { geoLat: 30, geoLng: null },
  ]) {
    expect(wrenchapartYard({ ...fixture.location, ...coords })).toMatchObject({
      lat: null,
      lng: null,
    });
  }
  expect(wrenchapartPricesUrl({ id: 99, slug: "../../bad" })).toBeNull();
});
