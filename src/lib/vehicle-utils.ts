import type { DataSource, Vehicle } from "~/lib/types";
import type { vehicle } from "~/schema";

/**
 * Map a vehicle DB row to the Vehicle type used across the app.
 * Single source of truth — used by both the vehicles router and check-alerts cron.
 */
export function dbVehicleToVehicle(v: typeof vehicle.$inferSelect): Vehicle {
  return {
    id: v.vin,
    year: v.year,
    make: v.make,
    model: v.model,
    color: v.color ?? "",
    vin: v.vin,
    stockNumber: v.stockNumber ?? "",
    availableDate: v.availableDate ?? "",
    source: v.source as DataSource,
    location: {
      locationCode: v.locationCode,
      locationPageURL: "",
      name: v.locationName,
      displayName: v.locationName
        .replace(/^Pick Your Part - /, "")
        .replace(/^PICK-n-PULL /, "")
        .replace(/^LKQ Pull-A-Part - /, ""),
      address: "",
      city: "",
      state: v.state,
      stateAbbr: v.stateAbbr,
      zip: "",
      phone: "",
      lat: v.lat,
      lng: v.lng,
      distance: 0,
      legacyCode: "",
      primo: "",
      source: v.source as DataSource,
      urls: {
        store: "",
        interchange: "",
        inventory: "",
        prices: v.pricesUrl ?? "",
        directions: "",
        sellACar: "",
        contact: "",
        customerServiceChat: null,
        carbuyChat: null,
        deals: "",
        parts: v.partsUrl ?? "",
      },
    },
    yardLocation: {
      section: v.section ?? "",
      row: v.row ?? "",
      space: v.space ?? "",
    },
    images: v.imageUrl ? [{ url: v.imageUrl }] : [],
    detailsUrl: v.detailsUrl ?? "",
    partsUrl: v.partsUrl ?? "",
    pricesUrl: v.pricesUrl ?? "",
    engine: v.engine ?? undefined,
    trim: v.trim ?? undefined,
    transmission: v.transmission ?? undefined,
  };
}
