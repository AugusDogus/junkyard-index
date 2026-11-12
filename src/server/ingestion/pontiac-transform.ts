import { z } from "zod";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import {
  pontiacColor,
  samePontiacSearch,
  type PontiacDetailRecord,
  type PontiacSearchRecord,
} from "./pontiac-record";
import { PONTIAC_ORIGIN, PONTIAC_YARD } from "./pontiac-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type PontiacCanonicalVehicle = CanonicalVehicle & { source: "pontiac" };
export type PontiacVehicleResult =
  | { status: "available"; vehicle: PontiacCanonicalVehicle }
  | { status: "unavailable" }
  | { status: "incomplete"; vin: string | null };

export function transformPontiacRecord(
  search: PontiacSearchRecord,
  detail: PontiacDetailRecord,
): PontiacVehicleResult {
  if (
    !samePontiacSearch(search, {
      vehicleID: detail.vehicleID,
      stockID: detail.stockID,
      modelYear: detail.modelYear,
      modelMake: detail.vehicleMake,
      modelName: detail.modelName,
      colorOfVehicle: detail.colorOfVehicle,
      yardRow: detail.YardRow,
    })
  ) {
    throw new Error(
      "Pontiac search and detail disagree for donor " +
        search.vehicleID +
        "; retain the previous inventory and retry from the last checkpoint",
    );
  }
  if (detail.YardLocation !== "YARD") return { status: "unavailable" };
  const vin = inventoryVin(detail.VIN ?? "", String(detail.modelYear));
  const make = normalizeCanonicalMake(detail.vehicleMake);
  const model = detail.modelName.trim();
  const color =
    pontiacColor(detail.colorOfVehicle) ?? pontiacColor(search.colorOfVehicle);
  const row = detail.YardRow ?? search.yardRow ?? null;
  const date = z
    .string()
    .datetime({ offset: true })
    .safeParse(detail.YardLocationDT);
  const dateMs = date.success ? Date.parse(date.data) : NaN;
  const image = detail.images
    ?.slice()
    .sort(
      (a, b) =>
        (a.displayOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.displayOrder ?? Number.MAX_SAFE_INTEGER),
    )
    .find((candidate) => {
      const url = URL.parse(candidate.imageMedium);
      return (
        candidate.referenceID === detail.vehicleID &&
        url?.origin === "https://static.u-pullandsave.com" &&
        !url.search &&
        !url.hash &&
        !url.username &&
        !url.password &&
        /^\/medium\/[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}\.jpg$/i.test(
          url.pathname,
        )
      );
    });
  if (
    !vin ||
    !make ||
    /^(?:unknown|other|na|n\/a)$/i.test(make) ||
    /^(?:unknown|other|na|n\/a)$/i.test(model) ||
    ((detail.images?.length ?? 0) > 0 && !image)
  )
    return { status: "incomplete", vin };
  const availableDate =
    Number.isFinite(dateMs) &&
    dateMs <= Date.now() &&
    dateMs >= Date.UTC(1886, 0, 1)
      ? new Date(dateMs).toISOString()
      : null;
  return {
    status: "available",
    vehicle: {
      source: "pontiac",
      vin,
      year: detail.modelYear,
      make,
      model,
      color,
      stockNumber: detail.stockID ?? search.stockID ?? null,
      row: row === null ? null : String(row),
      availableDate,
      imageUrl: image?.imageMedium ?? null,
      detailsUrl: PONTIAC_ORIGIN + "/vehicles/" + detail.vehicleID,
      locationCode: PONTIAC_YARD.code,
      locationName: PONTIAC_YARD.name,
      locationCity: PONTIAC_YARD.city,
      state: "Michigan",
      stateAbbr: "MI",
      lat: PONTIAC_YARD.lat,
      lng: PONTIAC_YARD.lng,
      section: null,
      space: null,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
      transmission: null,
    },
  };
}
