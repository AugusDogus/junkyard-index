import { UrgiisTenant } from "./urgiis-tenant";
export type { UrgiisTenant } from "./urgiis-tenant";
import type { CanonicalVehicle } from "./types";
import type { ConnectorChunkAccounting } from "./connector-chunk";
import type { UrgiisControl, UrgiisRecord } from "./urgiis-schema";
import { assessIisRecord } from "./iis-record";
import { quarantineIisClaims } from "./iis-quarantine";
import { iisOwnedUrl } from "./urgiis-catalog";
import { normalizeCanonicalMake, normalizeRegion } from "./normalization";
import { SourceValidationPolicy } from "./source-validation";

export interface UrgiisModelPage {
  make: UrgiisControl;
  model: UrgiisControl;
  records: UrgiisRecord[];
  hash: string;
}
export function urgiisSnapshot(
  pages: readonly UrgiisModelPage[],
  tenant: UrgiisTenant,
  sellers: ReadonlyMap<string, string | null> = new Map(),
  arrivals: readonly UrgiisRecord[] = [],
) {
  const all = [
    ...pages.flatMap((p) =>
      p.records.map((record) => ({
        record,
        context: { kind: "model" as const, make: p.make, model: p.model },
      })),
    ),
    ...arrivals.map((record) => ({
      record,
      context: { kind: "arrivals" as const },
    })),
  ];
  const published = pages.map(({ make, model }) => ({ make, model }));
  // Explicitly qualified generic part-bin stocks are not donor cars. A real
  // VIN or yard photograph overrides this exclusion and enters normal validation.
  const rows = all.filter(({ record }) => {
    if (
      record.stock !== null &&
      tenant.placeholderStocks.includes(record.stock) &&
      !record.vins.some((v) => v.trim()) &&
      !record.inquiries.some((q) => /\bVIN\b[\s:]*[A-Z0-9]/i.test(q)) &&
      !record.image?.includes("cloudfront.net/")
    )
      return false;
    if (tenant.skipBlankVin && !record.vins.some((v) => v.trim())) return false;
    const code = record.image?.match(
      /^https:\/\/da8h1v3w8q6n5\.cloudfront\.net\/([^/]+)\/images\//,
    )?.[1];
    if (tenant.attribution.kind === "photo")
      return code !== undefined && tenant.photoCodes.includes(code);
    if (code !== undefined && !tenant.photoCodes.includes(code))
      throw new Error(
        `IIS ${tenant.code} contains unexpected supplier photo ${code}; yard attribution must be requalified before emission`,
      );
    return true;
  });
  const assessments = rows.map(({ record, context }) =>
    assessIisRecord(
      record,
      context,
      {
        ownedUrl: (raw) => iisOwnedUrl(raw, tenant),
        pathStyle: tenant.pathStyle,
        requireInquiry: false,
      },
      published,
    ),
  );
  const { quarantine } = quarantineIisClaims(assessments);
  const accounting: ConnectorChunkAccounting = {
    recordsProcessed: all.length,
    recordsExcluded: all.length - rows.length,
    recordsRejected: 0,
    duplicateVehicles: 0,
  };
  const vehicles = new Map<string, CanonicalVehicle>();
  const observedVins = new Set<string>();
  const modeledVins = new Set<string>();
  const metadata = new Map<
    string,
    {
      stockNumber: Set<string>;
      imageUrl: Set<string>;
      availableDate: Set<string>;
    }
  >();
  assessments.forEach((a, index) => {
    if (
      a.reasons.length ||
      quarantine.has(index) ||
      a.vin === null ||
      a.year === null ||
      a.nativeIdentity === null ||
      a.destination === null
    ) {
      accounting.recordsRejected++;
      for (const vin of a.validVinClaims) observedVins.add(vin);
      return;
    }
    const yard = UrgiisTenant.yardForSeller(
      tenant,
      sellers.get(a.destination) ?? null,
    );
    if (yard === null) {
      accounting.recordsRejected++;
      observedVins.add(a.vin);
      return;
    }
    if (rows[index]?.context.kind === "model") modeledVins.add(a.vin);
    const record = a.record;
    const image = record.image === null ? null : URL.parse(record.image);
    const imageUrl =
      image &&
      image.origin === "https://da8h1v3w8q6n5.cloudfront.net" &&
      !image.search &&
      !image.hash &&
      !image.username &&
      !image.password &&
      /\.(?:jpe?g|png|webp)$/i.test(image.pathname)
        ? image.href
        : null;
    const rawDate = record.date;
    const date =
      rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? new Date(rawDate + "T00:00:00Z")
        : null;
    const availableDate =
      date &&
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === rawDate
        ? rawDate
        : null;
    const region = normalizeRegion(yard.state);
    const vehicle: CanonicalVehicle = {
      source: "urgiis",
      vin: a.vin,
      year: a.year,
      make: normalizeCanonicalMake(a.nativeIdentity.make),
      model: a.nativeIdentity.model,
      stockNumber: record.stock,
      imageUrl,
      availableDate,
      color: null,
      locationCode: yard.code,
      locationName: yard.name,
      locationCity: yard.city,
      state: region.state,
      stateAbbr: region.stateAbbr,
      lat: yard.lat,
      lng: yard.lng,
      detailsUrl: a.destination,
      partsUrl: null,
      pricesUrl: null,
      section: null,
      row: null,
      space: null,
      engine: null,
      trim: null,
      transmission: null,
    };
    const values = metadata.get(a.vin) ?? {
      stockNumber: new Set<string>(),
      imageUrl: new Set<string>(),
      availableDate: new Set<string>(),
    };
    for (const k of ["stockNumber", "imageUrl", "availableDate"] as const)
      if (vehicle[k] !== null) values[k].add(vehicle[k]);
    metadata.set(a.vin, values);
    if (vehicles.has(a.vin)) accounting.duplicateVehicles++;
    else vehicles.set(a.vin, vehicle);
  });
  for (const [vin, vehicle] of vehicles) {
    // Arrivals can precede the parts catalog. Link these donors to the native
    // page that actually displays them, after identity/quarantine checks finish.
    if (!modeledVins.has(vin) && tenant.arrivalsPath)
      vehicle.detailsUrl = tenant.origin + tenant.arrivalsPath;
    const values = metadata.get(vin);
    if (!values) throw new Error("IIS accepted VIN lost metadata");
    for (const k of ["stockNumber", "imageUrl", "availableDate"] as const)
      vehicle[k] = values[k].size === 1 ? ([...values[k]][0] ?? null) : null;
  }
  return {
    vehicles: [...vehicles.values()],
    observedVins: [...observedVins],
    modeledVehicles: modeledVins.size,
    accounting,
  };
}
export function validateUrgiisSnapshot(
  snapshot: ReturnType<typeof urgiisSnapshot>,
  tenant: UrgiisTenant,
) {
  const { accounting: a, vehicles } = snapshot;
  const eligible = a.recordsProcessed - a.recordsExcluded;
  if (tenant.attribution.kind === "seller") {
    for (const yard of UrgiisTenant.yards(tenant)) {
      const minimum = tenant.attribution.minimumByYard[yard.code];
      const accepted = vehicles.filter(
        (v) => v.locationCode === yard.code,
      ).length;
      if (minimum === undefined || minimum < 1 || accepted < minimum)
        throw new Error(
          `IIS ${yard.code} has ${accepted} donors, below its qualified yard floor ${minimum}; preserve prior inventory`,
        );
    }
  }
  if (
    snapshot.modeledVehicles === 0 ||
    vehicles.length < tenant.minimumInventory ||
    a.recordsRejected >
      eligible * SourceValidationPolicy.maximumRejectionRatio ||
    a.duplicateVehicles >
      eligible * SourceValidationPolicy.maximumDuplicateRatio ||
    vehicles.length + a.recordsRejected + a.duplicateVehicles !== eligible
  )
    throw new Error(
      `IIS ${tenant.code} failed admission: ${vehicles.length} accepted (minimum ${tenant.minimumInventory}; ${snapshot.modeledVehicles} from model pages), ${a.recordsRejected}/${eligible} rejected, ${a.duplicateVehicles} duplicates. Prior inventory is preserved; inspect saved responses.`,
    );
}
