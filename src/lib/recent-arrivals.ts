import { VehicleName } from "./vehicle-name";

type Arrival = { make: string; model: string; imageUrl: string | null };

function identity({ make, model }: Arrival): string {
  const makeKey = VehicleName.makeKey(make) ?? make.trim().toUpperCase();
  const modelKey =
    VehicleName.modelKey(make, model) ?? model.trim().toUpperCase();
  return `${makeKey}|${modelKey}`;
}

/**
 * A varied showcase of new arrivals. One ingestion batch can list dozens of
 * the same model in a row, so this keeps one of each make and model, those
 * with photos first, and repeats a model only when there are too few to fill
 * `count`. Order within each group follows the input (newest first).
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
    const varied: Vehicle[] = [];
    const repeats: Vehicle[] = [];
    for (const vehicle of ranked) {
      const key = identity(vehicle);
      if (seen.has(key)) {
        repeats.push(vehicle);
      } else {
        seen.add(key);
        varied.push(vehicle);
      }
    }
    return [...varied, ...repeats].slice(0, count);
  },
} as const;
