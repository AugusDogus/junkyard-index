import { inventoryVin } from "./inventory-vin";
import type { MccauleyCurrent, MccauleyDetail } from "./mccauley-parser";
import { normalizeCanonicalMake } from "./normalization";
import { MCCAULEY_CURRENT, MCCAULEY_YARD } from "./mccauley-yard-metadata";
import type { CanonicalVehicle } from "./types";

export type MccauleyRecord = {
  title: string;
  vin: string;
  color: string | null;
  transmission: string | null;
  destination: string;
  listingLabel: string | null;
};
export type MccauleyCanonicalVehicle = CanonicalVehicle & {
  source: "mccauley";
};
export type MccauleyVehicleResult =
  | { status: "available"; vehicle: MccauleyCanonicalVehicle }
  | { status: "incomplete"; vin: string | null };
const makePattern =
  /^(\d{4})\s+(Acura|Chevrolet|Chrysler|Dodge|GMC|Jeep|Kia|Mercury|Scion|Subaru)\s+(.+)$/i;

/** Primary model comes from native words, never VIN decoding or URL slugs. */
function model(raw: string): string {
  const primary =
    raw
      .split(
        /\s+(?:AWD|FWD|4WD|V[468]|[468]C|[24]D|CREW|EXT|TOURING|LAREDO|LIMITED|EX|SXT|ST|LT)\b/i,
      )[0]
      ?.trim() ?? "";
  const silverado = /^(\d{4}HD)\s+SILVERADO$/i.exec(primary);
  if (silverado) return "Silverado " + (silverado[1] ?? "").toUpperCase();
  const special = new Map([
    ["MDX", "MDX"],
    ["TC", "tC"],
    ["300M", "300M"],
    ["TRAILBLAZER", "TrailBlazer"],
  ]);
  return (
    special.get(primary.toUpperCase()) ??
    primary.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function identity(title: string) {
  const match = makePattern.exec(title);
  const year = match?.[1] ?? "";
  const make = match ? normalizeCanonicalMake(match[2] ?? "") : "";
  const primaryModel = model(match?.[3] ?? "");
  return { year, make, model: primaryModel };
}

export function mccauleyRecordVin(record: MccauleyRecord): string | null {
  return inventoryVin(record.vin, identity(record.title).year);
}

export function transformMccauleyRecord(
  record: MccauleyRecord,
): MccauleyVehicleResult {
  const parsed = identity(record.title);
  const year = Number(parsed.year);
  const vin = mccauleyRecordVin(record);
  const listingYear = record.listingLabel?.match(/^(\d{4})\b/)?.[1];
  const listingModel =
    record.listingLabel === null
      ? null
      : model(
          record.listingLabel
            .replace(/^\d{4}\s+/, "")
            .replace(new RegExp("^" + parsed.make + "\\s+", "i"), ""),
        );
  const key = (value: string) =>
    value
      .toLowerCase()
      .replace(/hd\b/g, "")
      .replace(/[^a-z0-9]/g, "");
  if (
    !vin ||
    year < 1886 ||
    year > 2100 ||
    !parsed.make ||
    !parsed.model ||
    /^(?:unknown|other|none|null|n\/a)$/i.test(parsed.model) ||
    (listingYear !== undefined && listingYear !== parsed.year) ||
    (listingModel !== null && key(listingModel) !== key(parsed.model))
  )
    return { status: "incomplete", vin };
  return {
    status: "available",
    vehicle: {
      source: "mccauley",
      vin,
      year,
      make: parsed.make,
      model: parsed.model,
      color: record.color,
      transmission: record.transmission,
      stockNumber: null,
      imageUrl: null,
      availableDate: null,
      locationCode: MCCAULEY_YARD.code,
      locationName: MCCAULEY_YARD.name,
      locationCity: MCCAULEY_YARD.city,
      state: "Pennsylvania",
      stateAbbr: "PA",
      lat: MCCAULEY_YARD.lat,
      lng: MCCAULEY_YARD.lng,
      section: null,
      row: null,
      space: null,
      detailsUrl: record.destination,
      partsUrl: null,
      pricesUrl: null,
      engine: null,
      trim: null,
    },
  };
}

export function mccauleyCurrentRecords(
  current: MccauleyCurrent,
): MccauleyRecord[] {
  return current.headings.map((heading) => {
    const content = heading.replace(/^Vehicle\s+\d+\s*/i, "");
    const marker = /\s*-?\s*VIN\s*:\s*/i.exec(content);
    return {
      title: marker ? content.slice(0, marker.index).trim() : content,
      vin: marker ? content.slice(marker.index + marker[0].length).trim() : "",
      color: null,
      transmission: null,
      destination: MCCAULEY_CURRENT,
      listingLabel: null,
    };
  });
}

export function mccauleyDetailRecords(detail: MccauleyDetail): {
  records: MccauleyRecord[];
  missingIdentities: number;
} {
  const records: MccauleyRecord[] = [];
  let title = detail.heading;
  let transmission: string | null = null;
  for (const line of detail.paragraphs.flatMap((p) => p.split("\n"))) {
    if (/^\d{4}\s+\S/.test(line)) {
      // The Silverado paragraph abbreviates the complete native h2 to
      // "2010 CHEVROLET 2500HD". Keep the longer, source-published heading.
      title = detail.heading.toUpperCase().startsWith(line.toUpperCase() + " ")
        ? detail.heading
        : line;
      transmission = null;
    }
    const labelledTransmission = /^Transmission:\s*(.*)$/i.exec(line)?.[1];
    if (labelledTransmission !== undefined)
      transmission = /^Automatic$/i.test(labelledTransmission)
        ? "Automatic"
        : null;
    const vin = /^VIN\s*:\s*(.*)$/i.exec(line)?.[1];
    if (vin !== undefined)
      records.push({
        title,
        vin: vin.trim(),
        transmission,
        color: /\(RED\)/i.test(title)
          ? "Red"
          : /\(SILVER\)/i.test(title)
            ? "Silver"
            : null,
        destination: detail.post.url,
        listingLabel: detail.post.label,
      });
  }
  if (!records.length)
    records.push({
      title: detail.heading,
      vin: "",
      color: null,
      transmission: null,
      destination: detail.post.url,
      listingLabel: detail.post.label,
    });
  const headerIdentity = identity(detail.heading);
  if (
    records.some((record) => {
      const nativeIdentity = identity(record.title);
      return (
        nativeIdentity.year !== headerIdentity.year ||
        nativeIdentity.make !== headerIdentity.make ||
        nativeIdentity.model !== headerIdentity.model
      );
    })
  )
    throw new Error(
      "McCauley native detail heading conflicts with its donor identity paragraph",
    );
  const text = detail.paragraphs.join(" ").replace(/[’‘]/g, "'");
  const twoMdx =
    /one of two 03' MDX's/i.test(text) ||
    /We have two of these 03' MDX's/i.test(text);
  const otherClaims = text
    .replace(/one of two 03' MDX's/gi, "")
    .replace(/We have two of these 03' MDX's/gi, "");
  // These are the only inspected donor-count clauses. Require review for any
  // remaining claim, including unenumerated number words and compound counts.
  if (/\b(?:one of|we have)\s+\S+/i.test(otherClaims))
    throw new Error(
      "McCauley donor cardinality claim changed; inspect every described vehicle before continuing",
    );
  if (
    twoMdx &&
    (identity(detail.heading).model !== "MDX" || records.length !== 1)
  )
    throw new Error(
      "McCauley two-MDX description no longer matches one identified donor",
    );
  return { records, missingIdentities: twoMdx ? 1 : 0 };
}
