import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { Database } from "./context";
import { streamAutorecyclerInventoryWithPageFetcher } from "./autorecycler-connector";
import type { Yard } from "~/lib/yard";
import { AutorecyclerSourcePolicy } from "./autorecycler-source-policy";

const independentPolicy: AutorecyclerSourcePolicy = (orgs) =>
  Effect.succeed(new Map(orgs.map((org) => [org, "independent"] as const)));

describe("streamAutorecyclerInventory", () => {
  test("uses one validated VIN identity for accepted records, deduplication and observations", async () => {
    const client = createClient({ url: ":memory:" });
    const org = "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
    const vins: string[] = [];
    try {
      await client.executeMultiple(
        `create table autorecycler_org_geo (org_lookup text primary key, lat real not null, lng real not null, location_name text not null, location_city text not null, state text not null, state_abbr text not null, address text, updated_at integer not null, resolution_version integer not null default 1)`,
      );
      await client.execute({
        sql: "insert into autorecycler_org_geo (org_lookup, lat, lng, location_name, location_city, state, state_abbr, updated_at) values (?, 32.44, -84.94, 'EZ Pull N Pay Columbus', 'Columbus', 'Georgia', 'GA', 1)",
        args: [org],
      });
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            onBatch: (batch) =>
              Effect.sync(() => {
                vins.push(...batch.map((vehicle) => vehicle.vin));
              }),
          },
          async () => ({
            responses: [
              {
                at_end: true,
                hits: {
                  hits: [
                    " knade123666155428 ",
                    "KNADE123666155428",
                    "NOT-A-VIN",
                  ].map((vin_text) => ({
                    _source: {
                      organization_custom_organization: org,
                      inventory_id_text: "1787737161109x728407258643232400",
                      name_text: "2006 Kia Rio",
                      vin_text,
                    },
                  })),
                },
              },
            ],
          }),
          independentPolicy,
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      expect(vins).toEqual(["KNADE123666155428"]);
      expect(result.count).toBe(1);
      expect(result.accounting).toMatchObject({
        recordsProcessed: 3,
        duplicateVehicles: 1,
        recordsRejected: 1,
      });
      expect(result.observedVins).toEqual([]);
    } finally {
      client.close();
    }
  });
  test("unresolved yards preserve only valid VINs and never request website-link enrichment or emit metadata", async () => {
    const client = createClient({ url: ":memory:" });
    const originalFetch = globalThis.fetch;
    const id = "1761169972809x397685278936687600";
    const org = `1348695171700984260__LOOKUP__${id}`;
    const requests: string[] = [];
    const yards: Yard[] = [];
    let emitted = 0;
    try {
      await client.executeMultiple(`create table autorecycler_org_geo (
        org_lookup text primary key, lat real not null, lng real not null,
        location_name text not null, location_city text not null,
        state text not null, state_abbr text not null, address text,
        updated_at integer not null, resolution_version integer not null default 0
      )`);
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL) => {
          const url = String(input);
          requests.push(url);
          if (url.includes("/mget")) {
            if (requests.length !== 1)
              throw new Error("Unresolved yard must not request website links");
            return Response.json({
              docs: [
                {
                  _id: id,
                  _type: "custom.organization",
                  found: true,
                  _source: {
                    name_text: "Unlocated yard",
                    address_city_text: "Pittsburgh",
                    website_custom_website: "invalid brand reference",
                  },
                },
              ],
            });
          }
          if (url.includes("/msearch"))
            return Response.json({ responses: [{ hits: { hits: [] } }] });
          if (url.includes("/init/data")) return Response.json([]);
          throw new Error("Unexpected request");
        },
        { preconnect: originalFetch.preconnect },
      );
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            onBatch: (batch) =>
              Effect.sync(() => {
                emitted += batch.length;
              }),
            onYards: (batch) =>
              Effect.sync(() => {
                yards.push(...batch);
              }),
          },
          async () => ({
            responses: [
              {
                at_end: true,
                hits: {
                  hits: [
                    { vin: " knade123666155428 ", name: "2006 Kia Rio" },
                    { vin: "abc1234567", name: "1970 Ford Mustang" },
                    { vin: "invalid", name: "2006 Kia Rio" },
                    { vin: "12345", name: "2006 Kia Rio" },
                  ].map(({ vin, name }) => ({
                    _source: {
                      organization_custom_organization: org,
                      inventory_id_text: "1761173598052x497522696752949400",
                      vin_text: vin,
                      name_text: name,
                    },
                  })),
                },
              },
            ],
          }),
          independentPolicy,
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      expect(result).toMatchObject({
        status: "complete",
        cursor: 4,
        count: 0,
        errors: [],
        observedVins: ["KNADE123666155428", "ABC1234567"],
        accounting: {
          recordsProcessed: 4,
          recordsExcluded: 4,
          recordsRejected: 0,
          duplicateVehicles: 0,
        },
      });
      expect(result.warnings).toHaveLength(1);
      expect(requests).toHaveLength(3);
      expect(yards).toEqual([]);
      expect(emitted).toBe(0);
      expect(
        (await client.execute("select * from autorecycler_org_geo")).rows,
      ).toEqual([]);
    } finally {
      globalThis.fetch = originalFetch;
      client.close();
    }
  });

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
                          vin_text:
                            pages === 0
                              ? "KNADE123666155428"
                              : "3N1CB51D7YL308709",
                          name_text: "2006 Kia Rio",
                        },
                      },
                    ],
                  },
                  at_end: ++pages === 2,
                },
              ],
            }),
            independentPolicy,
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

  test("excludes direct-provider mirrors before any geography or website lookup and without VIN observations", async () => {
    const client = createClient({ url: ":memory:" });
    const root = "1761169592468x394558876247902400";
    const child = "1761169972809x397685278936687600";
    const orgs = [root, child].map(
      (id) => `1348695171700984260__LOOKUP__${id}`,
    );
    const yards: Yard[] = [];
    let emitted = 0;
    let policyRequests = 0;
    const policy = AutorecyclerSourcePolicy.create(async (ids) => {
      policyRequests++;
      return {
        docs: ids.map((id) => ({
          _id: id,
          _type: "custom.organization",
          found: true,
          _source: { parent_organization_custom_organization: root },
        })),
      };
    });
    try {
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          {
            onBatch: (batch) =>
              Effect.sync(() => {
                emitted += batch.length;
              }),
            onYards: (batch) =>
              Effect.sync(() => {
                yards.push(...batch);
              }),
          },
          async () => ({
            responses: [
              {
                at_end: true,
                hits: {
                  hits: orgs.map((org) => ({
                    _source: {
                      organization_custom_organization: org,
                      inventory_id_text: "1761173598052x497522696752949400",
                      vin_text: "KNADE123666155428",
                      name_text: "2006 Kia Rio",
                    },
                  })),
                },
              },
            ],
          }),
          policy,
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      expect(result).toMatchObject({
        status: "complete",
        cursor: 2,
        count: 0,
        observedVins: [],
        accounting: {
          recordsProcessed: 2,
          recordsExcluded: 2,
          recordsRejected: 0,
          duplicateVehicles: 0,
        },
      });
      expect(yards).toEqual([]);
      expect(emitted).toBe(0);
      expect(policyRequests).toBe(1);
      expect(result.geoStats.geoLookupCount).toBe(0);
    } finally {
      client.close();
    }
  });

  test("excludes VIN-less catalog entries but still rejects malformed nonempty VINs and malformed rows", async () => {
    const client = createClient({ url: ":memory:" });
    const org = "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
    const base = {
      organization_custom_organization: org,
      inventory_id_text: "1787737161109x728407258643232400",
      name_text: "2006 Kia Rio",
    };
    try {
      await client.executeMultiple(
        `create table autorecycler_org_geo (org_lookup text primary key, lat real not null, lng real not null, location_name text not null, location_city text not null, state text not null, state_abbr text not null, address text, updated_at integer not null, resolution_version integer not null default 1)`,
      );
      await client.execute({
        sql: "insert into autorecycler_org_geo values (?,32.44,-84.94,'Columbus','Columbus','Georgia','GA',null,1,1)",
        args: [org],
      });
      const result = await Effect.runPromise(
        streamAutorecyclerInventoryWithPageFetcher(
          { onBatch: () => Effect.void },
          async () => ({
            responses: [
              {
                at_end: true,
                hits: {
                  hits: [
                    { _source: base },
                    { _source: { ...base, vin_text: " " } },
                    { _source: { ...base, vin_text: "NOT-A-VIN" } },
                    { _source: {} },
                  ],
                },
              },
            ],
          }),
          independentPolicy,
        ).pipe(Effect.provideService(Database, drizzle(client))),
      );
      expect(result.accounting).toEqual({
        recordsProcessed: 4,
        recordsExcluded: 2,
        recordsRejected: 2,
        duplicateVehicles: 0,
      });
      expect(result.observedVins).toEqual([]);
      expect(result.count).toBe(0);
    } finally {
      client.close();
    }
  });
});
