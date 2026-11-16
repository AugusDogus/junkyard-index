import { expect, test } from "bun:test";
import { Effect } from "effect";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import {
  AUTORECYCLER_FRESHNESS_MS,
  discoverFreshAutorecyclerYards,
  isFreshAutorecyclerDate,
  selectAutorecyclerFeed,
} from "./autorecycler-freshness";
import { validateAutorecyclerPublishedInventory } from "./autorecycler-published-inventory";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";
import { Database } from "./context";
import { makeVehicle, TEST_SCHEMA } from "./durable-ingestion-test-fixtures";
import {
  ARIO_CUSTOMER_YARDS,
  AUTORECYCLER_LOOKUP_PREFIX,
} from "./autorecycler-ario-yards";

const asOf = Date.parse("2026-11-15T21:55:00Z");
test("freshness accepts the exact 60-day boundary and rejects future, invalid and older additions", () => {
  expect(isFreshAutorecyclerDate(asOf, asOf)).toBe(true);
  expect(isFreshAutorecyclerDate(asOf - AUTORECYCLER_FRESHNESS_MS, asOf)).toBe(
    true,
  );
  for (const date of [
    asOf + 1,
    asOf - AUTORECYCLER_FRESHNESS_MS - 1,
    NaN,
    Infinity,
  ])
    expect(isFreshAutorecyclerDate(date, asOf)).toBe(false);
  expect(selectAutorecyclerFeed([asOf + 1, asOf - 1], null, asOf)).toBe("ario");
  expect(selectAutorecyclerFeed([asOf - 1], asOf, asOf)).toBe("legacy");
  expect(selectAutorecyclerFeed([asOf], asOf - 1, asOf)).toBe("ario");
  expect(selectAutorecyclerFeed([asOf], asOf, asOf)).toBe("ario");
  expect(selectAutorecyclerFeed([asOf + 1], null, asOf)).toBe("stale");
  // A stale yard returns automatically when a new addition appears.
  expect(
    selectAutorecyclerFeed([asOf - AUTORECYCLER_FRESHNESS_MS - 1], null, asOf),
  ).toBe("stale");
  expect(
    selectAutorecyclerFeed(
      [asOf - AUTORECYCLER_FRESHNESS_MS - 1, asOf],
      null,
      asOf,
    ),
  ).toBe("ario");
});

test("discovers fresh legacy yards from saved pages and requires an empty keyset page", async () => {
  let page = 0;
  const result = await discoverFreshAutorecyclerYards(asOf, async (body) => {
    const search = body.searches[0];
    expect(search?.from).toBe(0);
    expect(search?.constraints).toContainEqual({
      key: "added_date_date",
      constraint_type: "less than",
      value: asOf + 1,
    });
    return Bun.file(
      new URL(`./fixtures/ario/legacy-fresh-${page++}.json`, import.meta.url),
    ).json();
  });
  expect(page).toBe(2);
  expect(Object.keys(result.legacy).sort()).toEqual([
    "1672882562847x152496749538181120",
    "1727808874603x499378618447920300",
  ]);
});

test("stale yard exclusions emit neither vehicles nor metadata nor VIN observations", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    const result = await Effect.runPromise(
      streamAutorecyclerInventoryWithPageFetcher(
        {
          onBatch: (vehicles) =>
            Effect.sync(() => {
              expect(vehicles).toEqual([]);
            }),
          onYards: (yards) =>
            Effect.sync(() => {
              expect(yards).toEqual([]);
            }),
        },
        async (before) => ({
          responses: [
            {
              hits: {
                hits: before
                  ? []
                  : [
                      {
                        _id: "1700000000000x1",
                        _source: {
                          vin_text: "KNADE123666155428",
                          name_text: "2006 Kia Rio",
                          inventory_id_text: "1700000000000x2",
                          organization_custom_organization: "1700000000000x3",
                        },
                      },
                    ],
              },
            },
          ],
        }),
        (orgs) =>
          Effect.succeed(new Map(orgs.map((org) => [org, "stale"] as const))),
      ).pipe(Effect.provideService(Database, drizzle(client))),
    );
    expect(result.count).toBe(0);
    expect(result.observedVins).toEqual([]);
    expect(result.accounting?.recordsExcluded).toBe(1);
    expect(result.geoStats.geoFetches).toBe(0);
  } finally {
    client.close();
  }
});

test("drift ignores unsupported retired yards while protecting every still-eligible yard", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(TEST_SCHEMA);
    const db = drizzle(client);
    await client.execute(
      "create table vehicle (vin text primary key, source text, location_code text, missing_since_at integer)",
    );
    for (let i = 0; i < 100; i++)
      await client.execute({
        sql: "insert into vehicle values (?, 'autorecycler', ?, null)",
        args: [`VIN${i}`, i < 20 ? "active" : "stale"],
      });
    const current = Array.from({ length: 10 }, (_, i) => ({
      ...makeVehicle(`VIN${i}`),
      source: "autorecycler" as const,
      locationCode: "active",
    }));
    expect(
      await validateAutorecyclerPublishedInventory(db, current, ["active"]),
    ).toEqual({ previousEligibleCount: 20, errors: [] });
    expect(
      (
        await validateAutorecyclerPublishedInventory(db, current.slice(0, 9), [
          "active",
        ])
      ).errors[0],
    ).toContain("50% yard drift limit");
    expect(
      (await validateAutorecyclerPublishedInventory(db, [], ["active"]))
        .errors[0],
    ).toContain("20 to 0");
    expect(
      (await validateAutorecyclerPublishedInventory(db, current, [])).errors[0],
    ).toContain("ineligible yard");
  } finally {
    client.close();
  }
});

test.each([20, 50, 51, 96])(
  "bounds newly stale customer removals at 50%% of published customer inventory (%i%%)",
  async (staleCount) => {
    const client = createClient({ url: ":memory:" });
    try {
      const stale = `${AUTORECYCLER_LOOKUP_PREFIX}${ARIO_CUSTOMER_YARDS[0].legacyId}`;
      await client.execute(
        "create table vehicle (vin text primary key, source text, location_code text, missing_since_at integer)",
      );
      for (let i = 0; i < 100; i++)
        await client.execute({
          sql: "insert into vehicle values (?, 'autorecycler', ?, null)",
          args: [`VIN${i}`, i < staleCount ? stale : "active"],
        });
      const current = Array.from({ length: 100 - staleCount }, (_, i) => ({
        ...makeVehicle(`VIN${i + staleCount}`),
        source: "autorecycler" as const,
        locationCode: "active",
      }));
      const result = await validateAutorecyclerPublishedInventory(
        drizzle(client),
        current,
        ["active"],
      );
      expect(result.previousEligibleCount).toBe(100 - staleCount);
      if (staleCount <= 50) expect(result.errors).toEqual([]);
      else
        expect(result.errors.join(" ")).toContain(
          "50% stale-yard removal limit",
        );
    } finally {
      client.close();
    }
  },
);

test.each([
  undefined,
  "2026-11-14T00:00:00Z",
  asOf - AUTORECYCLER_FRESHNESS_MS - 1,
])("validates legacy addition dates across checkpoints (%s)", async (date) => {
  const client = createClient({ url: ":memory:" });
  try {
    const run = (
      beforeId: string | null,
      dateEvidence?: Record<string, boolean>,
    ) =>
      streamAutorecyclerInventoryWithPageFetcher(
        {
          startCursor: {
            source: "autorecycler",
            phase: "page",
            beforeId,
            freshness: {
              asOf,
              legacy: {},
              eligibleYards: [],
              legacyDateEvidence: dateEvidence,
            },
          },
          maxPages: 1,
          onBatch: () => Effect.void,
        },
        async (before) => ({
          responses: [
            {
              hits: {
                hits: before
                  ? []
                  : [
                      {
                        _id: "1700000000000x1",
                        _source: {
                          vin_text: "KNADE123666155428",
                          name_text: "2006 Kia Rio",
                          inventory_id_text: "1700000000000x2",
                          organization_custom_organization: "1700000000000x3",
                          renamed_added_date: asOf,
                          added_date_date: date,
                        },
                      },
                    ],
              },
            },
          ],
        }),
        (orgs) =>
          Effect.succeed(new Map(orgs.map((org) => [org, "stale"] as const))),
      ).pipe(Effect.provideService(Database, drizzle(client)));
    const first = await Effect.runPromise(run(null));
    expect(first.status).toBe("paused");
    if (first.cursor.phase !== "page")
      throw new Error("Expected another legacy page");
    const complete = Effect.runPromise(
      run("1700000000000x1", first.cursor.freshness?.legacyDateEvidence),
    );
    if (typeof date === "number")
      expect((await complete).status).toBe("complete");
    else await expect(complete).rejects.toThrow("no parseable addition dates");
  } finally {
    client.close();
  }
});
