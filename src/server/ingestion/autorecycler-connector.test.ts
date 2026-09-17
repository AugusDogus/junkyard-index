import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { Database } from "./context";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";
import type { Yard } from "~/lib/yard";

describe("streamAutorecyclerInventory", () => {
  test.each([false, true])(
    "persists hosted websites across pages and stops before emitting batches on lookup failure (failure=%s)",
    async (failLookup) => {
      const client = createClient({ url: ":memory:" });
      const originalFetch = globalThis.fetch;
      const org =
        "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
      const site = "1716935969976x139110746251611460";
      let requests = 0;
      let pages = 0;
      let vehicles = 0;
      const yards: Yard[] = [];
      try {
        await client.executeMultiple(`create table autorecycler_org_geo (
        org_lookup text primary key, lat real not null, lng real not null,
        location_name text not null, location_city text not null,
        state text not null, state_abbr text not null, address text,
        updated_at integer not null, resolution_version integer not null default 1
      )`);
        await client.execute({
          sql: "insert into autorecycler_org_geo (org_lookup, lat, lng, location_name, location_city, state, state_abbr, updated_at) values (?, 32.44, -84.94, 'EZ Pull N Pay Columbus', 'Columbus', 'Georgia', 'GA', 1)",
          args: [org],
        });
        globalThis.fetch = Object.assign(
          async () => {
            requests++;
            return Response.json(
              failLookup
                ? { error: "provider lookup failed" }
                : {
                    docs:
                      requests === 1
                        ? [
                            {
                              _id: org.split("__LOOKUP__").at(-1),
                              _type: "custom.organization",
                              found: true,
                              _source: { website_custom_website: site },
                            },
                          ]
                        : [
                            {
                              _id: site,
                              _type: "custom.website",
                              found: true,
                              _source: { Slug: "ez-pull-n-pay-atlanta" },
                            },
                          ],
                  },
            );
          },
          { preconnect: originalFetch.preconnect },
        );
        const result = await Effect.runPromise(
          streamAutorecyclerInventoryWithPageFetcher(
            {
              onBatch: (batch) =>
                Effect.sync(() => {
                  vehicles += batch.length;
                }),
              onYards: (batch) =>
                Effect.sync(() => {
                  yards.push(...batch);
                }),
            },
            async () => ({
              responses: [
                {
                  hits: {
                    hits: [
                      {
                        _source: {
                          organization_custom_organization: org,
                          inventory_id_text: "1787737161109x728407258643232400",
                          vin_text: "KNADE123666155428",
                          name_text: "2006 Kia Rio",
                        },
                      },
                    ],
                  },
                  at_end: ++pages === 2,
                },
              ],
            }),
          ).pipe(
            Effect.provideService(Database, drizzle(client)),
            Effect.either,
          ),
        );
        if (failLookup) {
          expect(result._tag).toBe("Left");
          expect(yards).toHaveLength(0);
          expect(vehicles).toBe(0);
          expect(requests).toBe(1);
        } else {
          expect(result._tag).toBe("Right");
          expect(yards).toHaveLength(2);
          expect(vehicles).toBe(2);
          expect(requests).toBe(2);
          for (const yard of yards)
            expect(yard.websiteUrl).toBe(
              "https://app.autorecycler.io/inventory/ez-pull-n-pay-atlanta",
            );
        }
      } finally {
        globalThis.fetch = originalFetch;
        client.close();
      }
    },
  );

  test("fetches full pages concurrently after establishing the provider page size", async () => {
    const client = createClient({ url: ":memory:" });
    const database = drizzle(client);
    let activeRequests = 0;
    let maximumActiveRequests = 0;

    try {
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            onBatch: () => Effect.succeed(undefined),
            maxPages: 4,
          },
          async () => {
            activeRequests += 1;
            maximumActiveRequests = Math.max(
              maximumActiveRequests,
              activeRequests,
            );
            await new Promise((resolve) => setTimeout(resolve, 5));
            activeRequests -= 1;
            return {
              responses: [
                {
                  hits: {
                    hits: Array.from({ length: 400 }, () => ({
                      _source: {},
                    })),
                  },
                  at_end: false,
                },
              ],
            };
          },
        ).pipe(Effect.provideService(Database, database)),
      );

      expect(result.status).toBe("paused");
      expect(result.pagesProcessed).toBe(4);
      expect(result.cursor).toBe(1600);
      expect(maximumActiveRequests).toBe(3);
    } finally {
      client.close();
    }
  });
});
