import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";

export function mapDbVehicleToCanonical(
  row: typeof vehicle.$inferSelect,
): CanonicalVehicle {
  const source: CanonicalVehicle["source"] =
    row.source === "row52"
      ? "row52"
      : row.source === "autorecycler"
        ? "autorecycler"
        : "pyp";
  return {
    vin: row.vin,
    source,
    year: row.year,
    make: row.make,
    model: row.model,
    color: row.color,
    stockNumber: row.stockNumber,
    imageUrl: row.imageUrl,
    availableDate: row.availableDate,
    locationCode: row.locationCode,
    locationName: row.locationName,
    locationCity: row.locationCity,
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
