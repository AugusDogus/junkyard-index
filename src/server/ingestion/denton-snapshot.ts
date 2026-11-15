import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { DentonPage, DentonRecord } from "./denton-catalog";
import { dentonBoundary, dentonOwnedUrl } from "./denton-html";
import { inventoryVin } from "./inventory-vin";
import { SourceValidationPolicy } from "./source-validation";
import { DENTON_PRESERVED_DESTINATION_FAILURES } from "./denton-yard-metadata";

export interface DentonVehicle {
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
  mileage: number | null;
}
const one = (values: readonly string[]) => {
  const distinct = [...new Set(values.map((value) => value.trim()))];
  return distinct.length === 1 ? (distinct[0] ?? "") : "";
};
function nativeSegment(value: string | undefined) {
  try {
    return value === undefined ? null : decodeURIComponent(value);
  } catch {
    return null;
  }
}
// The native router uses both model-only and make-prefixed model tokens,
// for example CR~V, FORD_F150_PICKUP and DODGE_1500_PICKUP.
const routeToken = (value: string) =>
  value.replaceAll("/", ".").replaceAll("-", "~").replaceAll(" ", "_");
function assessment(record: DentonRecord) {
  const values = (label: string) =>
    record.fields
      .filter((field) => field.label === label)
      .map((field) => field.value);
  const yearRaw = one(values("year"));
  const year =
    /^\d{4}$/.test(yearRaw) &&
    Number(yearRaw) >= 1886 &&
    Number(yearRaw) <= new Date().getUTCFullYear() + 1
      ? Number(yearRaw)
      : null;
  const vins = [
    ...new Set(
      values("vin")
        .flatMap((vin) =>
          (values("year").length ? values("year") : [""]).map((year) =>
            inventoryVin(vin, year),
          ),
        )
        .filter((vin) => vin !== null),
    ),
  ];
  const vin = inventoryVin(one(values("vin")), yearRaw);
  const title = one(values("make/model"));
  const context = record.context;
  // Native arrivals publish NISSAN/DATSUN with NISSAN.DATSUN destinations,
  // while the literal browse menu calls the same make NISSAN. Only this
  // observed title/path pair may resolve to that published make control.
  const alias =
    context.kind === "arrivals" &&
    title.startsWith("NISSAN/DATSUN ") &&
    context.makes.some((control) => control.label === "NISSAN") &&
    record.destinations.every((literal) =>
      literal === null
        ? false
        : dentonOwnedUrl(literal)?.pathname.startsWith(
            "/used-parts/NISSAN.DATSUN/",
          ),
    );
  const make =
    context.kind === "model"
      ? context.make.label
      : alias
        ? "NISSAN"
        : ([...context.makes]
            .sort((a, b) => b.label.length - a.label.length)
            .find((control) => title.startsWith(control.label + " "))?.label ??
          "");
  const nativeMake = alias ? "NISSAN/DATSUN" : make;
  const model = title.startsWith(nativeMake + " ")
    ? title.slice(nativeMake.length + 1).trim()
    : "";
  const reasons: string[] = [];
  if (vin === null) reasons.push("missing-or-conflicting-native-identity");
  if (year === null) reasons.push("missing-or-conflicting-native-year");
  if (
    !make ||
    !model ||
    /^(?:unknown|other|n\/?a)$/i.test(model) ||
    (context.kind === "model" &&
      ![`${make} ${context.model.label}`, context.model.label].includes(title))
  )
    reasons.push("missing-or-conflicting-native-make-model");
  const urls = record.destinations.map((literal) =>
    literal === null ? null : dentonOwnedUrl(literal),
  );
  const destination = urls[0];
  if (
    urls.some(
      (url) =>
        url &&
        DENTON_PRESERVED_DESTINATION_FAILURES.some(
          (failure) => url.href.replace(/\/$/, "") === failure.url,
        ),
    )
  )
    reasons.push("preserved-failed-native-destination");
  const segments = destination?.pathname.split("/") ?? [];
  if (
    !destination ||
    urls.some((url) => !url || url.href !== destination.href) ||
    !/^\/used-parts\/[^/]+\/[^/]+\/[^/]+\/\d{4}$/.test(destination.pathname) ||
    segments[5] !== yearRaw
  )
    reasons.push("missing-or-conflicting-native-destination");
  if (
    context.kind === "model" &&
    destination &&
    segments.slice(0, 4).join("/") !==
      new URL(context.model.url).pathname.replace(/\/$/, "")
  )
    reasons.push("native-model-destination-parent-conflict");
  if (
    context.kind === "arrivals" &&
    (nativeSegment(segments[2]) !== routeToken(nativeMake) ||
      ![routeToken(model), routeToken(title)].includes(
        nativeSegment(segments[3]) ?? "",
      ))
  )
    reasons.push("native-arrival-destination-parent-conflict");
  const stock = one(values("stock")) || null;
  if (destination && stock && nativeSegment(segments[4]) !== stock)
    reasons.push("native-stock-destination-conflict");
  const images = record.images.filter((image) => {
    if (!image || !stock) return false;
    const url = URL.parse(image);
    const prefix = `https://da8h1v3w8q6n5.cloudfront.net/ks12/images/${encodeURIComponent(stock)}/`;
    return (
      url &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search &&
      url.href.startsWith(prefix) &&
      /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
    );
  });
  const ownershipSpill = record.images.some((image) => {
    const url = image ? URL.parse(image) : null;
    return (
      url?.hostname === "da8h1v3w8q6n5.cloudfront.net" &&
      /^\/[^/]+\/images\//.test(url.pathname) &&
      !url.pathname.startsWith("/ks12/images/")
    );
  });
  if (ownershipSpill) reasons.push("foreign-native-supplier-spill");
  const mileageRaw = one(values("miles"));
  const mileage =
    /^\d+$/.test(mileageRaw) && Number.isSafeInteger(Number(mileageRaw))
      ? Number(mileageRaw)
      : null;
  const dateRaw = one(values("enter date"));
  const validDate =
    /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) &&
    Number.isFinite(Date.parse(dateRaw)) &&
    new Date(dateRaw).toISOString().slice(0, 10) === dateRaw;
  const vehicle: DentonVehicle | null =
    vin !== null && year !== null && destination && !reasons.length
      ? {
          vin,
          year,
          make,
          model,
          detailsUrl: destination.href,
          stockNumber:
            stock &&
            !/^(?:unknown|none|null|undefined|n\/?a|[-?]+)$/i.test(stock)
              ? stock
              : null,
          imageUrl: images[0] ?? null,
          availableDate: validDate ? dateRaw : null,
          color: null,
          row: null,
          mileage,
        }
      : null;
  return {
    record,
    vins,
    vehicle,
    reasons,
    yearRaw,
    make,
    model,
    destinations: urls.flatMap((url) => (url ? [url.href] : [])),
    ownershipSpill,
  };
}

function build(pages: readonly DentonPage[]) {
  const assessed = pages.flatMap((page) => page.records.map(assessment));
  const identities = new Map<string, Set<string>>();
  const destinations = new Map<string, Set<string>>();
  for (const row of assessed) {
    for (const vin of row.vins) {
      const claims = identities.get(vin) ?? new Set<string>();
      claims.add(JSON.stringify([row.yearRaw, row.make, row.model]));
      identities.set(vin, claims);
      for (const destination of row.destinations) {
        const bound = destinations.get(destination) ?? new Set<string>();
        bound.add(vin);
        destinations.set(destination, bound);
      }
    }
  }
  const conflicts = new Set(
    [...identities].filter(([, claims]) => claims.size > 1).map(([vin]) => vin),
  );
  for (const bound of destinations.values())
    if (bound.size > 1) for (const vin of bound) conflicts.add(vin);
  const vehicles = new Map<string, DentonVehicle>();
  const metadata = new Map<
    string,
    {
      stockNumber: Set<string>;
      imageUrl: Set<string>;
      availableDate: Set<string>;
      mileage: Set<number>;
    }
  >();
  const observedVins = new Set<string>();
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: assessed.length,
    recordsExcluded: 0,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const rejections: { record: DentonRecord; reasons: string[] }[] = [];
  for (const row of assessed) {
    if (!row.vehicle || row.vins.some((vin) => conflicts.has(vin))) {
      accounting.recordsRejected++;
      for (const vin of row.vins) observedVins.add(vin);
      rejections.push({
        record: row.record,
        reasons: [
          ...row.reasons,
          ...(row.vins.some((vin) => conflicts.has(vin))
            ? ["native-identity-conflict"]
            : []),
        ],
      });
    } else {
      const values = metadata.get(row.vehicle.vin) ?? {
        stockNumber: new Set<string>(),
        imageUrl: new Set<string>(),
        availableDate: new Set<string>(),
        mileage: new Set<number>(),
      };
      for (const key of ["stockNumber", "imageUrl", "availableDate"] as const) {
        const value = row.vehicle[key];
        if (value !== null) values[key].add(value);
      }
      if (row.vehicle.mileage !== null) values.mileage.add(row.vehicle.mileage);
      metadata.set(row.vehicle.vin, values);
      const previous = vehicles.get(row.vehicle.vin);
      if (previous) {
        accounting.duplicateVehicles++;
      } else vehicles.set(row.vehicle.vin, { ...row.vehicle });
    }
  }
  for (const vehicle of vehicles.values()) {
    const values = metadata.get(vehicle.vin);
    if (!values)
      throw new Error(
        "Accepted Denton identity lost its optional metadata observations",
      );
    for (const key of ["stockNumber", "imageUrl", "availableDate"] as const)
      vehicle[key] =
        values[key].size === 1 ? ([...values[key]][0] ?? null) : null;
    vehicle.mileage =
      values.mileage.size === 1 ? ([...values.mileage][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    accounting,
    rejections,
    conflictingVins: [...conflicts],
    ownershipSpill: assessed.some((row) => row.ownershipSpill),
  };
}
export type DentonSnapshot = ReturnType<typeof build>;
export const DentonSnapshot = {
  build,
  /** A completed literal traversal supplies terminal. This pure check does not
   * establish graph completeness or authorize reconciliation by itself. */
  validate(
    snapshot: DentonSnapshot,
    options: {
      minimumUniqueInventory: number;
      previousAcceptedCount: number | null;
      terminal: boolean;
    },
  ) {
    return dentonBoundary("snapshot validation", () => {
      const { accounting, vehicles } = snapshot;
      if (snapshot.ownershipSpill)
        throw new Error(
          "Concrete foreign supplier inventory is mixed into the own-yard donor source",
        );
      if (!options.terminal)
        throw new Error(
          "Literal native donor traversal is incomplete; finish the graph before reconciliation",
        );
      if (
        !Number.isSafeInteger(options.minimumUniqueInventory) ||
        options.minimumUniqueInventory < 1 ||
        (options.previousAcceptedCount !== null &&
          (!Number.isSafeInteger(options.previousAcceptedCount) ||
            options.previousAcceptedCount < 0))
      )
        throw new Error(
          "Supply a positive inventory floor and a nonnegative authoritative prior accepted count or null",
        );
      if (
        accounting.recordsProcessed !==
        vehicles.length +
          accounting.recordsRejected +
          accounting.duplicateVehicles
      )
        throw new Error(
          `Accounting does not partition ${accounting.recordsProcessed} records into ${vehicles.length} accepted, ${accounting.recordsRejected} rejected and ${accounting.duplicateVehicles} duplicate observations`,
        );
      if (vehicles.length < options.minimumUniqueInventory)
        throw new Error(
          `Accepted ${vehicles.length} donors; qualified minimum is ${options.minimumUniqueInventory}`,
        );
      if (
        accounting.recordsRejected / accounting.recordsProcessed >
        SourceValidationPolicy.maximumRejectionRatio
      )
        throw new Error(
          `Required identity rejection is ${accounting.recordsRejected}/${accounting.recordsProcessed}, above the 10% limit`,
        );
      if (
        accounting.duplicateVehicles / accounting.recordsProcessed >
        SourceValidationPolicy.maximumDuplicateRatio
      )
        throw new Error(
          `Duplicate observations are ${accounting.duplicateVehicles}/${accounting.recordsProcessed}, above the 25% limit`,
        );
      if (
        options.previousAcceptedCount !== null &&
        vehicles.length <
          Math.floor(
            options.previousAcceptedCount *
              SourceValidationPolicy.minimumPreviousRunRatio,
          )
      )
        throw new Error(
          `Accepted inventory fell from ${options.previousAcceptedCount} to ${vehicles.length}, below the 50% prior-drift floor`,
        );
      return snapshot;
    });
  },
} as const;
