import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamTapSiteInventory } from "./tap-inventory-connector";
import { TEARAPART_SITE_CONFIG } from "./tap-sites";

const originalFetch = globalThis.fetch;

function fixtureUrl(fileName: string): URL {
  return new URL(`./fixtures/${fileName}`, import.meta.url);
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("streamTapSiteInventory", () => {
  test("streams every configured Tear-A-Part store independently", async () => {
    const bootstrapHtml = await Bun.file(
      fixtureUrl("tap-tearapart-inventory.html"),
    ).text();
    const storesHtml = await Bun.file(
      fixtureUrl("tap-tearapart-stores.html"),
    ).text();
    const saltLakeSearch = JSON.stringify(
      await Bun.file(
        fixtureUrl("tap-tearapart-search-salt-lake-city.json"),
      ).json(),
    );
    const ogdenSearch = JSON.stringify(
      await Bun.file(fixtureUrl("tap-tearapart-search-ogden.json")).json(),
    );

    const requestedUrls: string[] = [];
    globalThis.fetch = Object.assign(
      async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const url = String(input);
        requestedUrls.push(url);
        if (!url.includes("admin-ajax.php")) {
          return new Response(bootstrapHtml, { status: 200 });
        }
        const body = String(init?.body ?? "");
        if (body.includes("action=sif_get_stores")) {
          return new Response(storesHtml, { status: 200 });
        }
        if (body.includes("sif_form_field_store=SALT+LAKE+CITY")) {
          return new Response(saltLakeSearch, { status: 200 });
        }
        return new Response(ogdenSearch, { status: 200 });
      },
      { preconnect: originalFetch.preconnect },
    );

    const batches: string[][] = [];
    const result = await Effect.runPromise(
      streamTapSiteInventory({
        config: TEARAPART_SITE_CONFIG,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            batches.push(vehicles.map((vehicle) => vehicle.vin));
          }),
      }),
    );

    expect(result.source).toBe("tearapart");
    expect(result.status).toBe("complete");
    expect(result.cursor).toBe(2);
    expect(result.pagesProcessed).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.count).toBe(16);
    expect(batches.map((batch) => batch.length)).toEqual([8, 8]);
    expect(
      requestedUrls.filter((url) => url.includes("admin-ajax.php")),
    ).toHaveLength(3);
  });
});
