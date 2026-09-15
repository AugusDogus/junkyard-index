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
  test.each([
    { source: "pullnsave", count: 11_721 },
    { source: "tearapart", count: 1_671 },
    { source: "wrenchapart", count: 11_460 },
    { source: "upullrparts", count: 3_298 },
  ] as const)(
    "accepts the measured $source catalog but rejects a collapsed snapshot",
    ({ source, count }) => {
      const measured = {
        ...healthyRow52(),
        source,
        uniqueVehicles: count,
        vehiclesProcessed: count,
      };
      expect(validateSourceSnapshot(measured).status).toBe("accepted");
      expect(
        validateSourceSnapshot({
          ...measured,
          uniqueVehicles: 0,
          vehiclesProcessed: 0,
        }).status,
      ).toBe("rejected");
      expect(
        validateSourceSnapshot({ ...measured, terminal: false }).status,
      ).toBe("rejected");
      expect(
        validateSourceSnapshot({
          ...measured,
          previousAcceptedCount: count * 3,
        }).status,
      ).toBe("rejected");
    },
  );
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
