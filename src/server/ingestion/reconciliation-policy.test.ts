import { describe, expect, test } from "bun:test";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { vehicle } from "~/schema";
import type { CanonicalVehicle } from "./types";
import {
  planChangedVehicleUpserts,
  planMissingVehicleTransitions,
  RECONCILIATION_SOURCE_PRIORITY,
  reconciliationSourcePrioritySql,
} from "./reconciliation-policy";

function canonicalVehicle(
  vin: string,
  overrides: Partial<CanonicalVehicle> = {},
): CanonicalVehicle {
  return {
    vin,
    source: "pyp",
    year: 2015,
    make: "FORD",
    model: "FOCUS",
    color: "Red",
    stockNumber: "A123",
    imageUrl: "https://example.com/car.jpg",
    availableDate: "2026-03-01T00:00:00.000Z",
    locationCode: "100",
    locationName: "Yard 100",
    locationCity: "Los Angeles",
    state: "California",
    stateAbbr: "CA",
    lat: 34.05,
    lng: -118.24,
    section: null,
    row: null,
    space: null,
    detailsUrl: "https://example.com/details",
    partsUrl: "https://example.com/parts",
    pricesUrl: "https://example.com/prices",
    engine: "2.0L",
    trim: "SE",
    transmission: "Automatic",
    ...overrides,
  };
}

function existingVehicle(
  vin: string,
  overrides: Partial<typeof vehicle.$inferSelect> = {},
): typeof vehicle.$inferSelect {
  return {
    ...canonicalVehicle(vin),
    sourceMake: null,
    sourceModel: null,
    observedArrivalAt: null,
    firstSeenAt: new Date("2026-02-01T00:00:00.000Z"),
    firstSighting: "arrival",
    lastSeenAt: new Date("2026-03-01T00:00:00.000Z"),
    missingSinceAt: null,
    missingRunCount: 0,
    ...overrides,
  };
}

describe("reconciliation policy", () => {
  test("defines one canonical provider priority for SQL reconciliation", () => {
    expect(RECONCILIATION_SOURCE_PRIORITY).toEqual([
      "row52",
      "pyp",
      "pullapart",
      "upullitne",
      "upullitdavie",
      "gopullit",
      "pullnsave",
      "tearapart",
      "wrenchapart",
      "upullrparts",
      "ipullupull",
      "upullitwa",
      "partsgalore",
      "rtp",
      "nvpap",
      "pontiac",
      "aero",
      "vanderhaags",
      "chesterfield",
      "utpap",
      "tritown",
      "whitebradstreet",
      "midway",
      "rightway",
      "ddauto",
      "rivervalley",
      "fenix",
      "importapart",
      "army",
      "idipull",
      "bigd",
      "pullsavewa",
      "littleton",
      "michigantruck",
      "joliet",
      "alln1",
      "grandpajohns",
      "pickers",
      "pipes",
      "uwrench",
      "millerstown",
      "pickapartva",
      "mccauley",
      "rustyhook",
      "aviation",
      "chaz",
      "citymotors",
      "awap",
      "clearsalvage",
      "aplus",
      "central",
      "northwest",
      "coutu",
      "kodak",
      "six03",
      "rohner",
      "pratt",
      "cars4parts",
      "meeks",
      "brandywine",
      "rmmdtp",
      "calton",
      "bigtruckpage",
      "speedys",
      "sandw",
      "denton",
      "beavers",
      "indianriver",
      "scotts",
      "oem",
      "dutchers",
      "alsauto",
      "chasencars",
      "weberbrothers",
      "hawaiiparts",
      "modernmuscle",
      "carsandparts",
      "spartan",
      "oemgarage",
      "hagerman",
      "kandr",
      "jimsimport",
      "lonestarimports",
      "alshned",
      "hollanderstores",
      "cstruck",
      "allied",
      "byot",
      "heavytruckparts",
      "vinplus",
      "urgiis",
      "harrys",
      "budget",
      "autorecycler",
    ]);
    expect(reconciliationSourcePrioritySql("candidate")).toContain(
      "case candidate.source",
    );
    expect(reconciliationSourcePrioritySql("candidate")).toContain(
      "when 'row52' then 1",
    );
    expect(reconciliationSourcePrioritySql("candidate")).toContain(
      `when 'autorecycler' then ${RECONCILIATION_SOURCE_PRIORITY.length}`,
    );
  });

  test("assigns every registered source exactly one explicit priority", () => {
    expect([...RECONCILIATION_SOURCE_PRIORITY].sort()).toEqual(
      [...INGESTION_SOURCES].sort(),
    );
  });

  test("keys published yard history by both source and location", () => {
    const runTimestamp = new Date("2026-11-16T12:00:00Z");
    const cars = [
      canonicalVehicle("known-yard", {
        source: "pyp",
        locationCode: "100",
        availableDate: null,
      }),
      canonicalVehicle("new-yard", {
        source: "pyp",
        locationCode: "200",
        availableDate: null,
      }),
      canonicalVehicle("new-source", {
        source: "row52",
        locationCode: "100",
        availableDate: null,
      }),
    ];
    const changes = planChangedVehicleUpserts({
      inventory: new Map(cars.map((car) => [car.vin, car])),
      existingRows: [],
      recentDepartures: [],
      runTimestamp,
      acceptedSources: new Set(["pyp", "row52"]),
      publishedYards: new Map([["pyp", new Set(["100"])]]),
    });
    expect(
      changes.map(({ vehicle, observedArrivalAt }) => [
        vehicle.vin,
        observedArrivalAt,
      ]),
    ).toEqual([
      ["known-yard", runTimestamp],
      ["new-yard", null],
      ["new-source", null],
    ]);
  });

  test("decides a new VIN's first sighting by whether its yard was published", () => {
    const cars = [
      canonicalVehicle("known-yard", { source: "pyp", locationCode: "100" }),
      canonicalVehicle("new-yard", { source: "pyp", locationCode: "200" }),
      canonicalVehicle("new-source", { source: "row52", locationCode: "100" }),
    ];
    const changes = planChangedVehicleUpserts({
      inventory: new Map(cars.map((car) => [car.vin, car])),
      existingRows: [],
      recentDepartures: [],
      runTimestamp: new Date("2026-11-16T12:00:00Z"),
      acceptedSources: new Set(["pyp", "row52"]),
      publishedYards: new Map([["pyp", new Set(["100"])]]),
    });
    expect(
      changes.map(({ vehicle, firstSighting }) => [vehicle.vin, firstSighting]),
    ).toEqual([
      ["known-yard", "arrival"],
      ["new-yard", "yard_backfill"],
      ["new-source", "yard_backfill"],
    ]);
  });

  test("a handoff to another yard keeps the VIN's first sighting", () => {
    const runTimestamp = new Date("2026-11-21T18:00:00Z");
    // An arrival at a published aggregator yard, then a new direct source
    // publishes its first crawl listing the same VIN, and the reverse.
    const plan = (
      firstSighting: "arrival" | "yard_backfill",
      publishedYards: ReadonlyMap<string, ReadonlySet<string>>,
    ) =>
      planChangedVehicleUpserts({
        inventory: new Map([
          ["VIN123", canonicalVehicle("VIN123", { source: "calton" })],
        ]),
        existingRows: [
          existingVehicle("VIN123", {
            source: "autorecycler",
            locationCode: "a",
            firstSighting,
          }),
        ],
        recentDepartures: [],
        runTimestamp,
        acceptedSources: new Set(["calton"]),
        publishedYards,
      }).map((entry) => entry.firstSighting);

    expect(plan("arrival", new Map())).toEqual(["arrival"]);
    expect(
      plan("yard_backfill", new Map([["calton", new Set(["100"])]])),
    ).toEqual(["yard_backfill"]);
  });

  test("a relist keeps its departed listing's first sighting", () => {
    const runTimestamp = new Date("2026-11-21T18:00:00Z");
    const changes = planChangedVehicleUpserts({
      inventory: new Map([["VIN123", canonicalVehicle("VIN123")]]),
      existingRows: [],
      recentDepartures: [
        {
          vin: "VIN123",
          source: "pyp",
          locationCode: "100",
          firstSeenAt: new Date("2026-11-01T00:00:00Z"),
          firstSighting: "yard_backfill",
          departedAt: new Date("2026-11-10T00:00:00Z"),
        },
      ],
      runTimestamp,
      acceptedSources: new Set(["pyp"]),
      publishedYards: new Map([["pyp", new Set(["100"])]]),
    });
    expect(changes.map((entry) => entry.firstSighting)).toEqual([
      "yard_backfill",
    ]);
  });

  test("ignores coordinate noise from the database's float round trip", () => {
    // Turso returns -97.51810604352379 as -97.5181060435238.
    const changed = planChangedVehicleUpserts({
      publishedYards: new Map(),
      inventory: new Map([
        ["VIN123", canonicalVehicle("VIN123", { lng: -97.51810604352379 })],
      ]),
      existingRows: [existingVehicle("VIN123", { lng: -97.5181060435238 })],
      recentDepartures: [],
      runTimestamp: new Date("2026-03-05T00:00:00.000Z"),
      acceptedSources: new Set(["pyp"]),
    });

    expect(changed).toEqual([]);
  });

  test("treats a reappearing vehicle as changed", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const changed = planChangedVehicleUpserts({
      publishedYards: new Map(),
      inventory: new Map([["VIN123", canonicalVehicle("VIN123")]]),
      existingRows: [
        existingVehicle("VIN123", {
          missingSinceAt: new Date("2026-03-03T00:00:00.000Z"),
          missingRunCount: 2,
        }),
      ],
      recentDepartures: [],
      runTimestamp,
      acceptedSources: new Set(["pyp"]),
    });

    expect(changed).toHaveLength(1);
    expect(changed[0]?.vehicle.vin).toBe("VIN123");
  });

  test("leaves a VIN with its listed higher-priority owner outside this run", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const plan = (owner: typeof vehicle.$inferSelect) =>
      planChangedVehicleUpserts({
        publishedYards: new Map(),
        inventory: new Map([
          ["VIN123", canonicalVehicle("VIN123", { source: "autorecycler" })],
        ]),
        existingRows: [owner],
        recentDepartures: [],
        runTimestamp,
        acceptedSources: new Set(["autorecycler"]),
      });

    expect(plan(existingVehicle("VIN123", { source: "row52" }))).toEqual([]);
    // Once the owner stops listing it, the next source to list it takes over.
    expect(
      plan(
        existingVehicle("VIN123", {
          source: "row52",
          missingSinceAt: new Date("2026-03-04T00:00:00.000Z"),
          missingRunCount: 1,
        }),
      ).map((entry) => entry.vehicle.source),
    ).toEqual(["autorecycler"]);
    // A lower-priority owner yields to a higher-priority source.
    expect(
      planChangedVehicleUpserts({
        publishedYards: new Map(),
        inventory: new Map([["VIN123", canonicalVehicle("VIN123")]]),
        existingRows: [existingVehicle("VIN123", { source: "autorecycler" })],
        recentDepartures: [],
        runTimestamp,
        acceptedSources: new Set(["pyp"]),
      }).map((entry) => entry.vehicle.source),
    ).toEqual(["pyp"]);
  });

  test.each([
    "grandpajohns",
    "rohner",
    "pratt",
    "cars4parts",
    "meeks",
    "calton",
    "bigtruckpage",
    "speedys",
  ] as const)(
    "%s replaces an AutoRecycler mirror and retains native ownership",
    (source) => {
      const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
      const native = canonicalVehicle("VIN123", { source });
      const owner = existingVehicle("VIN123", { source: "autorecycler" });
      expect(
        planChangedVehicleUpserts({
          publishedYards: new Map(),
          inventory: new Map([[native.vin, native]]),
          existingRows: [owner],
          recentDepartures: [],
          runTimestamp,
          acceptedSources: new Set([source]),
        }),
      ).toEqual([
        {
          vehicle: native,
          firstSeenAt: owner.firstSeenAt,
          firstSighting: owner.firstSighting,
          observedArrivalAt: null,
        },
      ]);
      expect(
        planChangedVehicleUpserts({
          publishedYards: new Map(),
          inventory: new Map([
            ["VIN123", canonicalVehicle("VIN123", { source: "autorecycler" })],
          ]),
          existingRows: [existingVehicle("VIN123", { source })],
          recentDepartures: [],
          runTimestamp,
          acceptedSources: new Set(["autorecycler"]),
        }),
      ).toEqual([]);
      expect(reconciliationSourcePrioritySql("candidate")).toContain(
        `when '${source}' then ${RECONCILIATION_SOURCE_PRIORITY.indexOf(source) + 1}`,
      );
    },
  );

  test("advances missing state only for accepted sources and deletes at the threshold", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const transitions = planMissingVehicleTransitions({
      presentVins: new Set(["VIN_PRESENT"]),
      existingRows: [
        existingVehicle("VIN_PRESENT"),
        existingVehicle("VIN_MISSING"),
        existingVehicle("VIN_DELETE", {
          missingSinceAt: new Date("2026-03-01T00:00:00.000Z"),
          missingRunCount: 2,
        }),
        existingVehicle("VIN_UNHEALTHY", { source: "row52" }),
      ],
      runTimestamp,
      acceptedSources: new Set(["pyp"]),
      deleteAfterMs: 3 * 24 * 60 * 60 * 1000,
    });

    expect(transitions).toEqual([
      {
        vin: "VIN_MISSING",
        changeType: "missing",
        missingSinceAt: runTimestamp.getTime(),
        missingRunCount: 1,
      },
      {
        vin: "VIN_DELETE",
        changeType: "delete",
        missingSinceAt: new Date("2026-03-01T00:00:00.000Z").getTime(),
        missingRunCount: 3,
      },
    ]);
  });

  test("keeps a vehicle missed by same-day re-crawls until it has been missing 72 hours", () => {
    const runTimestamp = new Date("2026-03-05T00:00:00.000Z");
    const sixHoursAgo = new Date("2026-03-04T18:00:00.000Z");
    const justUnderThreeDays = new Date("2026-03-02T00:00:01.000Z");
    const transitions = planMissingVehicleTransitions({
      presentVins: new Set(),
      existingRows: [
        existingVehicle("VIN_RECRAWLED", {
          missingSinceAt: sixHoursAgo,
          missingRunCount: 5,
        }),
        existingVehicle("VIN_ALMOST", {
          missingSinceAt: justUnderThreeDays,
          missingRunCount: 2,
        }),
      ],
      runTimestamp,
      acceptedSources: new Set(["pyp"]),
      deleteAfterMs: 3 * 24 * 60 * 60 * 1000,
    });

    expect(transitions).toEqual([
      {
        vin: "VIN_RECRAWLED",
        changeType: "missing",
        missingSinceAt: sixHoursAgo.getTime(),
        missingRunCount: 6,
      },
      {
        vin: "VIN_ALMOST",
        changeType: "missing",
        missingSinceAt: justUnderThreeDays.getTime(),
        missingRunCount: 3,
      },
    ]);
  });
});
