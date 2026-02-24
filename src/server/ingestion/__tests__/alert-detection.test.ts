import { describe, expect, test } from "bun:test";

/**
 * Test the alert detection logic:
 * New vehicles = vehicles where firstSeenAt > lastCheckedAt
 *
 * This tests the conceptual logic used in check-alerts/route.ts
 * without requiring a real database connection.
 */

interface MockVehicle {
  vin: string;
  firstSeenAt: Date;
  make: string;
  model: string;
  year: number;
  state: string;
  locationName: string;
  color: string;
  source: "pyp" | "row52";
}

/**
 * Simulates the alert detection query:
 * SELECT * FROM vehicle WHERE firstSeenAt > lastCheckedAt AND [filters match]
 */
function findNewVehicles(
  vehicles: MockVehicle[],
  lastCheckedAt: Date | null,
  filters: {
    query?: string;
    makes?: string[];
    states?: string[];
    sources?: string[];
    minYear?: number;
    maxYear?: number;
  },
): MockVehicle[] {
  return vehicles.filter((v) => {
    // Only vehicles seen since last check
    if (lastCheckedAt && v.firstSeenAt <= lastCheckedAt) {
      return false;
    }

    // Text query
    if (filters.query) {
      const q = filters.query.toLowerCase();
      if (
        !v.make.toLowerCase().includes(q) &&
        !v.model.toLowerCase().includes(q)
      ) {
        return false;
      }
    }

    // Make filter
    if (filters.makes && filters.makes.length > 0) {
      if (
        !filters.makes
          .map((m) => m.toLowerCase())
          .includes(v.make.toLowerCase())
      ) {
        return false;
      }
    }

    // State filter
    if (filters.states && filters.states.length > 0) {
      if (!filters.states.includes(v.state)) {
        return false;
      }
    }

    // Source filter (pyp | row52)
    if (filters.sources && filters.sources.length > 0) {
      const validSources = filters.sources.filter(
        (s): s is "pyp" | "row52" => s === "pyp" || s === "row52",
      );
      if (validSources.length > 0 && !validSources.includes(v.source)) {
        return false;
      }
    }

    // Year range
    if (filters.minYear && v.year < filters.minYear) return false;
    if (filters.maxYear && v.year > filters.maxYear) return false;

    return true;
  });
}

describe("alert detection logic", () => {
  const now = new Date("2026-02-21T08:00:00Z");
  const yesterday = new Date("2026-02-20T08:00:00Z");
  const twoDaysAgo = new Date("2026-02-19T08:00:00Z");

  const vehicles: MockVehicle[] = [
    {
      vin: "VIN001",
      firstSeenAt: now, // new today
      make: "HONDA",
      model: "CIVIC",
      year: 2020,
      state: "California",
      locationName: "PYP Sun Valley",
      color: "Blue",
      source: "pyp",
    },
    {
      vin: "VIN002",
      firstSeenAt: now, // new today
      make: "TOYOTA",
      model: "CAMRY",
      year: 2018,
      state: "California",
      locationName: "PYP Sun Valley",
      color: "Red",
      source: "row52",
    },
    {
      vin: "VIN003",
      firstSeenAt: yesterday, // added yesterday
      make: "FORD",
      model: "F-150",
      year: 2015,
      state: "Texas",
      locationName: "PYP Houston",
      color: "White",
      source: "pyp",
    },
    {
      vin: "VIN004",
      firstSeenAt: twoDaysAgo, // old
      make: "HONDA",
      model: "ACCORD",
      year: 2022,
      state: "California",
      locationName: "PYP Sun Valley",
      color: "Black",
      source: "row52",
    },
  ];

  test("finds new vehicles since last check", () => {
    const result = findNewVehicles(vehicles, yesterday, {});
    expect(result.length).toBe(2); // VIN001 and VIN002
    expect(result.map((v) => v.vin).sort()).toEqual(["VIN001", "VIN002"]);
  });

  test("returns all vehicles when lastCheckedAt is null (first check)", () => {
    const result = findNewVehicles(vehicles, null, {});
    expect(result.length).toBe(4);
  });

  test("applies make filter", () => {
    const result = findNewVehicles(vehicles, yesterday, {
      makes: ["HONDA"],
    });
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN001");
  });

  test("applies state filter", () => {
    const result = findNewVehicles(vehicles, twoDaysAgo, {
      states: ["Texas"],
    });
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN003");
  });

  test("applies year range filter", () => {
    const result = findNewVehicles(vehicles, twoDaysAgo, {
      minYear: 2019,
    });
    // VIN001: 2020, firstSeenAt=now ✓ (> twoDaysAgo, year >= 2019)
    // VIN002: 2018, firstSeenAt=now ✗ (year < 2019)
    // VIN003: 2015, firstSeenAt=yesterday ✗ (year < 2019)
    // VIN004: 2022, firstSeenAt=twoDaysAgo ✗ (not strictly > twoDaysAgo)
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN001");
  });

  test("applies year range correctly", () => {
    const result = findNewVehicles(vehicles, twoDaysAgo, {
      minYear: 2019,
      maxYear: 2021,
    });
    // VIN001: 2020 ✓, VIN002: 2018 ✗, VIN003: 2015 ✗, VIN004: 2022 ✗
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN001");
  });

  test("applies text query filter", () => {
    const result = findNewVehicles(vehicles, twoDaysAgo, {
      query: "civic",
    });
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN001");
  });

  test("returns empty when no vehicles match", () => {
    const result = findNewVehicles(vehicles, now, {});
    expect(result.length).toBe(0);
  });

  test("combines multiple filters", () => {
    const result = findNewVehicles(vehicles, twoDaysAgo, {
      makes: ["HONDA"],
      states: ["California"],
      minYear: 2019,
    });
    // VIN001: HONDA, CA, 2020 ✓
    // VIN004: HONDA, CA, 2022 ✓ but firstSeenAt is twoDaysAgo which equals lastCheckedAt, so excluded
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN001");
  });

  test("applies sources filter", () => {
    const result = findNewVehicles(vehicles, yesterday, {
      sources: ["pyp"],
    });
    // firstSeenAt > yesterday: VIN001 (now), VIN002 (now); VIN003=yesterday excluded by time
    // Of those, sources pyp: VIN001 ✓, VIN002=row52 ✗
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN001");
  });

  test("sources filter excludes non-matching vehicles", () => {
    const result = findNewVehicles(vehicles, yesterday, {
      sources: ["row52"],
    });
    // VIN002: row52 ✓ only
    expect(result.length).toBe(1);
    expect(result[0]!.vin).toBe("VIN002");
  });
});
