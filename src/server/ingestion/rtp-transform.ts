import { Yard } from "~/lib/yard";
import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  normalizeRegion,
} from "./normalization";
import type { RtpRecord, RtpYard } from "./rtp-client";
import type { CanonicalVehicle } from "./types";
import { RTP_YARDS } from "./rtp-yard-metadata";

export type RtpCanonicalVehicle = CanonicalVehicle & { source: "rtp" };
export type RtpVehicleResult =
  | { status: "available"; vehicle: RtpCanonicalVehicle }
  | { status: "unavailable" }
  | { status: "incomplete"; vin: string | null };

const colorNames = new Set([
  "Beige",
  "Black",
  "Blue",
  "Bronze",
  "Brown",
  "Burgundy",
  "Champagne",
  "Charcoal",
  "Copper",
  "Gold",
  "Gray",
  "Green",
  "Maroon",
  "Multi",
  "Orange",
  "Pewter",
  "Pink",
  "Purple",
  "Red",
  "Silver",
  "Tan",
  "Teal",
  "Violet",
  "White",
  "Yellow",
]);
function knownColor(raw: string | null | undefined): string | null {
  const color = normalizeCanonicalColor(raw ?? null);
  if (!color) return null;
  // Source mistakes include model names, years, uncertain values and misspellings.
  // Accept explicit color descriptions without guessing a correction.
  return color.split(/[/&]/).every((part) => {
    const base = part
      .trim()
      .replace(/^(?:(?:light|dark|medium|metallic|2 tone)\s+)+/i, "");
    return colorNames.has(normalizeCanonicalColor(base) ?? "");
  })
    ? color
    : null;
}

function inventoryDate(raw: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return null;
  const normalized = raw.replace(" ", "T");
  const date = new Date(`${normalized}Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== normalized
  )
    return null;
  // The source publishes a local set-date, not an acquisition timestamp.
  return `${raw.slice(0, 10)}T00:00:00.000Z`;
}

// Match the site's helpers.encodePath, then let URL encoding handle spaces etc.
function filterPart(value: string): string {
  return encodeURIComponent(
    value
      .replace(/\//g, "_F_")
      .replace(/\?/g, "_Q_")
      .replace(/#/g, "_H_")
      .replace(/%/g, "_P_"),
  );
}

export function transformRtpRecord(
  record: RtpRecord,
  yard: RtpYard,
): RtpVehicleResult {
  if (record.active === "0") return { status: "unavailable" };
  const year = record.year?.trim() ?? "";
  const vin = inventoryVin(record.vin ?? "", year);
  const color = knownColor(record.color);
  const rawMake = record.make?.trim() ?? "";
  const make = normalizeCanonicalMake(rawMake);
  const model = record.model?.trim() ?? "";
  const row = record.yard_row?.trim() || null;
  const stockNumber = /^\d{12}$/.test(record.stock_number ?? "")
    ? (record.stock_number ?? null)
    : null;
  const availableDate = inventoryDate(record.date_set ?? "");
  const { lat, lng } = Yard.coordinates(yard.lat, yard.lng);
  const imageUrl =
    (record.images ?? []).flatMap((image) => {
      const url = image.full ? URL.parse(image.full) : null;
      return url &&
        url.origin === "https://upullandsave.com" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        new RegExp(
          `^/yardsmart/${yard.code}/${record.id}/[1-9]\\d*\\.jpg$`,
        ).test(url.pathname)
        ? [url.href]
        : [];
    })[0] ?? null;
  if (
    !vin ||
    !/^\d{4}$/.test(year) ||
    Number(year) < 1886 ||
    Number(year) > 2100 ||
    !make ||
    /^(?:other|unknown)$/i.test(make) ||
    !model ||
    /^(?:other|unknown)$/i.test(model) ||
    record.active !== "1" ||
    record.status !== "set" ||
    record.yard_id !== yard.code ||
    lat === null ||
    lng === null ||
    !yard.address ||
    !yard.postalCode ||
    !yard.phone ||
    !yard.websiteUrl
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "rtp",
      vin,
      year: Number(year),
      make,
      model,
      color,
      stockNumber,
      row,
      availableDate,
      imageUrl,
      detailsUrl: `${RTP_YARDS[yard.code].home}inventory/${year}/${filterPart(rawMake)}/${filterPart(model)}/`,
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      ...normalizeRegion(yard.state),
      lat,
      lng,
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
