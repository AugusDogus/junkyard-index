import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { CanonicalVehicle } from "./types";
import { validatePublishedYardInventory } from "./published-yard-inventory";
export function validateCars4PartsPublishedYardInventory(
  database: LibSQLDatabase,
  current: Iterable<CanonicalVehicle>,
) {
  return validatePublishedYardInventory(database, current, "cars4parts");
}
