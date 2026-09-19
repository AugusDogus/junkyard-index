import { createClient } from "@libsql/client";
import { afterEach, expect, test } from "bun:test";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { Database } from "./context";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const org = "1348695171700984260__LOOKUP__1726602417880x199387504054651780";
const recordId = "1726602417880x199387504054651780";
const seed = {
  orgLookup: org,
  inventoryIdSeed: "1787737161109x728407258643232400",
};
const schema = `create table autorecycler_org_geo (
  org_lookup text primary key, lat real not null, lng real not null,
  location_name text not null, location_city text not null default 'Unknown',
  state text not null, state_abbr text not null, address text, updated_at integer not null,
  resolution_version integer not null default 0
);`;

test("provenance migration marks existing populated caches unverified without changing them", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(`create table autorecycler_org_geo (
      org_lookup text primary key, lat real not null, lng real not null,
      location_name text not null, location_city text not null, state text not null,
      state_abbr text not null, address text, updated_at integer not null
    );`);
    await client.execute({
      sql: "insert into autorecycler_org_geo values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      args: [
        org,
        33.7877874,
        -84.4842809,
        "Atlanta, GA",
        "Atlanta",
        "Georgia",
        "GA",
        "1172 Field Rd NW",
        1,
      ],
    });
    const before = (await client.execute("select * from autorecycler_org_geo"))
      .rows[0];
    if (!before) throw new Error("Expected the seeded legacy cache row");
    await client.executeMultiple(
      await readFile(
        new URL(
          "../../../drizzle/0009_autorecycler_geo_provenance.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      (await client.execute("select * from autorecycler_org_geo")).rows[0],
    ).toEqual({ ...before, resolution_version: 0 });
  } finally {
    client.close();
  }
});

async function databaseWithCity(city: string, version = 0) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(schema);
  await client.execute({
    sql: "insert into autorecycler_org_geo values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    args: [
      org,
      33.7877874,
      -84.4842809,
      "Atlanta, GA",
      city,
      "Georgia",
      "GA",
      "1172 Field Rd NW, Atlanta, GA 30318, USA",
      1,
      version,
    ],
  });
  return { client, database: drizzle(client) };
}

const address = {
  lat: 32.44405100000001,
  lng: -84.9404565,
  address: "3843 Aldridge Rd, Columbus, GA 31903, USA",
  components: { city: "Columbus", state: "Georgia", "state code": "GA" },
};
const organization = {
  _id: recordId,
  _type: "custom.organization",
  found: true,
  _source: {
    name_text: "EZ Pull N Pay Columbus",
    address1_geographic_address: address,
  },
};

// Decode the real wire request so a seed-ID regression cannot pass a canned mget mock.
function mgetIds(body: RequestInit["body"]): string[] {
  if (typeof body !== "string")
    throw new Error("Expected encrypted JSON request");
  const encrypted = z
    .object({ x: z.string(), y: z.string(), z: z.string() })
    .parse(JSON.parse(body));
  const app = "autoscrapzen";
  function decrypt(ciphertext: string, key: string, iv: string) {
    const decipher = createDecipheriv(
      "aes-256-cbc",
      pbkdf2Sync(key, app, 7, 32, "md5"),
      pbkdf2Sync(iv, app, 7, 16, "md5"),
    );
    return Buffer.concat([
      decipher.update(ciphertext, "base64"),
      decipher.final(),
    ]).toString();
  }
  const timestamp = decrypt(encrypted.y, app, "po9").split("_")[0];
  const iv = decrypt(encrypted.x, app, "fl1");
  return z
    .object({ ids: z.array(z.string()) })
    .parse(JSON.parse(decrypt(encrypted.z, app + timestamp, iv))).ids;
}

function mockProvider(
  options: {
    docs?: unknown[];
    mgetResponse?: unknown;
    msearchResponse?: unknown;
    website?: Record<string, unknown>;
    rows?: unknown[];
    fail?: "mget" | "msearch" | "init/data";
  } = {},
) {
  const requests: string[] = [];
  const ids: string[][] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/mget")) ids.push(mgetIds(init?.body));
      if (options.fail && url.includes(`/${options.fail}`))
        return new Response("Provider unavailable", { status: 403 });
      if (url.includes("/mget"))
        return Response.json(
          "mgetResponse" in options
            ? options.mgetResponse
            : { docs: options.docs ?? [organization] },
        );
      if (url.includes("/msearch"))
        return Response.json(
          options.msearchResponse ?? {
            responses: [
              {
                hits: {
                  hits: options.website ? [{ _source: options.website }] : [],
                },
              },
            ],
          },
        );
      if (url.includes("/init/data"))
        return Response.json(
          options.rows ?? [
            {
              type: "custom.inventory",
              data: {
                organization_custom_organization: org,
                gps_location_geographic_address: {
                  lat: 33.7877874,
                  lng: -84.4842809,
                  components: {
                    city: "Atlanta",
                    state: "Georgia",
                    "state code": "GA",
                  },
                },
                seo_description_text:
                  "Look no further than Ez Pull N Pay Columbus!",
              },
            },
          ],
        );
      throw new Error("Unexpected provider endpoint");
    },
    { preconnect: originalFetch.preconnect },
  );
  return { requests, ids };
}

test.each(["Atlanta", "Unknown", " UNKNOWN ", "", " "])(
  "refreshes legacy cached city %j from the owned organization and persists verification",
  async (city) => {
    const { client, database } = await databaseWithCity(city);
    try {
      const { requests, ids } = mockProvider();
      const resolver = createAutorecyclerOrgGeoResolver();
      const resolve = () =>
        Effect.runPromise(
          resolver
            .resolveOneEffect(seed)
            .pipe(Effect.provideService(Database, database)),
        );
      expect(await resolve()).toMatchObject({
        locationCity: "Columbus",
        locationName: "EZ Pull N Pay Columbus",
        lat: address.lat,
        lng: address.lng,
        address: address.address,
      });
      expect(ids).toEqual([[recordId]]);
      expect(
        (await client.execute("select * from autorecycler_org_geo")).rows[0],
      ).toMatchObject({
        location_city: "Columbus",
        location_name: "EZ Pull N Pay Columbus",
        lat: address.lat,
        lng: address.lng,
        address: address.address,
        resolution_version: 1,
      });
      expect(resolver.getCached(org)?.locationCity).toBe("Columbus");
      await resolve();
      await Effect.runPromise(
        createAutorecyclerOrgGeoResolver()
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      );
      expect(requests).toHaveLength(1);
    } finally {
      client.close();
    }
  },
);

test("verified complete cached cities do not make new provider requests", async () => {
  const { client, database } = await databaseWithCity("Atlanta", 1);
  try {
    const { requests } = mockProvider();
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

test("verified but incomplete city still refreshes", async () => {
  const { client, database } = await databaseWithCity("Unknown", 1);
  try {
    mockProvider();
    expect(
      (
        await Effect.runPromise(
          createAutorecyclerOrgGeoResolver()
            .resolveOneEffect(seed)
            .pipe(Effect.provideService(Database, database)),
        )
      )?.locationCity,
    ).toBe("Columbus");
  } finally {
    client.close();
  }
});

test.each(["website", "init/data"])(
  "can verify the yard through its own %s record",
  async (fallback) => {
    const { client, database } = await databaseWithCity("Atlanta");
    try {
      mockProvider({
        docs: [],
        ...(fallback === "website"
          ? {
              website: {
                organization_custom_organization: recordId,
                name_text: "EZ Pull N Pay Columbus",
                address_geographic_address: address,
              },
            }
          : {
              rows: [
                {
                  type: "custom.organization",
                  data: { ...organization._source, _id: recordId },
                },
              ],
            }),
      });
      expect(
        (
          await Effect.runPromise(
            createAutorecyclerOrgGeoResolver()
              .resolveOneEffect(seed)
              .pipe(Effect.provideService(Database, database)),
          )
        )?.locationCity,
      ).toBe("Columbus");
      expect(
        (
          await client.execute(
            "select resolution_version from autorecycler_org_geo",
          )
        ).rows[0]?.resolution_version,
      ).toBe(1);
    } finally {
      client.close();
    }
  },
);

test.each([undefined, "mget", "msearch", "init/data"] as const)(
  "unverified refresh (%s) fails and preserves every cached field",
  async (fail) => {
    const { client, database } = await databaseWithCity("Atlanta");
    try {
      const before = (
        await client.execute("select * from autorecycler_org_geo")
      ).rows;
      mockProvider({ docs: [], fail });
      const resolver = createAutorecyclerOrgGeoResolver();
      await expect(
        Effect.runPromise(
          resolver
            .resolveOneEffect(seed)
            .pipe(Effect.provideService(Database, database)),
        ),
      ).rejects.toThrow();
      expect(resolver.getCached(org)).toBeUndefined();
      expect(
        (await client.execute("select * from autorecycler_org_geo")).rows,
      ).toEqual(before);
    } finally {
      client.close();
    }
  },
);

test("an unverified new organization fails instead of silently dropping its vehicles", async () => {
  const { client, database } = await databaseWithCity("Atlanta");
  try {
    await client.execute("delete from autorecycler_org_geo");
    mockProvider({ docs: [] });
    await expect(
      Effect.runPromise(
        createAutorecyclerOrgGeoResolver()
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      ),
    ).rejects.toThrow("owned yard address");
    expect(
      (await client.execute("select * from autorecycler_org_geo")).rows,
    ).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("an organization request failure preserves cache even when a fallback could resolve it", async () => {
  const { client, database } = await databaseWithCity("Atlanta");
  try {
    const before = (await client.execute("select * from autorecycler_org_geo"))
      .rows;
    const { requests } = mockProvider({
      fail: "mget",
      website: {
        organization_custom_organization: org,
        name_text: "EZ Pull N Pay Columbus",
        address_geographic_address: address,
      },
    });
    const resolver = createAutorecyclerOrgGeoResolver();
    await expect(
      Effect.runPromise(
        resolver
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      ),
    ).rejects.toThrow("organization mget");
    expect(requests).toHaveLength(1);
    expect(resolver.getCached(org)).toBeUndefined();
    expect(
      (await client.execute("select * from autorecycler_org_geo")).rows,
    ).toEqual(before);
  } finally {
    client.close();
  }
});

test("a failed upsert does not mark the cache verified or populate memory", async () => {
  const { client, database } = await databaseWithCity("Atlanta");
  try {
    const before = (await client.execute("select * from autorecycler_org_geo"))
      .rows;
    await client.execute(
      "create trigger prevent_refresh before update on autorecycler_org_geo begin select raise(abort, 'read only cache'); end",
    );
    mockProvider();
    const resolver = createAutorecyclerOrgGeoResolver();
    await expect(
      Effect.runPromise(
        resolver
          .resolveOneEffect(seed)
          .pipe(Effect.provideService(Database, database)),
      ),
    ).rejects.toThrow("autorecyclerOrgGeo.upsert");
    expect(resolver.getCached(org)).toBeUndefined();
    expect(
      (await client.execute("select * from autorecycler_org_geo")).rows,
    ).toEqual(before);
  } finally {
    client.close();
  }
});

test.each([
  {
    name: "mget document error",
    mgetResponse: {
      docs: [
        { _id: recordId, error: { type: "unavailable_shards_exception" } },
      ],
    },
    requests: 1,
  },
  {
    name: "mget error with usable source",
    mgetResponse: { docs: [{ ...organization, error: "lookup failed" }] },
    requests: 1,
  },
  {
    name: "mget response error",
    mgetResponse: { error: "lookup failed", docs: [] },
    requests: 1,
  },
  { name: "missing mget docs", mgetResponse: {}, requests: 1 },
  { name: "null mget response", mgetResponse: null, requests: 1 },
  {
    name: "malformed mget document",
    mgetResponse: { docs: [null] },
    requests: 1,
  },
  {
    name: "website search error",
    msearchResponse: {
      responses: [{ error: { type: "unavailable_shards_exception" } }],
    },
    requests: 2,
  },
  { name: "empty mget document", mgetResponse: { docs: [{}] }, requests: 1 },
  {
    name: "found mget document missing source",
    mgetResponse: {
      docs: [{ _id: recordId, _type: "custom.organization", found: true }],
    },
    requests: 1,
  },
  {
    name: "mget document missing identity",
    mgetResponse: {
      docs: [
        {
          _type: "custom.organization",
          found: true,
          _source: organization._source,
        },
      ],
    },
    requests: 1,
  },
  {
    name: "mget document missing type",
    mgetResponse: {
      docs: [{ _id: recordId, found: true, _source: organization._source }],
    },
    requests: 1,
  },
  {
    name: "missing mget record carrying a source",
    mgetResponse: { docs: [{ ...organization, found: false }] },
    requests: 1,
  },
  {
    name: "website hit missing source",
    msearchResponse: { responses: [{ hits: { hits: [{}] } }] },
    requests: 2,
  },
  {
    name: "missing website hits",
    msearchResponse: { responses: [{}] },
    requests: 2,
  },
])(
  "preserves the cache after HTTP-200 $name even with a valid fallback",
  async (response) => {
    const { client, database } = await databaseWithCity("Atlanta");
    try {
      const before = (
        await client.execute("select * from autorecycler_org_geo")
      ).rows;
      const { requests } = mockProvider({
        docs: [],
        ...response,
        website: {
          organization_custom_organization: org,
          name_text: "EZ Pull N Pay Columbus",
          address_geographic_address: address,
        },
        rows: [
          {
            type: "custom.organization",
            data: { ...organization._source, _id: recordId },
          },
        ],
      });
      const resolver = createAutorecyclerOrgGeoResolver();
      await expect(
        Effect.runPromise(
          resolver
            .resolveOneEffect(seed)
            .pipe(Effect.provideService(Database, database)),
        ),
      ).rejects.toThrow(
        response.requests === 1 ? "organization mget" : "website msearch",
      );
      expect(requests).toHaveLength(response.requests);
      expect(resolver.getCached(org)).toBeUndefined();
      expect(
        (await client.execute("select * from autorecycler_org_geo")).rows,
      ).toEqual(before);
    } finally {
      client.close();
    }
  },
);

test.each([
  { name: "envelope identity", doc: organization },
  {
    name: "source identity",
    doc: {
      _source: {
        ...organization._source,
        _id: recordId,
        _type: "custom.organization",
      },
    },
  },
  { name: "explicit record miss", doc: { _id: recordId, found: false } },
])("accepts supported $name response shapes", async ({ name, doc }) => {
  const { client, database } = await databaseWithCity("Atlanta");
  try {
    const { requests } = mockProvider({
      docs: [doc],
      website: {
        organization_custom_organization: org,
        name_text: "EZ Pull N Pay Columbus",
        address_geographic_address: address,
      },
    });
    const resolver = createAutorecyclerOrgGeoResolver();
    const geo = await Effect.runPromise(
      resolver
        .resolveOneEffect(seed)
        .pipe(Effect.provideService(Database, database)),
    );
    expect(geo?.locationCity).toBe("Columbus");
    expect(requests).toHaveLength(name === "explicit record miss" ? 2 : 1);
    expect(resolver.getCached(org)?.locationCity).toBe("Columbus");
  } finally {
    client.close();
  }
});
