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
    { source: "ipullupull", count: 4_009 },
    { source: "upullitwa", count: 2_480 },
    { source: "partsgalore", count: 1_059 },
    { source: "chesterfield", count: 2_111 },
    { source: "midway", count: 763 },
    { source: "rightway", count: 543 },
    { source: "ddauto", count: 67 },
    { source: "rivervalley", count: 1_553 },
    { source: "fenix", count: 4_595 },
    { source: "importapart", count: 75 },
    { source: "bigtruckpage", count: 48 },
    { source: "denton", count: 2_297 },
    { source: "oem", count: 2_158 },
    { source: "dutchers", count: 579 },
    { source: "chasencars", count: 661 },
    { source: "oemgarage", count: 239 },
    { source: "hagerman", count: 5 },
    { source: "kandr", count: 48 },
    { source: "jimsimport", count: 3649 },
    { source: "beavers", count: 278 },
    { source: "indianriver", count: 1_049 },
    { source: "army", count: 231 },
    { source: "idipull", count: 555 },
    { source: "pullsavewa", count: 2_065 },
    { source: "littleton", count: 1_079 },
    { source: "michigantruck", count: 173 },
    { source: "joliet", count: 1_392 },
    { source: "alln1", count: 1_093 },
    { source: "pickers", count: 540 },
    { source: "pipes", count: 535 },
    { source: "millerstown", count: 1_087 },
    { source: "pickapartva", count: 7_422 },
    { source: "mccauley", count: 24 },
    { source: "aviation", count: 2_326 },
    { source: "chaz", count: 1_063 },
    { source: "citymotors", count: 171 },
    { source: "awap", count: 183 },
    { source: "clearsalvage", count: 177 },
    { source: "aplus", count: 1_222 },
    { source: "central", count: 5_957 },
    { source: "coutu", count: 1_254 },
    { source: "kodak", count: 38 },
    { source: "rohner", count: 286 },
    { source: "pratt", count: 5_931 },
    { source: "cars4parts", count: 71 },
    { source: "meeks", count: 1_415 },
    { source: "brandywine", count: 1_807 },
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

  test.each([
    { source: "denton", minimum: 2_000, accepted: 2_297, rejected: 83 },
    { source: "oem", minimum: 1_800, accepted: 2_158, rejected: 43 },
    { source: "dutchers", minimum: 500, accepted: 579, rejected: 7 },
    { source: "chasencars", minimum: 550, accepted: 661, rejected: 19 },
    { source: "oemgarage", minimum: 200, accepted: 239, rejected: 19 },
    { source: "hagerman", minimum: 5, accepted: 5, rejected: 0 },
    { source: "kandr", minimum: 40, accepted: 48, rejected: 1 },
    { source: "jimsimport", minimum: 3000, accepted: 3649, rejected: 367 },
    { source: "beavers", minimum: 240, accepted: 278, rejected: 12 },
    { source: "indianriver", minimum: 900, accepted: 1_049, rejected: 7 },
    { source: "kodak", minimum: 30, accepted: 38, rejected: 3 },
    { source: "rohner", minimum: 240, accepted: 286, rejected: 0 },
    { source: "pratt", minimum: 5_000, accepted: 5_931, rejected: 603 },
    { source: "cars4parts", minimum: 56, accepted: 71, rejected: 4 },
    { source: "meeks", minimum: 1_200, accepted: 1_415, rejected: 15 },
    { source: "brandywine", minimum: 1_500, accepted: 1_807, rejected: 11 },
  ] as const)(
    "$source preserves its floor and existing raw rejection guard",
    ({ source, minimum, accepted, rejected }) => {
      expect(SourceValidationPolicy.minimumUniqueInventory[source]).toBe(
        minimum,
      );
      const measured = {
        ...healthyRow52(),
        source,
        uniqueVehicles: accepted,
        vehiclesProcessed: accepted + rejected,
        rejectedVehicles: rejected,
      };
      expect(validateSourceSnapshot(measured).status).toBe("accepted");
      expect(
        validateSourceSnapshot({
          ...measured,
          uniqueVehicles: minimum - 1,
          rejectedVehicles: 0,
        }).status,
      ).toBe("rejected");
      expect(
        validateSourceSnapshot({ ...measured, rejectedVehicles: accepted })
          .status,
      ).toBe("rejected");
      expect(
        validateSourceSnapshot({ ...measured, duplicateVehicles: accepted })
          .status,
      ).toBe("rejected");
    },
  );
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
