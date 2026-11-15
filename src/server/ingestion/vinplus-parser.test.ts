import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { VINPLUS_TENANTS } from "./vinplus-configuration";
import { inspectVinplusEvidence, vinplusScope } from "./vinplus-parser";
import {
  parseVinplusAnalytics,
  parseVinplusYearSearch,
} from "./vinplus-protocol";
import { vinplusSnapshot } from "./vinplus-snapshot";
import { vinplusPublicDate } from "./vinplus-public-enrichment";

import { vinplusCensus, vinplusQualification } from "./vinplus-test-fixtures";
const first = () => {
  const tenant = VINPLUS_TENANTS[0];
  if (!tenant) throw new Error("Missing Pocatello configuration");
  return tenant;
};
test.each([
  { index: 0, accepted: 713, processed: 720, rejected: 7, serials: 3 },
  { index: 1, accepted: 1406, processed: 1423, rejected: 17, serials: 21 },
  { index: 2, accepted: 1083, processed: 1084, rejected: 1, serials: 5 },
  { index: 3, accepted: 479, processed: 490, rejected: 11, serials: 0 },
  { index: 4, accepted: 1095, processed: 1097, rejected: 2, serials: 7 },
])(
  "complete frozen yard census: tenant=$index",
  ({ index, accepted, processed, rejected, serials }) => {
    const tenant = VINPLUS_TENANTS[index];
    const bodies = vinplusCensus()[index];
    if (!tenant || !bodies)
      throw new Error("Missing qualified tenant evidence");
    const result = inspectVinplusEvidence(tenant, bodies);
    if (result.kind !== "complete") throw new Error("Incomplete yard census");
    const snapshot = vinplusSnapshot(tenant, result.records);
    expect(snapshot.vehicles).toHaveLength(accepted);
    expect(
      snapshot.vehicles.filter((vehicle) => vehicle.vin.length !== 17),
    ).toHaveLength(serials);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: processed,
      recordsRejected: rejected,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
  },
);

test("excluded Killeen's frozen census fails exact year reconciliation", () => {
  const { killeen } = z
    .object({
      killeen: z.object({
        tenant: z.object({
          yardId: z.string(),
          slug: z.string(),
          label: z.string(),
          timezone: z.string(),
          hiddenSearch: z.boolean(),
          inventory: z.object({
            kind: z.literal("crush"),
            stockDigits: z.literal(5),
          }),
        }),
        bodies: z.array(z.string()),
      }),
    })
    .parse(vinplusQualification());
  expect(() =>
    inspectVinplusEvidence({ ...first(), ...killeen.tenant }, killeen.bodies),
  ).toThrow("1575 of 1581");
});
describe("frozen public VinPlus protocol", () => {
  test("enumerates Pocatello including public inventory behind hidden search", () => {
    const result = inspectVinplusEvidence(first(), vinplusCensus()[0] ?? []);
    expect(result.kind).toBe("complete");
    if (result.kind !== "complete")
      throw new Error("Pending terminal evidence");
    const snapshot = vinplusSnapshot(first(), result.records);
    expect(snapshot.vehicles).toHaveLength(713);
    expect(snapshot.accounting).toEqual({
      recordsProcessed: 720,
      recordsRejected: 7,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(
      snapshot.vehicles.every(
        (vehicle) =>
          vehicle.locationCode === "pocatello" && vehicle.stateAbbr === "ID",
      ),
    ).toBe(true);
  });
  test("rejects silent truncation even when match_count equals matches.length", () => {
    const evidence = [...(vinplusCensus()[0] ?? [])];
    const page = z
      .object({ matches: z.array(z.unknown()), match_count: z.number() })
      .passthrough()
      .parse(JSON.parse(evidence[3] ?? ""));
    page.matches.pop();
    page.match_count--;
    evidence[3] = JSON.stringify(page);
    expect(() => inspectVinplusEvidence(first(), evidence)).toThrow(
      "reconcile",
    );
  });
  test("rejects wrong tenant, stock repeats, out-of-range years and unknown fields", () => {
    const body = vinplusCensus()[0]?.[3];
    if (!body) throw new Error("Missing saved range");
    const page = z
      .object({
        matches: z.array(z.record(z.unknown())),
        search_criteria: z.object({
          year_min: z.number(),
          year_max: z.number(),
        }),
      })
      .passthrough()
      .parse(JSON.parse(body));
    const parse = (raw: string) =>
      parseVinplusYearSearch(
        raw,
        vinplusScope(first()),
        page.search_criteria.year_min,
        page.search_criteria.year_max,
      );
    expect(() =>
      parse(
        body
          .replace(
            '"yard_id":"u_pull_auto_parts_pocatello"',
            '"yard_id":"other"',
          )
          .replace(
            '"yard_id": "u_pull_auto_parts_pocatello"',
            '"yard_id": "other"',
          ),
      ),
    ).toThrow();
    for (const patch of [
      { yardLocation: "Another yard" },
      { year: 2100 },
      { unexpected: true },
    ]) {
      const matches = [...page.matches];
      matches[0] = { ...matches[0], ...patch };
      expect(() =>
        parse(JSON.stringify({ ...JSON.parse(body), matches })),
      ).toThrow();
    }
    const matches = [...page.matches];
    matches[1] = matches[0] ?? {};
    expect(() =>
      parse(JSON.stringify({ ...JSON.parse(body), matches })),
    ).toThrow("duplicate");
  });
  test("closing ignores only daysInYard and rejects complete-record drift", () => {
    const bodies = vinplusCensus()[0] ?? [];
    const closingIndex = 3 + (bodies.length - 6) / 2;
    for (const [field, value, accepted] of [
      ["daysInYard", 999, true],
      ["color", "PURPLE", false],
      ["vin", "1GCHK23U44F248109", false],
      ["model", "CHANGED", false],
    ] as const) {
      const evidence = [...bodies];
      const page = z
        .object({ matches: z.array(z.record(z.unknown())) })
        .passthrough()
        .parse(JSON.parse(evidence[closingIndex] ?? ""));
      page.matches[0] = { ...page.matches[0], [field]: value };
      evidence[closingIndex] = JSON.stringify(page);
      if (accepted)
        expect(inspectVinplusEvidence(first(), evidence).kind).toBe("complete");
      else
        expect(() => inspectVinplusEvidence(first(), evidence)).toThrow(
          "Closing inventory",
        );
    }
  });
  test("keeps a real offset timestamp verbatim and treats naive time as calendar only", () => {
    expect(vinplusPublicDate("2026-11-14T17:23:11.123456-06:00")?.value).toBe(
      "2026-11-14T17:23:11.123456-06:00",
    );
    expect(vinplusPublicDate("2026-11-14T17:23:11.123")?.value).toBe(
      "2026-11-14",
    );
    expect(vinplusPublicDate("2026-02-30T00:00:00-06:00")).toBeNull();
    expect(vinplusPublicDate("2026-11-14T00:00:00-00:00")).toBeNull();
  });
});

test("saved API cap reports 100 matching records while its published year range is larger", () => {
  const { capped } = z
    .object({
      capped: z.object({
        counts: z.unknown(),
        response: z
          .object({
            match_count: z.number(),
            search_criteria: z
              .object({
                year_min: z.number(),
                year_max: z.number(),
              })
              .passthrough(),
          })
          .passthrough(),
      }),
    })
    .parse(vinplusQualification());
  const { year_min: min, year_max: max } = capped.response.search_criteria;
  const records = parseVinplusYearSearch(
    JSON.stringify(capped.response),
    vinplusScope(first()),
    min,
    max,
  );
  const expected = parseVinplusAnalytics(JSON.stringify(capped.counts), 10_000)
    .years.filter((row) => row.year >= min && row.year <= max)
    .reduce((sum, row) => sum + row.count, 0);
  expect(capped.response.match_count).toBe(100);
  expect(records).toHaveLength(100);
  expect(expected).toBeGreaterThan(100);
});
test("Pick Ur Part's saved date keeps its published UTC offset", () => {
  const saved = z
    .object({
      pickUrPart: z.object({
        sample: z.object({
          matches: z.array(z.object({ dateAdded: z.string() })).min(1),
        }),
      }),
    })
    .parse(vinplusQualification());
  const date = saved.pickUrPart.sample.matches[0]?.dateAdded;
  expect(date?.endsWith("-06:00")).toBe(true);
  expect(vinplusPublicDate(date)?.value).toBe(date);
});
