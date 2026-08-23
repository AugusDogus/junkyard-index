import { describe, expect, test } from "bun:test";
import {
  SourceValidationPolicy,
  validateSourceSnapshot,
} from "./source-validation";

function healthyRow52() {
  return {
    source: "row52" as const,
    terminal: true,
    uniqueVehicles: SourceValidationPolicy.minimumUniqueInventory.row52,
    vehiclesProcessed: SourceValidationPolicy.minimumUniqueInventory.row52,
    duplicateVehicles: 0,
    rejectedVehicles: 0,
    errors: [],
    previousAcceptedCount: null,
  };
}

describe("source snapshot validation", () => {
  test("accepts terminal inventory at its source-specific minimum", () => {
    expect(validateSourceSnapshot(healthyRow52())).toEqual({
      status: "accepted",
      errors: [],
    });
  });

  test("rejects clean-empty and truncated provider results", () => {
    const empty = validateSourceSnapshot({
      ...healthyRow52(),
      uniqueVehicles: 0,
      vehiclesProcessed: 0,
    });
    expect(empty.status).toBe("rejected");

    const truncated = validateSourceSnapshot({
      ...healthyRow52(),
      uniqueVehicles: 20_000,
      vehiclesProcessed: 20_000,
      previousAcceptedCount: 100_000,
    });
    expect(truncated).toMatchObject({ status: "rejected" });
  });

  test("rejects duplicate-heavy, rejection-heavy, and nonterminal results", () => {
    const validation = validateSourceSnapshot({
      ...healthyRow52(),
      terminal: false,
      uniqueVehicles: 10_000,
      duplicateVehicles: 10_000,
      rejectedVehicles: 5_000,
    });
    expect(validation.status).toBe("rejected");
    if (validation.status === "rejected") {
      expect(
        validation.errors.some((error) => error.includes("terminal")),
      ).toBe(true);
      expect(
        validation.errors.some((error) => error.includes("duplicate")),
      ).toBe(true);
      expect(
        validation.errors.some((error) => error.includes("rejection")),
      ).toBe(true);
    }
  });
});
