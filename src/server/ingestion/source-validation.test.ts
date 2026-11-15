import { describe, expect, test } from "bun:test";
import {
  newestVehicleArrival,
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
    newestVehicleDate: new Date("2026-11-14T00:00:00Z"),
    validatedAt: new Date("2026-11-15T07:44:11Z"),
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
    { source: "utpap", count: 1_639 },
    { source: "tritown", count: 470 },
    { source: "whitebradstreet", count: 382 },
    { source: "midway", count: 1827 },
    { source: "rightway", count: 543 },
    { source: "ddauto", count: 67 },
    { source: "rivervalley", count: 1_553 },
    { source: "fenix", count: 4_595 },
    { source: "importapart", count: 75 },
    { source: "bigtruckpage", count: 48 },
    { source: "speedys", count: 1 },
    { source: "sandw", count: 624 },
    { source: "denton", count: 2_297 },
    { source: "scotts", count: 976 },
    { source: "oem", count: 2_158 },
    { source: "dutchers", count: 579 },
    { source: "chasencars", count: 661 },
    { source: "weberbrothers", count: 5_760 },
    { source: "oemgarage", count: 239 },
    { source: "hagerman", count: 5 },
    { source: "kandr", count: 48 },
    { source: "jimsimport", count: 3649 },
    { source: "lonestarimports", count: 2532 },
    { source: "alshned", count: 41 },
    { source: "hollanderstores", count: 35_000 },
    { source: "cstruck", count: 59 },
    { source: "heavytruckparts", count: 857 },
    { source: "beavers", count: 278 },
    { source: "indianriver", count: 1_049 },
    { source: "harrys", count: 4_000 },
    { source: "budget", count: 1_606 },
    { source: "army", count: 231 },
    { source: "idipull", count: 555 },
    { source: "bigd", count: 288 },
    { source: "pullsavewa", count: 2_065 },
    { source: "littleton", count: 1_079 },
    { source: "michigantruck", count: 173 },
    { source: "joliet", count: 1_392 },
    { source: "alln1", count: 1_093 },
    { source: "grandpajohns", count: 644 },
    { source: "pickers", count: 1928 },
    { source: "pipes", count: 535 },
    { source: "uwrench", count: 1_121 },
    { source: "millerstown", count: 1_087 },
    { source: "pickapartva", count: 7_422 },
    { source: "mccauley", count: 24 },
    { source: "rustyhook", count: 25 },
    { source: "aviation", count: 2_326 },
    { source: "chaz", count: 1_063 },
    { source: "citymotors", count: 171 },
    { source: "awap", count: 183 },
    { source: "clearsalvage", count: 177 },
    { source: "aplus", count: 1_222 },
    { source: "central", count: 5_957 },
    { source: "coutu", count: 1_254 },
    { source: "kodak", count: 38 },
    { source: "six03", count: 973 },
    { source: "rohner", count: 286 },
    { source: "pratt", count: 5_931 },
    { source: "cars4parts", count: 71 },
    { source: "meeks", count: 1_415 },
    { source: "brandywine", count: 1_807 },
    { source: "rmmdtp", count: 103 },
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
          previousAcceptedCount: Math.max(4, count * 3),
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
    { source: "speedys", minimum: 1, accepted: 1, rejected: 0 },
    { source: "sandw", minimum: 208, accepted: 624, rejected: 0 },
    { source: "denton", minimum: 765, accepted: 2_297, rejected: 83 },
    { source: "scotts", minimum: 325, accepted: 976, rejected: 88 },
    { source: "oem", minimum: 719, accepted: 2_158, rejected: 43 },
    { source: "dutchers", minimum: 193, accepted: 579, rejected: 7 },
    { source: "chasencars", minimum: 220, accepted: 661, rejected: 19 },
    { source: "weberbrothers", minimum: 1_920, accepted: 5_760, rejected: 63 },
    { source: "oemgarage", minimum: 79, accepted: 239, rejected: 19 },
    { source: "hagerman", minimum: 1, accepted: 5, rejected: 0 },
    { source: "kandr", minimum: 16, accepted: 48, rejected: 1 },
    { source: "jimsimport", minimum: 1_216, accepted: 3649, rejected: 367 },
    { source: "lonestarimports", minimum: 843, accepted: 2531, rejected: 9 },
    { source: "alshned", minimum: 13, accepted: 41, rejected: 2 },
    { source: "cstruck", minimum: 19, accepted: 59, rejected: 5 },
    { source: "heavytruckparts", minimum: 277, accepted: 838, rejected: 20 },
    { source: "beavers", minimum: 92, accepted: 278, rejected: 12 },
    { source: "bigd", minimum: 96, accepted: 288, rejected: 7 },
    { source: "indianriver", minimum: 349, accepted: 1_049, rejected: 7 },
    { source: "harrys", minimum: 1_368, accepted: 4_105, rejected: 177 },
    { source: "budget", minimum: 535, accepted: 1_606, rejected: 13 },
    { source: "kodak", minimum: 12, accepted: 38, rejected: 3 },
    { source: "six03", minimum: 324, accepted: 973, rejected: 60 },
    { source: "rohner", minimum: 95, accepted: 286, rejected: 0 },
    { source: "pratt", minimum: 1_977, accepted: 5_931, rejected: 603 },
    { source: "cars4parts", minimum: 24, accepted: 71, rejected: 4 },
    { source: "meeks", minimum: 471, accepted: 1_415, rejected: 15 },
    { source: "brandywine", minimum: 602, accepted: 1_807, rejected: 11 },
    { source: "rmmdtp", minimum: 34, accepted: 103, rejected: 1 },
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

  test("rejects a frozen feed whose newest vehicle is 3.5 months old", () => {
    const frozen = validateSourceSnapshot({
      ...healthyRow52(),
      source: "upullitne",
      uniqueVehicles: 2_536,
      vehiclesProcessed: 2_536,
      newestVehicleDate: new Date("2026-08-05T13:01:00Z"),
      validatedAt: new Date("2026-11-15T07:44:11Z"),
    });
    expect(frozen).toEqual({
      status: "rejected",
      errors: [
        "upullitne newest vehicle arrived 2026-08-05, 101 days before this run; a feed with nothing newer than 30 days is treated as frozen. Its previously published inventory stays in place; check whether the provider moved its inventory to a new system.",
      ],
    });
  });

  test("allows inventory up to 30 whole days old", () => {
    const validatedAt = new Date("2026-11-15T07:44:11Z");
    const daysOld = (days: number, extraMs = 0) =>
      validateSourceSnapshot({
        ...healthyRow52(),
        newestVehicleDate: new Date(
          validatedAt.getTime() - days * 86_400_000 - extraMs,
        ),
        validatedAt,
      }).status;
    expect(daysOld(30, 86_399_999)).toBe("accepted");
    expect(daysOld(31)).toBe("rejected");
  });

  test("skips the age check when no vehicle carries a date", () => {
    expect(
      validateSourceSnapshot({ ...healthyRow52(), newestVehicleDate: null }),
    ).toEqual({ status: "accepted", errors: [] });
  });

  test("finds the newest parseable, non-future vehicle date", () => {
    const validatedAt = new Date("2026-11-15T07:44:11Z");
    expect(
      newestVehicleArrival(
        [
          { availableDate: null },
          { availableDate: "" },
          { availableDate: "not a date" },
          { availableDate: "2099-01-01T00:00:00Z" },
          { availableDate: "2026-08-05T13:01:00Z" },
          { availableDate: "2026-07-31T00:00:00Z" },
        ],
        validatedAt,
      ),
    ).toEqual(new Date("2026-08-05T13:01:00Z"));
    expect(
      newestVehicleArrival(
        [{ availableDate: null }, { availableDate: "2099-01-01" }],
        validatedAt,
      ),
    ).toBeNull();
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
