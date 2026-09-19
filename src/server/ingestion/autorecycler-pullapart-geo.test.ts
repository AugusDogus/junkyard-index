import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Effect } from "effect";
import { Database } from "./context";
import { createAutorecyclerOrgGeoResolver } from "./autorecycler-geo";
import {
  matchesPullapartOrganization,
  parsePullapartPageGeo,
} from "./autorecycler-pullapart-geo";

const org = {
  id_text: "pull-a-part-winston-salem",
  name_text: "Pull A Part - Winston-Salem",
  address_city_text: "Winston-Salem",
  address_zip_text: "27105",
};
const location = {
  locationName: "Winston-Salem",
  cityName: "Winston-Salem",
  zipCode: "27105-2250",
};
const url = "https://www.pullapart.com/locations/north-carolina/winston-salem/";
const expected = {
  orgLookup: "1348695171700984260__LOOKUP__1761169972557x110781710658965700",
  url,
  name: "Pull-A-Part - Winston-Salem",
  postalCode: "27105-2250",
  state: "NC",
  streetAddress: "4125 N. Patterson Ave",
  operator: "Pull-A-Part",
};
const node = {
  "@type": ["AutoPartsStore", "AutomotiveBusiness"],
  url,
  name: "Pull-A-Part Winston-Salem",
  address: {
    streetAddress: "4125 N. Patterson Ave",
    addressLocality: "Winston-Salem",
    addressRegion: "NC",
    postalCode: "27105",
    addressCountry: "US",
  },
  geo: { latitude: 36.1622791, longitude: -80.2565927 },
};
const html = (nodes: unknown[], canonical = url) =>
  `<link rel="canonical" href="${canonical}"><script type="application/ld+json">${JSON.stringify({ "@graph": nodes })}</script>`;

test("recovers the real Winston-Salem yard from matching official location data", () => {
  expect(matchesPullapartOrganization(org, location)).toBe(true);
  expect(parsePullapartPageGeo(html([node]), expected)).toEqual({
    orgLookup: expected.orgLookup,
    locationName: "Pull-A-Part Winston-Salem",
    locationCity: "Winston-Salem",
    state: "North Carolina",
    stateAbbr: "NC",
    lat: 36.1622791,
    lng: -80.2565927,
    address: "4125 N. Patterson Ave, Winston-Salem, NC 27105, USA",
  });
});

test("does not assign current Pittsburgh coordinates to the Coraopolis record", () => {
  expect(
    matchesPullapartOrganization(
      {
        id_text: "pull-a-part-pittsburgh",
        name_text: "Pull A Part - Pittsburgh",
        address_city_text: "Coraopolis",
        address_zip_text: "15108",
      },
      { locationName: "Pittsburgh", cityName: "Pittsburgh", zipCode: "15235" },
    ),
  ).toBe(false);
});

test.each([
  { ...org, id_text: "unrelated-company" },
  { ...org, name_text: "Other Yard - Winston-Salem" },
  { ...org, address_zip_text: "27107" },
])("requires matching upstream business identity and ZIP: %j", (raw) => {
  expect(matchesPullapartOrganization(raw, location)).toBe(false);
});

test.each([
  {
    ...node,
    url: "https://www.pullapart.com/locations/north-carolina/charlotte/",
  },
  { ...node, name: "Pull-A-Part Charlotte" },
  { ...node, address: { ...node.address, postalCode: "99999" } },
  {
    ...node,
    address: { ...node.address, streetAddress: "123 Different Road" },
  },
  { ...node, address: { ...node.address, addressRegion: "SC" } },
  { ...node, geo: { latitude: 0, longitude: 0 } },
  { ...node, geo: { latitude: 200, longitude: -80 } },
  { ...node, "@type": "Service" },
])("rejects conflicting or invalid official page metadata: %j", (data) => {
  expect(parsePullapartPageGeo(html([data]), expected)).toBeNull();
});

test("rejects redirected, ambiguous and missing location pages", () => {
  expect(
    parsePullapartPageGeo(
      html([node], "https://www.pullapart.com/locations/"),
      expected,
    ),
  ).toBeNull();
  expect(parsePullapartPageGeo(html([node, node]), expected)).toBeNull();
  expect(parsePullapartPageGeo(html([]), expected)).toBeNull();
});

test("accepts street suffix abbreviations without accepting a different street number", () => {
  expect(
    parsePullapartPageGeo(html([node]), {
      ...expected,
      streetAddress: "4125 North Patterson Avenue",
    })?.lat,
  ).toBe(node.geo.latitude);
  expect(
    parsePullapartPageGeo(html([node]), {
      ...expected,
      streetAddress: "4127 North Patterson Avenue",
    }),
  ).toBeNull();
});

test("matches the official Colorado Springs highway address without changing route numbers", () => {
  const url =
    "https://www.upullandpay.com/locations/colorado/colorado-springs/";
  const data = {
    ...node,
    url,
    name: "U-Pull-&-Pay Colorado Springs",
    address: {
      ...node.address,
      streetAddress: "3745 S. U.S. Highway 85-87",
      addressLocality: "Colorado Springs",
      addressRegion: "CO",
      postalCode: "80906",
    },
    geo: { latitude: 38.778245, longitude: -104.7770817 },
  };
  const context = {
    ...expected,
    url,
    name: data.name,
    operator: "U-Pull-&-Pay",
    streetAddress: "3745 So. Highway 85-87",
    state: "CO",
    postalCode: "80906",
  };
  expect(parsePullapartPageGeo(html([data], url), context)?.lat).toBe(
    38.778245,
  );
  expect(
    parsePullapartPageGeo(html([data], url), {
      ...context,
      streetAddress: "3745 So. Highway 86",
    }),
  ).toBeNull();
});

test("accepts published municipality aliases only when the official street and ZIP agree", () => {
  const data = {
    ...node,
    name: "Pull-A-Part Lithonia",
    address: {
      ...node.address,
      addressLocality: "Lithonia",
      addressRegion: "GA",
      postalCode: "30058",
      streetAddress: "6513 Marshall Boulevard",
    },
    geo: { latitude: 33.7349021, longitude: -84.1253024 },
  };
  expect(
    parsePullapartPageGeo(html([data]), {
      ...expected,
      name: "Pull-A-Part - Atlanta East",
      state: "GA",
      postalCode: "30058",
      streetAddress: "6513 Marshall Boulevard",
    })?.locationCity,
  ).toBe("Lithonia");
  expect(
    matchesPullapartOrganization(
      {
        ...org,
        id_text: "pull-a-part-corpus christi",
        name_text: "Pull A Part - Corpus Christi",
        address_city_text: "Corpus Christi",
        address_zip_text: "78405",
      },
      {
        locationName: "Corpus Christi",
        cityName: "Corpus Christi",
        zipCode: "78405",
      },
    ),
  ).toBe(true);
  expect(
    parsePullapartPageGeo(
      html([{ ...node, "@type": "AutomotiveBusiness" }]),
      expected,
    )?.lat,
  ).toBe(node.geo.latitude);
});

test.each(["matched", "conflicting ZIP", "unavailable page"])(
  "official location lookup: %s",
  async (scenario) => {
    const originalFetch = globalThis.fetch;
    const client = createClient({ url: ":memory:" });
    let requests = 0;
    const officialLocation = {
      idNumber: 19,
      nameItem: "Winston-Salem",
      locationID: 19,
      locationName: "Winston-Salem",
      address1: "4125 N. Patterson Ave",
      address2: "",
      cityName: "Winston-Salem",
      stateName: "NC",
      zipCode: scenario === "conflicting ZIP" ? "27107" : "27105-2250",
      siteTypeID: 3,
      phone: "336-661-1110",
      phoneCarBuying: "336-462-8148",
      phoneUsedCar: null,
      distanceInMiles: 0,
      taxRate: 0,
      warrantyDays: 0,
      coreDays: 0,
      allowsCashReturns: 0,
      email: "",
      passcodeForMiscItems: false,
      retailEmail: "",
      environmentalFeeRate: 0,
      environmentalFeeCap: 0,
      locationShortName: "winston",
    };
    try {
      await client.executeMultiple(
        `create table autorecycler_org_geo (org_lookup text primary key, lat real not null, lng real not null, location_name text not null, location_city text not null, state text not null, state_abbr text not null, address text, updated_at integer not null, resolution_version integer not null default 0)`,
      );
      globalThis.fetch = Object.assign(
        async (input: RequestInfo | URL) => {
          requests++;
          const target = String(input);
          if (target.endsWith("/mget"))
            return Response.json({
              docs: [
                {
                  _id: "1761169972557x110781710658965700",
                  _type: "custom.organization",
                  found: true,
                  _source: org,
                },
              ],
            });
          if (target.endsWith("/msearch"))
            return Response.json({ responses: [{ hits: { hits: [] } }] });
          if (target.includes("/init/data")) return Response.json([]);
          if (target.endsWith("/interchange/GetLocations"))
            return Response.json([officialLocation]);
          if (target === url)
            return scenario === "unavailable page"
              ? new Response("Unavailable", { status: 403 })
              : new Response(html([node]));
          throw new Error(`Unexpected test request: ${target}`);
        },
        { preconnect: originalFetch.preconnect },
      );
      const database = drizzle(client);
      const seed = {
        orgLookup: expected.orgLookup,
        inventoryIdSeed: "1761173625126x883105909157925400",
      };
      const resolve = () =>
        Effect.runPromise(
          createAutorecyclerOrgGeoResolver()
            .resolveOneEffect(seed)
            .pipe(Effect.provideService(Database, database)),
        );
      const result = await resolve();
      if (scenario === "matched") {
        expect(result.status).toBe("resolved");
        expect(
          (
            await client.execute(
              "select address, lat, lng, resolution_version from autorecycler_org_geo",
            )
          ).rows[0],
        ).toMatchObject({
          address: "4125 N. Patterson Ave, Winston-Salem, NC 27105, USA",
          lat: 36.1622791,
          lng: -80.2565927,
          resolution_version: 1,
        });
        expect(requests).toBe(5);
        expect((await resolve()).status).toBe("resolved");
        expect(requests).toBe(5);
      } else {
        expect(result.status).toBe("unresolved");
        expect(
          (await client.execute("select * from autorecycler_org_geo")).rows,
        ).toHaveLength(0);
      }
    } finally {
      globalThis.fetch = originalFetch;
      client.close();
    }
  },
);
