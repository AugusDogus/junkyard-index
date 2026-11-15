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
  PICKERS_DEFAULT_SITE,
  type PickersSite,
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
  site: PickersSite = PICKERS_DEFAULT_SITE,
): PickersDisposition {
  if (api && api.yardLocation !== site.vendorName)
    throw new Error(
      "Pickers API record belongs to a different physical yard: " + api.stock,
    );
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
  if (api.identityConflicts)
    return {
      status: "incomplete",
      vin: null,
      reason: "invalid-required-fields",
    };
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
        url?.origin === site.origin &&
        url.pathname ===
          "/" + site.photoDirectory + "/" + native.stock + ".jpg" &&
        !url.username &&
        !url.password
          ? url.href
          : null,
      availableDate: pickersNativeDate(native),
      locationCode: site.yard.code,
      locationName: site.yard.name,
      locationCity: site.yard.city,
      state: site.stateName,
      stateAbbr: site.yard.state,
      lat: site.yard.lat,
      lng: site.yard.lng,
      section: null,
      row: vinplusOptionalText(pickersLiteral(native.row)),
      space: null,
      detailsUrl: site.origin + "/Home/Inventory",
      partsUrl: null,
      pricesUrl: site.origin + "/Home/PartPrices",
      engine: vinplusOptionalText(pickersLiteral(native.reference)),
      trim: null,
      transmission: null,
    },
  };
}
