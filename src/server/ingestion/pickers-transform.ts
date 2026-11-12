import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
} from "./normalization";
import { vinplusCalendarDate, vinplusOptionalText } from "./vinplus-protocol";
import {
  pickersLiteral,
  type PickersNativeRow,
  type PickersRecord,
} from "./pickers-parser";
import {
  PICKERS_INVENTORY_URL,
  PICKERS_PRICES_URL,
  PICKERS_YARD,
} from "./pickers-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type PickersCanonicalVehicle = CanonicalVehicle & { source: "pickers" };
export type PickersDisposition =
  | { status: "available"; vehicle: PickersCanonicalVehicle }
  | {
      status: "incomplete";
      vin: string | null;
      reason: "missing-enrichment" | "invalid-required-fields";
    }
  | {
      status: "quarantined";
      vin: string | null;
      reason: "active-scope-unproven";
    };

export function pickersNativeDate(row: PickersNativeRow): string | null {
  const raw = pickersLiteral(row.date);
  const match =
    typeof raw === "string" && /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  return match
    ? vinplusCalendarDate(Number(match[3]), Number(match[1]), Number(match[2]))
    : null;
}
export function transformPickersRecord(
  native: PickersNativeRow | null,
  api: PickersRecord | null,
): PickersDisposition {
  const rawVin = api ? pickersLiteral(api.fields.vin) : undefined;
  const year = native?.year ?? api?.year;
  const vin =
    typeof rawVin === "string"
      ? inventoryVin(
          rawVin,
          year === null || year === undefined ? "" : String(year),
        )
      : null;
  if (!native)
    return { status: "quarantined", vin, reason: "active-scope-unproven" };
  if (!api)
    return { status: "incomplete", vin: null, reason: "missing-enrichment" };
  if (native.year !== null && native.year !== api.year)
    throw new Error(
      "Pickers native/API year conflicts for stock " + native.stock,
    );
  const make = normalizeCanonicalMake(native.make);
  const model = vinplusOptionalText(native.model);
  if (
    !vin ||
    native.year === null ||
    !vinplusOptionalText(native.make) ||
    !model ||
    /^(?:other|unknown)$/i.test(make)
  )
    return { status: "incomplete", vin, reason: "invalid-required-fields" };
  const image = pickersLiteral(native.image);
  const url = typeof image === "string" ? URL.parse(image) : null;
  return {
    status: "available",
    vehicle: {
      vin,
      source: "pickers",
      year: native.year,
      make,
      model,
      color: normalizeCanonicalColor(
        vinplusOptionalText(pickersLiteral(native.color)),
      ),
      stockNumber: native.stock,
      imageUrl:
        url?.origin === "https://pickerstxk.com" &&
        url.pathname === "/PickersInventoryPhotos/" + native.stock + ".jpg" &&
        !url.username &&
        !url.password
          ? url.href
          : null,
      availableDate: pickersNativeDate(native),
      locationCode: PICKERS_YARD.code,
      locationName: PICKERS_YARD.name,
      locationCity: PICKERS_YARD.city,
      state: "Arkansas",
      stateAbbr: "AR",
      lat: PICKERS_YARD.lat,
      lng: PICKERS_YARD.lng,
      section: null,
      row: vinplusOptionalText(pickersLiteral(native.row)),
      space: null,
      detailsUrl: PICKERS_INVENTORY_URL,
      partsUrl: null,
      pricesUrl: PICKERS_PRICES_URL,
      engine: vinplusOptionalText(pickersLiteral(native.reference)),
      trim: null,
      transmission: null,
    },
  };
}
