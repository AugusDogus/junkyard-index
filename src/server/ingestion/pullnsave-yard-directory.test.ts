import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createPullNSaveYardResolver,
  loadCachedPullNSaveYards,
} from "./pullnsave-yard-directory";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { yard } from "~/schema";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const directoryRow = {
  astStoreNumber: 10,
  yardName: "Pull N Save - New Yard",
  yardAddress: "100 Main St, Mesa, AZ",
  yardZip: "85201",
};

function installDirectory(data: unknown, status = 200) {
  const requests: Array<{ url: string; body: URLSearchParams }> = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        ),
      });
      if (url.endsWith("/inventory/"))
        return new Response(
          '<script>var pns_inventory_sf_ajax = {"nonce":"fixture-nonce"};</script>',
        );
      if (url.includes("admin-ajax.php"))
        return new Response(JSON.stringify({ success: true, data }), {
          status,
        });
      if (url === "https://api.zippopotam.us/us/85201")
        return new Response(
          JSON.stringify({
            places: [
              {
                latitude: "33.43",
                longitude: "-111.85",
                "place name": "Mesa",
                state: "Arizona",
                "state abbreviation": "AZ",
              },
            ],
          }),
        );
      return new Response("not found", { status: 404 });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

describe("Pull-N-Save runtime yard discovery", () => {
  test("discovers a new yard without a registry change and caches it for the chunk", async () => {
    const requests = installDirectory([directoryRow]);
    const resolve = await Effect.runPromise(
      createPullNSaveYardResolver((request) => request),
    );
    const result = await Effect.runPromise(resolve(10));
    expect(result).toMatchObject({
      status: "resolved",
      yard: {
        yardNumber: 10,
        code: "PNS-10",
        locationName: "Pull N Save - New Yard",
        city: "Mesa",
        state: "Arizona",
        stateAbbr: "AZ",
        address: "100 Main St",
        zipCode: "85201",
        lat: 33.43,
        lng: -111.85,
      },
      metadata: { source: "pullnsave", code: "PNS-10", lat: null, lng: null },
    });
    expect(await Effect.runPromise(resolve(10))).toEqual(result);
    expect(requests).toHaveLength(3);
    const query = requests.find((request) =>
      request.url.includes("admin-ajax.php"),
    )?.body;
    expect(query?.get("action")).toBe("pns_get_inventory_assets");
    expect(query?.get("yard[]")).toBe("10");
    expect(query?.get("security")).toBe("fixture-nonce");
    expect(query?.get("yearStart")).toBe("0");
    expect(query?.get("yearEnd")).toBe("0");
    expect(query?.get("make")).toBe("");
  });

  test("store 8 is discoverable when the public response identifies it", async () => {
    installDirectory([{ ...directoryRow, astStoreNumber: 8 }]);
    const resolve = await Effect.runPromise(
      createPullNSaveYardResolver((request) => request),
    );
    expect(await Effect.runPromise(resolve(8))).toMatchObject({
      status: "resolved",
      yard: { yardNumber: 8, code: "PNS-8" },
    });
  });

  test("reloads persisted discoveries when the public directory is unavailable in a later run", async () => {
    installDirectory([directoryRow]);
    const firstResolver = await Effect.runPromise(
      createPullNSaveYardResolver((request) => request),
    );
    const discovered = await Effect.runPromise(firstResolver(10));
    if (discovered.status !== "resolved")
      throw new Error("Expected discovered yard fixture");
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(
        await Bun.file(
          new URL("../../../drizzle/0007_yard_metadata.sql", import.meta.url),
        ).text(),
      );
      const database = drizzle(client);
      await database
        .insert(yard)
        .values({ ...discovered.metadata, updatedAt: new Date() });
      const requests = installDirectory([], 403);
      const cached = await loadCachedPullNSaveYards(database);
      const nextResolver = await Effect.runPromise(
        createPullNSaveYardResolver((request) => request, cached),
      );
      expect(await Effect.runPromise(nextResolver(10))).toEqual(discovered);
      expect(requests.map((request) => request.url)).toEqual([
        "https://api.zippopotam.us/us/85201",
      ]);
    } finally {
      client.close();
    }
  });

  test("does not guess metadata from another yard and retries missing metadata in the next chunk", async () => {
    const requests = installDirectory([
      null,
      { ...directoryRow, astStoreNumber: 99 },
      { astStoreNumber: 10 },
    ]);
    const resolve = await Effect.runPromise(
      createPullNSaveYardResolver((request) => request),
    );
    expect(await Effect.runPromise(resolve(10))).toMatchObject({
      status: "unresolved",
      yardNumber: 10,
    });
    await Effect.runPromise(resolve(10));
    expect(requests).toHaveLength(2);
    installDirectory([directoryRow]);
    const nextChunk = await Effect.runPromise(
      createPullNSaveYardResolver((request) => request),
    );
    expect(await Effect.runPromise(nextChunk(10))).toMatchObject({
      status: "resolved",
    });
  });

  test("a metadata outage returns a diagnostic without blocking cached known yards", async () => {
    installDirectory([], 403);
    const resolve = await Effect.runPromise(
      createPullNSaveYardResolver((request) => request),
    );
    const result = await Effect.runPromise(resolve(10));
    expect(result).toMatchObject({ status: "unresolved", yardNumber: 10 });
    if (result.status === "unresolved") expect(result.reason).toContain("403");
    expect(await Effect.runPromise(resolve(1))).toMatchObject({
      status: "resolved",
      yard: { code: "PNS-SLC" },
    });
  });
});
