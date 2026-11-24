import { VehicleName } from "./vehicle-name";

type Arrival = {
  make: string;
  model: string;
  imageUrl: string | null;
  source: string;
  locationCode: string;
};

function identity({ make, model }: Arrival): string {
  const makeKey = VehicleName.makeKey(make) ?? make.trim().toUpperCase();
  const modelKey =
    VehicleName.modelKey(make, model) ?? model.trim().toUpperCase();
  return `${makeKey}|${modelKey}`;
}

/**
 * A varied showcase of new arrivals. One yard's ingestion batch can fill the
 * newest arrivals, often with dozens of one model, so this keeps one of each
 * make and model, those with photos first, and takes one from each yard
 * before a second from any. A model repeats only when there are too few to
 * fill `count`. Order otherwise follows the input (newest first).
 */
export const RecentArrivals = {
  pick<Vehicle extends Arrival>(
    vehicles: readonly Vehicle[],
    count: number,
  ): Vehicle[] {
    const ranked = [
      ...vehicles.filter((vehicle) => vehicle.imageUrl),
      ...vehicles.filter((vehicle) => !vehicle.imageUrl),
    ];
    const seen = new Set<string>();
    const perYard = new Map<string, number>();
    return ranked
      .map((vehicle, index) => {
        const key = identity(vehicle);
        const repeat = seen.has(key);
        seen.add(key);
        const yard = JSON.stringify([vehicle.source, vehicle.locationCode]);
        const yardRank = perYard.get(yard) ?? 0;
        if (!repeat) perYard.set(yard, yardRank + 1);
        return {
          vehicle,
          index,
          repeat,
          photo: Boolean(vehicle.imageUrl),
          yardRank,
        };
      })
      .sort(
        (a, b) =>
          Number(a.repeat) - Number(b.repeat) ||
          Number(b.photo) - Number(a.photo) ||
          a.yardRank - b.yardRank ||
          a.index - b.index,
      )
      .slice(0, count)
      .map(({ vehicle }) => vehicle);
  },
} as const;
