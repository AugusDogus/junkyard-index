import { describe, expect, test } from "bun:test";
import { INGESTION_SOURCES } from "~/lib/ingestion-source";
import { URGIIS_TENANTS } from "./urgiis-configuration";
import { UrgiisTenant } from "./urgiis-tenant";
import { urgiisYardChecks } from "./urgiis-publication";
import { autorecyclerYardChecks } from "./autorecycler-yard-checks";
import { YARD_CHECK_POLICIES, YardCheckPolicy } from "./yard-check-policy";
import type { UrgiisCursor } from "./urgiis-cursor";

describe("yard check policy", () => {
  test("declares every source", () => {
    expect(Object.keys(YARD_CHECK_POLICIES).sort()).toEqual(
      [...INGESTION_SOURCES].sort(),
    );
  });

  test("a live source's chunk reports each yard it emitted vehicles for as fetched", () => {
    expect(
      YardCheckPolicy.chunkReports("pyp", [
        { locationCode: "a" },
        { locationCode: "b" },
        { locationCode: "a" },
      ]),
    ).toEqual([
      { locationCode: "a", outcome: "fetched" },
      { locationCode: "b", outcome: "fetched" },
    ]);
  });

  test("a cursor-derived source's chunk reports nothing itself", () => {
    expect(
      YardCheckPolicy.chunkReports("urgiis", [{ locationCode: "a" }]),
    ).toEqual([]);
  });
});

describe("cursor-derived yard checks", () => {
  test("URG reports an accepted tenant's yards fetched and a blocked tenant's blocked", () => {
    const [accepted, blocked] = URGIIS_TENANTS;
    if (!accepted || !blocked) throw new Error("URG needs two tenants");
    // Only `completed` is read; the rest of the cursor is irrelevant here.
    const cursor = {
      completed: [
        { code: accepted.code, accepted: 500 },
        { code: blocked.code, blocked: "HTTP 403" },
      ],
    } satisfies Pick<UrgiisCursor, "completed">;
    expect(urgiisYardChecks(cursor)).toEqual([
      ...UrgiisTenant.yards(accepted).map((yard) => ({
        locationCode: yard.code,
        outcome: "fetched" as const,
      })),
      ...UrgiisTenant.yards(blocked).map((yard) => ({
        locationCode: yard.code,
        outcome: "blocked" as const,
      })),
    ]);
  });

  test("AutoRecycler reports eligible and listed yards fetched and preserved yards preserved", () => {
    expect(
      autorecyclerYardChecks(
        {
          source: "autorecycler",
          phase: "complete",
          freshness: {
            asOf: 1,
            legacy: {},
            eligibleYards: ["a", "b"],
            preservedYards: ["p"],
          },
        },
        ["b", "c"],
      ),
    ).toEqual([
      { locationCode: "a", outcome: "fetched" },
      { locationCode: "b", outcome: "fetched" },
      { locationCode: "c", outcome: "fetched" },
      { locationCode: "p", outcome: "preserved" },
    ]);
    expect(
      autorecyclerYardChecks(
        { source: "autorecycler", phase: "freshness" },
        [],
      ),
    ).toEqual([]);
  });
});
