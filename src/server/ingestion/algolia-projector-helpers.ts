import { YardName } from "~/lib/yard-name";
import { vehicle } from "~/schema";
import { isIngestionSource } from "~/lib/ingestion-source";
import { toAlgoliaRecord, type CanonicalVehicle } from "./types";

export function mapDbVehicleToCanonical(
  row: typeof vehicle.$inferSelect,
): CanonicalVehicle {
  if (!isIngestionSource(row.source)) {
    throw new Error(
      `Vehicle ${row.vin} has unsupported ingestion source ${row.source}`,
    );
  }
  return {
    vin: row.vin,
    source: row.source,
    year: row.year,
    make: row.make,
    model: row.model,
    color: row.color,
    stockNumber: row.stockNumber,
    imageUrl: row.imageUrl,
    availableDate: row.availableDate,
    locationCode: row.locationCode,
    locationName: YardName.resolve({
      source: row.source,
      name: row.locationName,
      city: row.locationCity ?? "Unknown",
      inventoryUrl: row.detailsUrl,
    }),
    locationCity: row.locationCity ?? "Unknown",
    state: row.state,
    stateAbbr: row.stateAbbr,
    lat: row.lat,
    lng: row.lng,
    section: row.section,
    row: row.row,
    space: row.space,
    detailsUrl: row.detailsUrl,
    partsUrl: row.partsUrl,
    pricesUrl: row.pricesUrl,
    engine: row.engine,
    trim: row.trim,
    transmission: row.transmission,
  };
}

/** Shared by incremental publication and every full reindex entry point. */
export function mapDbVehicleToAlgolia(row: typeof vehicle.$inferSelect) {
  return toAlgoliaRecord(
    mapDbVehicleToCanonical(row),
    row.firstSeenAt,
    row.missingSinceAt,
    row.missingRunCount ?? 0,
    row.observedArrivalAt,
  );
}

export function partitionVehicleChanges(
  changes: Array<{
    id: number;
    vin: string;
    changeType: string;
  }>,
): { deleteVins: string[]; upsertVins: string[] } {
  const latestChangeByVin = new Map<
    string,
    { id: number; vin: string; changeType: string }
  >();
  for (const change of changes) {
    const previous = latestChangeByVin.get(change.vin);
    if (!previous || change.id > previous.id) {
      latestChangeByVin.set(change.vin, change);
    }
  }
  const latestChanges = [...latestChangeByVin.values()];

  return {
    deleteVins: latestChanges
      .filter((change) => change.changeType === "delete")
      .map((change) => change.vin),
    upsertVins: latestChanges
      .filter((change) => change.changeType !== "delete")
      .map((change) => change.vin),
  };
}
