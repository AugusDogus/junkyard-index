import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { Database } from "./context";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const org = "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
const seed = {
  orgLookup: org,
  inventoryIdSeed: "1787737161109x728407258643232400",
};
const schema = `create table autorecycler_org_geo (
  org_lookup text primary key, lat real not null, lng real not null,
  location_name text not null, location_city text not null default 'Unknown',
  state text not null, state_abbr text not null, address text, updated_at integer not null
);`;

async function databaseWithCity(city: string) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(schema);
  await client.execute({
    sql: "insert into autorecycler_org_geo values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      org,
      33.7877874,
      -84.4842809,
      "Atlanta, GA",
      city,
      "Georgia",
      "GA",
      null,
      1,
    ],
  });
  return { client, database: drizzle(client) };
}

function mockProvider(city: string | null) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/mget"))
        return Response.json({
          docs: [
            {
              _id: org,
              _source: {
                name_text: "Atlanta, GA",
                address1_geographic_address: {
                  lat: 33.7877874,
                  lng: -84.4842809,
                  address: "1172 Field Rd NW, Atlanta, GA 30318, USA",
                  components: { state: "Georgia", "state code": "GA" },
                },
              },
            },
          ],
        });
      if (url.includes("/msearch"))
        return Response.json({ responses: [{ hits: { hits: [] } }] });
      if (url.includes("/init/data"))
        return Response.json([
          {
            type: "custom.inventory",
            data: {
              organization_custom_organization: org,
              gps_location_geographic_address: {
                lat: 33.7877874,
                lng: -84.4842809,
                ...(city
                  ? { address: "1172 Field Rd NW, Atlanta, GA 30318, USA" }
                  : {}),
                components: { city, state: "Georgia", "state code": "GA" },
              },
              seo_description_text:
                "Look no further than Ez Pull N Pay Columbus!",
            },
          },
        ]);
      throw new Error("Unexpected provider endpoint");
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

test.each(["Unknown", " UNKNOWN ", "", " "])(
  "refreshes incomplete cached city %j and persists the provider city",
  async (city) => {
    const { client, database } = await databaseWithCity(city);
    try {
      const requests = mockProvider("Atlanta");
      const resolver = createAutorecyclerOrgGeoResolver();
      const resolved = await Effect.runPromise(
        resolver
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      );
      expect(resolved).toMatchObject({
        locationCity: "Atlanta",
        locationName: "Atlanta, GA",
        stateAbbr: "GA",
      });
      expect(requests).toHaveLength(3);
      expect(
        (
          await client.execute(
            "select location_city, updated_at from autorecycler_org_geo",
          )
        ).rows[0],
      ).toMatchObject({ location_city: "Atlanta" });
      expect(resolver.getCached(org)?.locationCity).toBe("Atlanta");
      await Effect.runPromise(
        createAutorecyclerOrgGeoResolver()
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      );
      expect(requests).toHaveLength(3);
    } finally {
      client.close();
    }
  },
);

test("complete cached cities do not make new provider requests", async () => {
  const { client, database } = await databaseWithCity("Atlanta");
  try {
    const requests = mockProvider(null);
    const resolved = await Effect.runPromise(
      createAutorecyclerOrgGeoResolver()
        .resolveOneEffect(seed)
        .pipe(Effect.provideService(Database, database)),
    );
    expect(resolved?.locationCity).toBe("Atlanta");
    expect(requests).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("an unresolved refresh fails instead of publishing Unknown or replacing the stored cache", async () => {
  const { client, database } = await databaseWithCity("Unknown");
  try {
    mockProvider(null);
    const resolver = createAutorecyclerOrgGeoResolver();
    await expect(
      Effect.runPromise(
        resolver
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      ),
    ).rejects.toThrow("city");
    expect(resolver.getCached(org)).toBeUndefined();
    expect(
      (
        await client.execute(
          "select location_city, updated_at from autorecycler_org_geo",
        )
      ).rows[0],
    ).toMatchObject({ location_city: "Unknown", updated_at: 1 });
  } finally {
    client.close();
  }
});
