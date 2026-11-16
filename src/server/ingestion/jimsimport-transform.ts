import type { CanonicalVehicle } from "./types";
import { inventoryVin } from "./inventory-vin";
import { normalizeCanonicalMake } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";
import {
  jimsimportOwnedUrl,
  type JimsimportMenu,
  type JimsimportPage,
  type JimsimportRecord,
} from "./jimsimport-parser";
import { JIMSIMPORT_YARD } from "./jimsimport-yard-metadata";

export type JimsimportVehicle = Omit<CanonicalVehicle, "source"> & {
  source: "jimsimport";
};
export const jimsimportModels = (menus: readonly JimsimportMenu[]) =>
  menus.flatMap((menu) =>
    menu.models.map((model) => ({ make: menu.make, model })),
  );
const usable = (value: string) =>
  /[A-Z0-9]/i.test(value) &&
  !/^(?:other|unknown|n\/?a|none|null|undefined|[-?]+)$/i.test(value);
function photo(record: JimsimportRecord) {
  const url = URL.parse(record.image ?? "");
  const prefix = "/nn38/images/" + record.stock + "/";
  return url &&
    url.origin === "https://da8h1v3w8q6n5.cloudfront.net" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    !url.search &&
    url.pathname.startsWith(prefix + record.stock + "_") &&
    /_\d+\.(?:jpg|jpeg|png)$/i.test(url.pathname)
    ? url.href
    : null;
}
export function assessJimsimportRecord(
  record: JimsimportRecord,
  context: ReturnType<typeof jimsimportModels>[number],
) {
  const rawMake = context.make.label.replaceAll("_", " ");
  const rawLeaf = context.model.label.replaceAll("_", " ");
  // Delimit the explicit Make/Model title with its own published parent once.
  // Some native model labels already contain their make, as at AUDI A3.
  const titleOk =
    record.title === rawMake + " " + rawLeaf ||
    (record.title === rawLeaf &&
      (rawLeaf === rawMake || rawLeaf.startsWith(rawMake + " ")));
  const model =
    titleOk && record.title.startsWith(rawMake + " ")
      ? record.title.slice(rawMake.length + 1)
      : titleOk && record.title === rawMake && rawLeaf === rawMake
        ? rawLeaf
        : "";
  const make = normalizeCanonicalMake(rawMake),
    year = Number(record.year);
  const vin = inventoryVin(record.vin ?? "", record.year);
  const reasons: string[] = [];
  if (!vin) reasons.push("missing-or-invalid-native-identity");
  if (
    !/^\d{4}$/.test(record.year) ||
    year < 1886 ||
    year > new Date().getUTCFullYear() + 1
  )
    reasons.push("missing-or-invalid-explicit-four-digit-year");
  if (!titleOk || !make || !usable(model))
    reasons.push("missing-or-conflicting-explicit-native-make-model");
  const destinations = [...new Set(record.destinations)];
  const url =
    destinations.length === 1
      ? jimsimportOwnedUrl(destinations[0] ?? "")
      : null;
  const parts = url?.pathname.split("/").filter(Boolean) ?? [];
  if (
    !url ||
    parts.length !== 5 ||
    !record.stock ||
    parts.slice(0, 3).join("/") !==
      context.model.path.replace(/^\//, "").replace(/\/$/, "") ||
    parts[3] !== record.stock ||
    parts[4] !== record.year ||
    record.id !== record.stock
  )
    reasons.push("invalid-native-stock-year-or-context-destination-join");
  // Compare raw native make/model and literal destinations before canonical
  // display normalization. A rejected row still contributes identity claims.
  const claims = {
    year: record.year,
    make: rawMake,
    title: record.title,
    vin: record.vin?.toUpperCase() ?? "",
    destinations,
  };
  const validVins = [
    ...new Set(
      [
        record.vin ?? "",
        ...[...(record.vin ?? "").matchAll(/\b[A-HJ-NPR-Z0-9]{17}\b/gi)].map(
          (match) => match[0],
        ),
      ].flatMap((value) => {
        const v = inventoryVin(value, record.year);
        return v ? [v] : [];
      }),
    ),
  ];
  const vehicle: JimsimportVehicle | null =
    !reasons.length && vin && make && url
      ? {
          source: "jimsimport",
          vin,
          year,
          make,
          model,
          stockNumber: record.stock,
          imageUrl: photo(record),
          color: null,
          availableDate: null,
          engine: null,
          transmission: null,
          trim: null,
          locationCode: JIMSIMPORT_YARD.code,
          locationName: JIMSIMPORT_YARD.name,
          locationCity: JIMSIMPORT_YARD.city,
          state: "Florida",
          stateAbbr: "FL",
          lat: JIMSIMPORT_YARD.lat,
          lng: JIMSIMPORT_YARD.lng,
          section: null,
          row: null,
          space: null,
          detailsUrl: url.href,
          partsUrl: null,
          pricesUrl: null,
        }
      : null;
  return { record, claims, vin, validVins, reasons, vehicle };
}
export function jimsimportSnapshot(
  menus: readonly JimsimportMenu[],
  pages: readonly JimsimportPage[],
) {
  const frontier = jimsimportModels(menus);
  if (
    frontier.length !== pages.length ||
    pages.some(
      (p, i) =>
        p.makePath !== frontier[i]?.make.path ||
        p.modelPath !== frontier[i]?.model.path ||
        (p.records.length === 0) !== p.nativeEmpty,
    )
  )
    throw new Error(
      "Jim's Import snapshot is not the complete ordered native model frontier",
    );
  const assessed = pages.flatMap((page, i) => {
    const context = frontier[i];
    if (!context) throw new Error("Jim's Import model context was lost");
    return page.records.map((record) =>
      assessJimsimportRecord(record, context),
    );
  });
  const vins = new Map<string, Set<number>>(),
    destinations = new Map<string, Set<number>>();
  const add = (
    groups: Map<string, Set<number>>,
    key: string,
    index: number,
  ) => {
    const group = groups.get(key) ?? new Set<number>();
    group.add(index);
    groups.set(key, group);
  };
  const quarantine = new Set<number>();
  assessed.forEach((row, i) => {
    for (const vin of row.validVins) add(vins, vin, i);
    for (const url of row.claims.destinations) add(destinations, url, i);
    if (row.validVins.length > 1 || row.claims.destinations.length > 1)
      quarantine.add(i);
  });
  const conflicts: {
    domain: "vin" | "destination";
    value: string;
    recordIndices: number[];
  }[] = [];
  for (const [domain, groups] of [
    ["vin", vins],
    ["destination", destinations],
  ] as const)
    for (const [value, indices] of groups) {
      const values = new Set(
        [...indices].map((i) => JSON.stringify(assessed[i]?.claims)),
      );
      if (values.size > 1) {
        conflicts.push({ domain, value, recordIndices: [...indices] });
        for (const i of indices) quarantine.add(i);
      }
    }
  let previous = -1;
  while (previous !== quarantine.size) {
    previous = quarantine.size;
    for (const groups of [vins, destinations])
      for (const indices of groups.values())
        if ([...indices].some((i) => quarantine.has(i)))
          for (const i of indices) quarantine.add(i);
  }
  const vehicles = new Map<string, JimsimportVehicle>();
  const rejected: { url: string | null; reasons: string[] }[] = [];
  const accounting = {
    recordsProcessed: assessed.length,
    recordsRejected: 0,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  };
  assessed.forEach((row, i) => {
    if (!row.vehicle || quarantine.has(i)) {
      accounting.recordsRejected++;
      rejected.push({
        url: row.record.destinations[0] ?? null,
        reasons: [
          ...row.reasons,
          ...(quarantine.has(i) ? ["conflicting-native-required-claims"] : []),
        ],
      });
    } else {
      const prior = vehicles.get(row.vehicle.vin);
      if (prior) {
        accounting.duplicateVehicles++;
        for (const key of ["imageUrl", "stockNumber"] as const)
          if (prior[key] !== row.vehicle[key]) prior[key] = null;
      } else vehicles.set(row.vehicle.vin, { ...row.vehicle });
    }
  });
  return {
    vehicles: [...vehicles.values()],
    accounting,
    rejected,
    conflicts,
    observedVins: [...vins.keys()].sort(),
  };
}
export function validateJimsimportSnapshot(
  snapshot: ReturnType<typeof jimsimportSnapshot>,
  previous: number | null = null,
) {
  const a = snapshot.accounting,
    n = snapshot.vehicles.length;
  if (previous !== null && (!Number.isSafeInteger(previous) || previous < 0))
    throw new Error("Jim's Import previous count must be nonnegative or null");
  if (
    n < 1_216 ||
    a.recordsProcessed !== n + a.recordsRejected + a.duplicateVehicles ||
    a.recordsExcluded !== 0 ||
    a.recordsRejected / a.recordsProcessed >
      SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles / a.recordsProcessed >
      SourceValidationPolicy.maximumDuplicateRatio ||
    (previous !== null &&
      n < previous * SourceValidationPolicy.minimumPreviousRunRatio)
  )
    throw new Error(
      "Jim's Import complete census failed the 1216-donor floor, rejection, duplicate, reconciliation or previous-count guards; prior inventory is preserved",
    );
}
