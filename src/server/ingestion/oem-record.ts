import { inventoryVin } from "./inventory-vin";
import { oemOwnedUrl } from "./oem-html";
import type { OemRecord } from "./oem-parser";

export interface OemCandidate {
  vin: string;
  year: number;
  make: string;
  model: string;
  detailsUrl: string;
  stockNumber: string | null;
  imageUrl: string | null;
  availableDate: string | null;
  color: string | null;
  row: string | null;
}
export type OemAssessment = {
  record: OemRecord;
  validVinClaims: string[];
  reasons: string[];
  ownershipAlerts: string[];
} & (
  | { status: "required-pass"; candidate: OemCandidate }
  | { status: "required-reject"; candidate: null }
);
export const oemFields = (record: OemRecord, label: string) =>
  record.fields.filter((f) => f.label === label).map((f) => f.value.trim());
const distinct = (values: readonly string[]) => [
  ...new Set(values.map((v) => v.trim())),
];
const one = (values: readonly string[]) => {
  const claims = distinct(values);
  return claims.length === 1 ? (claims[0] ?? "") : "";
};
const usable = (value: string) =>
  /[a-z0-9]/i.test(value) &&
  !/^(?:unknown|other|n\/?a|none|null|undefined|[-?]+)$/i.test(value);
const optional = (values: readonly string[]) =>
  one(values.filter(usable)) || null;

export function assessOemRecord(
  record: OemRecord,
  nativeMakes: readonly string[],
): OemAssessment {
  const years = oemFields(record, "year"),
    vins = oemFields(record, "vin"),
    titles = oemFields(record, "make/model");
  const yearRaw = one(years),
    vinRaw = one(vins),
    title = one(titles);
  const reasons: string[] = [];
  for (const values of [years, vins, titles])
    if (distinct(values.filter(Boolean).map((v) => v.toUpperCase())).length > 1)
      reasons.push("conflicting-native-required-claims");
  const year =
    /^\d{4}$/.test(yearRaw) &&
    Number(yearRaw) >= 1886 &&
    Number(yearRaw) <= new Date().getUTCFullYear() + 1
      ? Number(yearRaw)
      : null;
  const vin = inventoryVin(vinRaw, yearRaw);
  const make =
    record.context.kind === "model"
      ? record.context.make.label
      : ([...nativeMakes]
          .sort((a, b) => b.length - a.length)
          .find((m) => title.startsWith(m + " ")) ?? "");
  const model =
    make && title.startsWith(make + " ")
      ? title.slice(make.length + 1).trim()
      : "";
  if (year === null) reasons.push("missing-or-invalid-native-year");
  if (vin === null) reasons.push("missing-or-invalid-native-vin");
  if (!usable(make) || !usable(model))
    reasons.push("missing-native-make-model");
  if (
    record.context.kind === "model" &&
    title !== `${make} ${record.context.model.label}` &&
    !(
      record.context.model.label.startsWith(make + " ") &&
      title === record.context.model.label
    )
  )
    reasons.push("native-title-and-model-conflict");
  const destination =
    record.destinations.length === 1
      ? oemOwnedUrl(record.destinations[0] ?? "")
      : null;
  const parts = destination?.pathname.split("/") ?? [];
  if (
    !destination ||
    !/^\/parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(destination.pathname)
  )
    reasons.push("missing-or-foreign-native-destination");
  if (destination && parts[5] !== yearRaw)
    reasons.push("native-year-and-destination-conflict");
  if (
    destination &&
    record.context.kind === "model" &&
    parts.slice(0, 4).join("/") !==
      oemOwnedUrl(record.context.model.url)?.pathname.replace(/\/$/, "")
  )
    reasons.push("native-destination-parent-conflict");
  let destinationStock: string | null = null;
  try {
    destinationStock = decodeURIComponent(parts[4] ?? "");
  } catch {
    /* Invalid native segment is rejected below. */
  }
  const stock = optional(oemFields(record, "stock"));
  if (
    !destinationStock ||
    !usable(destinationStock) ||
    [...oemFields(record, "stock"), record.cardId].some(
      (v) => v && usable(v) && v !== destinationStock,
    )
  )
    reasons.push("native-stock-and-destination-conflict");
  const ownershipAlerts: string[] = [];
  const images = record.images.flatMap((raw) => {
    const url = URL.parse(raw);
    if (
      url?.hostname === "da8h1v3w8q6n5.cloudfront.net" &&
      /^\/[^/]+\/images\//.test(url.pathname) &&
      !url.pathname.startsWith("/oh40/images/")
    )
      ownershipAlerts.push(raw);
    return url &&
      url.origin === "https://da8h1v3w8q6n5.cloudfront.net" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      destinationStock &&
      url.pathname.startsWith(
        `/oh40/images/${destinationStock}/${destinationStock}_`,
      ) &&
      /_\d+\.jpe?g$/i.test(url.pathname)
      ? [url.href]
      : [];
  });
  const date = optional([
    ...oemFields(record, "arrive date"),
    ...oemFields(record, "purchase date"),
  ]);
  const availableDate =
    date &&
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    new Date(date).toISOString().slice(0, 10) === date
      ? date
      : null;
  const validVinClaims = [
    ...new Set(
      vins.flatMap((claim) =>
        ["", ...years].flatMap((y) => {
          const value = inventoryVin(claim, y);
          return value === null ? [] : [value];
        }),
      ),
    ),
  ];
  const evidence = { record, validVinClaims, reasons, ownershipAlerts };
  if (reasons.length || vin === null || year === null || !destination)
    return { ...evidence, status: "required-reject", candidate: null };
  return {
    ...evidence,
    status: "required-pass",
    candidate: {
      vin,
      year,
      make,
      model,
      detailsUrl: destination.href,
      stockNumber: stock,
      imageUrl: images[0] ?? null,
      availableDate,
      color: optional(oemFields(record, "color")),
      row: optional(oemFields(record, "row")),
    },
  };
}
