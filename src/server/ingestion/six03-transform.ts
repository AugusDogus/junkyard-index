import { inventoryVin } from "./inventory-vin";
import {
  normalizeCanonicalColor,
  normalizeCanonicalMake,
  parseAutorecyclerMakeModel,
} from "./normalization";
import {
  six03Field,
  six03OptionalField,
  type Six03Detail,
  type Six03Post,
} from "./six03-parser";
import {
  SIX03_ORIGIN,
  SIX03_YARD,
  six03DonorPath,
} from "./six03-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type Six03CanonicalVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "six03";
};
export type Six03Identity = { year: string; make: string; model: string };
const usable = (raw: string) =>
  /[a-z0-9]/i.test(raw) &&
  !/^(?:unknown|other|n\/?a|none|null|undefined|not available)$/i.test(raw);

/** The longest known native make delimits Unit Data. Keep every remaining model word,
 * including a repeated make, trim and punctuation. Never consult route tokens. */
export function six03NativeIdentity(
  raw: string,
  post: Six03Post,
): Six03Identity {
  const match = /^(\d{4})\s+(.+)$/.exec(raw);
  const remainder = match?.[2] ?? "";
  const parsed = parseAutorecyclerMakeModel(remainder);
  const prefix = parsed.make + " ";
  const nativeMake =
    parsed.make.toLowerCase() === post[1].toLowerCase() ||
    parsed.make.toLowerCase().startsWith(post[1].toLowerCase() + " ");
  return {
    year: match?.[1] ?? "",
    make:
      nativeMake && remainder.toLowerCase().startsWith(prefix.toLowerCase())
        ? parsed.make
        : "",
    model:
      nativeMake && remainder.toLowerCase().startsWith(prefix.toLowerCase())
        ? remainder.slice(prefix.length).trim()
        : "",
  };
}

export function six03RecordVins(
  record: Six03Detail,
  post: Six03Post,
): string[] {
  const years = [
    post[2],
    ...six03Field(record, "Year / Make / Model").map(
      (raw) => six03NativeIdentity(raw, post).year,
    ),
  ];
  return [
    ...new Set(
      six03Field(record, "VIN").flatMap((raw) =>
        years.flatMap((year) => {
          const vin = inventoryVin(raw, year);
          return vin === null ? [] : [vin];
        }),
      ),
    ),
  ];
}

const optional = (values: (string | null)[]): string | null => {
  if (values.includes(null)) return null;
  const unique = [
    ...new Set(values.filter((value) => value !== null && usable(value))),
  ];
  return unique.length === 1 ? (unique[0] ?? null) : null;
};

function nativeImage(raw: string | null): string | null {
  if (!raw) return null;
  const url = URL.parse(raw);
  return url &&
    url.origin === SIX03_ORIGIN &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/wp-content\/uploads\/\d{4}\/\d{2}\/[a-zA-Z0-9_.-]+\.(?:jpe?g|png|webp)$/i.test(
      url.pathname,
    ) &&
    !/salvage-yard-overview|logo|placeholder|default/i.test(url.pathname)
    ? url.href
    : null;
}

export function transformSix03Record(
  record: Six03Detail,
  post: Six03Post,
):
  | { status: "available"; vehicle: Six03CanonicalVehicle }
  | { status: "incomplete"; vins: string[] } {
  const vins = six03RecordVins(record, post);
  const claims = six03Field(record, "Year / Make / Model").map((raw) =>
    six03NativeIdentity(raw, post),
  );
  const identity = claims[0];
  const primary = six03NativeIdentity(
    (record.headings[1] ?? "").split(" | ")[0] ?? "",
    post,
  );
  const vin = vins[0];
  if (
    !vin ||
    vins.length !== 1 ||
    !identity ||
    !usable(identity.make) ||
    !usable(identity.model) ||
    Number(identity.year) < 1886 ||
    Number(identity.year) > 2100 ||
    claims.some(
      (claim) => JSON.stringify(claim) !== JSON.stringify(identity),
    ) ||
    JSON.stringify(primary) !== JSON.stringify(identity) ||
    (post[2] && post[2] !== identity.year) ||
    record.path !== post[0] ||
    !six03DonorPath(SIX03_ORIGIN + record.path) ||
    record.headings.some((heading) => {
      const native = six03NativeIdentity(heading.split(" | ")[0] ?? "", post);
      return native.year !== identity.year || !native.make || !native.model;
    })
  )
    return { status: "incomplete", vins };
  return {
    status: "available",
    vehicle: {
      source: "six03",
      vin,
      year: Number(identity.year),
      make: normalizeCanonicalMake(identity.make),
      model: identity.model,
      stockNumber: optional(six03OptionalField(record, "Stock #")),
      imageUrl: nativeImage(record.image),
      availableDate: null,
      color: normalizeCanonicalColor(
        optional(six03OptionalField(record, "Exterior Color")),
      ),
      locationCode: SIX03_YARD.code,
      locationName: SIX03_YARD.name,
      locationCity: SIX03_YARD.city,
      state: "New Hampshire",
      stateAbbr: "NH",
      lat: SIX03_YARD.lat,
      lng: SIX03_YARD.lng,
      detailsUrl: SIX03_ORIGIN + record.path,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      row: null,
      space: null,
      engine: optional(six03OptionalField(record, "Engine")),
      trim: optional(six03OptionalField(record, "Trim Level")),
      transmission: optional(six03OptionalField(record, "Transmission")),
    },
  };
}
