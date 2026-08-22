import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  TapInventorySearchProductSchema,
  fetchTapBootstrap,
  fetchTapStores,
  searchTapInventory,
} from "./tap-inventory-client";
import { TEARAPART_SITE_CONFIG } from "./tap-sites";

const originalFetch = globalThis.fetch;

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

async function fixtureText(fileName: string): Promise<string> {
  return await Bun.file(fixtureUrl(fileName)).text();
}

function installFetchStub(respond: (url: string) => Promise<string>): void {
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL): Promise<Response> => {
      const text = await respond(String(input));
      return new Response(text, { status: 200 });
    },
    { preconnect: originalFetch.preconnect },
  );
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TapInventorySearchProductSchema", () => {
  test("accepts a provider record without unused metadata fields", async () => {
    const product = await Effect.runPromise(
      Schema.decodeUnknown(TapInventorySearchProductSchema)({
        stocknumber: "DMI033764",
        iyear: "2002",
        make: "FORD",
        model: "TAURUS",
        vehicle_row: "0",
        color: "UNKNOWN",
        vin: "1FAFP55222A222779",
        image_url: "",
      }),
    );

    expect(product).toEqual({
      stocknumber: "DMI033764",
      iyear: "2002",
      make: "FORD",
      model: "TAURUS",
      vehicle_row: "0",
      color: "UNKNOWN",
      vin: "1FAFP55222A222779",
      image_url: "",
    });
  });

  test("ignores extra metadata fields emitted by other TAP plugin sites", () => {
    const product = Schema.decodeUnknownSync(TapInventorySearchProductSchema)({
      stocknumber: "STK239020",
      iyear: "1988",
      make: "CHEVROLET",
      model: "SPRINT",
      vehicle_row: "6",
      yard_in_date: "2026-07-14T08:48:09.737",
      color: "RED",
      vin: "JG1MR2158JK724014",
      image_url: "",
      s3clientid: "1001",
      crush_version: "v.4.94",
      yard_name: "TEAR A PART SLC",
      mileage: "66",
    });

    expect(product).toEqual({
      stocknumber: "STK239020",
      iyear: "1988",
      make: "CHEVROLET",
      model: "SPRINT",
      vehicle_row: "6",
      yard_in_date: "2026-07-14T08:48:09.737",
      color: "RED",
      vin: "JG1MR2158JK724014",
      image_url: "",
    });
  });
});

describe("fetchTapBootstrap", () => {
  test("decodes the live Tear-A-Part bootstrap object", async () => {
    const html = await fixtureText("tap-tearapart-inventory.html");
    installFetchStub(() => Promise.resolve(html));

    const bootstrap = await Effect.runPromise(
      fetchTapBootstrap(TEARAPART_SITE_CONFIG),
    );

    expect(bootstrap.ajaxUrl).toBe(
      "https://tearapart.com/wp-admin/admin-ajax.php",
    );
    expect(bootstrap.nonce).toBe("2eb4fca84d");
    expect(bootstrap.pluginUrl).toBe(
      "https://tearapart.com/wp-content/plugins/tap-inventory-search-system/",
    );
  });

  test("rejects pages served by a different plugin path", async () => {
    const html = await fixtureText("tap-tearapart-inventory.html");
    installFetchStub(() => Promise.resolve(html));

    const result = await Effect.runPromiseExit(
      fetchTapBootstrap({
        ...TEARAPART_SITE_CONFIG,
        expectedPluginPath: "some-other-plugin",
      }),
    );

    expect(result._tag).toBe("Failure");
  });
});

describe("fetchTapStores", () => {
  test("parses the live Tear-A-Part store options", async () => {
    const html = await fixtureText("tap-tearapart-inventory.html");
    const stores = await fixtureText("tap-tearapart-stores.html");
    installFetchStub((url) =>
      url.includes("admin-ajax.php")
        ? Promise.resolve(stores)
        : Promise.resolve(html),
    );

    const options = await Effect.runPromise(
      fetchTapStores(TEARAPART_SITE_CONFIG),
    );

    expect(options.map((option) => option.value)).toEqual([
      "SALT LAKE CITY",
      "OGDEN",
    ]);
    expect(options[0]?.selected).toBe(true);
  });
});

describe("searchTapInventory", () => {
  test("decodes the live Tear-A-Part Salt Lake City search response", async () => {
    const html = await fixtureText("tap-tearapart-inventory.html");
    const search = await fixtureText(
      "tap-tearapart-search-salt-lake-city.json",
    );
    installFetchStub((url) =>
      url.includes("admin-ajax.php")
        ? Promise.resolve(search)
        : Promise.resolve(html),
    );

    const response = await Effect.runPromise(
      searchTapInventory({
        config: TEARAPART_SITE_CONFIG,
        store: "SALT LAKE CITY",
        make: "Any",
        model: "Any",
      }),
    );

    expect(response.success).toBe(true);
    expect(response.products.length).toBe(8);
    expect(response.products[0]).toMatchObject({
      stocknumber: "STK239020",
      make: "CHEVROLET",
      model: "SPRINT",
      vin: "JG1MR2158JK724014",
    });
  });

  test("parses the live Tear-A-Part Ogden search response", async () => {
    const html = await fixtureText("tap-tearapart-inventory.html");
    const search = await fixtureText("tap-tearapart-search-ogden.json");
    installFetchStub((url) =>
      url.includes("admin-ajax.php")
        ? Promise.resolve(search)
        : Promise.resolve(html),
    );

    const response = await Effect.runPromise(
      searchTapInventory({
        config: TEARAPART_SITE_CONFIG,
        store: "OGDEN",
        make: "Any",
        model: "Any",
      }),
    );

    expect(response.success).toBe(true);
    expect(response.products.length).toBe(8);
    expect(response.products.every((product) => product.vin.length > 0)).toBe(
      true,
    );
  });
});
