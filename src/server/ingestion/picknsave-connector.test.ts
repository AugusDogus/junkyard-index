import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchPickNSavePage } from "./picknsave-client";
import { streamPickNSaveInventoryWithRequestGate } from "./picknsave-connector";
import { PickNSaveCursor } from "./picknsave-cursor";
import type { PickNSaveCanonicalVehicle } from "./picknsave-transform";
import { PICKNSAVE_YARDS } from "./picknsave-yard-metadata";

const fixture = await Bun.file(
  new URL("./fixtures/picknsave-detail.html", import.meta.url),
).text();
const originalFetch = globalThis.fetch;
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const vin = (id: number) => `KMHGC46E69U${String(id).padStart(6, "0")}`;
function product(id: number) {
  return {
    id,
    date: "2026-08-03T00:00:00",
    status: "publish",
    type: "product",
    link: `https://pick-n-save.net/vehicles/test-${id}/`,
  };
}
function detail(id: number) {
  return fixture
    .replaceAll("post-4960", `post-${id}`)
    .replaceAll('product-id="4960"', `product-id="${id}"`)
    .replaceAll("KMHGC46E69U039032", vin(id))
    .replaceAll("SLER2663", `TEST${id}`)
    .replace(
      ">Lynchburg</div>",
      id % 2 ? ">Lynchburg</div>" : ">Roanoke</div>",
    );
}
function mockCatalog(
  options: {
    total?: number;
    page?: (page: number, response: Response) => Response;
    html?: (id: number, html: string) => string;
    detailResponse?: (id: number, response: Response) => Response;
  } = {},
) {
  const requests: string[] = [];
  const total = options.total ?? 26;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url.href);
      if (url.pathname === "/wp-json/wp/v2/product") {
        expect(url.searchParams.get("orderby")).toBe("id");
        expect(url.searchParams.get("order")).toBe("asc");
        const page = Number(url.searchParams.get("page"));
        const products = Array.from(
          { length: Math.min(25, Math.max(0, total - (page - 1) * 25)) },
          (_, i) => product((page - 1) * 25 + i + 1),
        );
        const response = Response.json(products, {
          headers: {
            "x-wp-total": String(total),
            "x-wp-totalpages": String(Math.ceil(total / 25)),
          },
        });
        return options.page?.(page, response) ?? response;
      }
      const id = Number(/^\/vehicles\/test-(\d+)\/$/.exec(url.pathname)?.[1]);
      if (!id) throw new Error(`Unexpected test request ${url}`);
      const response = new Response(
        options.html?.(id, detail(id)) ?? detail(id),
        {
          headers: { "content-type": "text/html" },
        },
      );
      return options.detailResponse?.(id, response) ?? response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

describe("Pick-n-Save complete enumeration", () => {
  test("resumes provider pages with totals, ordered IDs, both yards, and complete fields", async () => {
    const requests = mockCatalog();
    const vehicles: PickNSaveCanonicalVehicle[] = [];
    const onBatch = (batch: PickNSaveCanonicalVehicle[]) =>
      Effect.sync(() => {
        vehicles.push(...batch);
      });
    const first = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate({ maxPages: 1, onBatch }, gate),
    );
    expect(first).toMatchObject({
      status: "paused",
      count: 25,
      pagesProcessed: 1,
      cursor: {
        phase: "page",
        page: 2,
        totalProducts: 26,
        lastProductId: 25,
        yardsSeen: ["PNS-VA-LYNCHBURG", "PNS-VA-ROANOKE"],
      },
    });
    const yards: string[] = [];
    const second = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        {
          startCursor: first.cursor,
          onBatch,
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch.map((yard) => yard.code));
            }),
        },
        gate,
      ),
    );
    expect(second).toMatchObject({
      status: "complete",
      count: 1,
      pagesProcessed: 1,
      cursor: { phase: "complete" },
    });
    expect(vehicles).toHaveLength(26);
    expect(yards).toEqual(PICKNSAVE_YARDS.map((yard) => yard.code));
    expect(
      vehicles.every(
        (v) =>
          v.vin &&
          v.color &&
          v.stockNumber &&
          v.imageUrl &&
          v.row &&
          v.availableDate &&
          v.detailsUrl &&
          v.lat &&
          v.lng,
      ),
    ).toBe(true);
    expect(requests).toHaveLength(28);
    const replay = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        { startCursor: second.cursor, onBatch },
        gate,
      ),
    );
    expect(replay).toMatchObject({
      status: "complete",
      count: 0,
      pagesProcessed: 0,
    });
    expect(requests).toHaveLength(28);
  });
  test("rejects incomplete listings while retaining independent VIN presence", async () => {
    mockCatalog({
      total: 25,
      html: (id, html) =>
        id === 1
          ? html.replace("<b>Model:</b> GENESIS", "<b>Model:</b>")
          : html,
    });
    const vehicles: PickNSaveCanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    expect(result).toMatchObject({
      status: "complete",
      count: 24,
      observedVins: [vin(1)],
      accounting: { recordsProcessed: 25, recordsRejected: 1 },
    });
    expect(vehicles.some((v) => v.vin === vin(1))).toBe(false);
  });
  test("emits required-valid donors with null optional metadata through a terminal chunk", async () => {
    mockCatalog({
      total: 25,
      page: (_page, response) =>
        Response.json(
          Array.from({ length: 25 }, (_, i) => ({
            ...product(i + 1),
            date: null,
          })),
          { headers: response.headers },
        ),
      html: (_id, html) =>
        html.replace(/(<b>(?:Color|Stock|Location):<\/b>)[^<]*/g, "$1"),
    });
    const vehicles: PickNSaveCanonicalVehicle[] = [];
    const result = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    expect(result).toMatchObject({
      status: "complete",
      count: 25,
      accounting: { recordsRejected: 0 },
    });
    expect(vehicles).toHaveLength(25);
    expect(
      vehicles.every(
        (vehicle) =>
          vehicle.color === null &&
          vehicle.stockNumber === null &&
          vehicle.row === null &&
          vehicle.availableDate === null &&
          vehicle.imageUrl === null,
      ),
    ).toBe(true);
  });
  test("explicitly unavailable vehicles provide no presence protection", async () => {
    mockCatalog({
      total: 25,
      html: (id, html) =>
        id === 1 ? html.replace(" instock ", " outofstock ") : html,
    });
    const result = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    );
    expect(result).toMatchObject({
      count: 24,
      observedVins: [],
      accounting: { recordsExcluded: 1, recordsRejected: 0 },
    });
  });
  test("counts repeated VINs once inside a checkpoint", async () => {
    mockCatalog({
      total: 25,
      html: (id, html) => (id === 2 ? html.replace(vin(2), vin(1)) : html),
    });
    const result = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    );
    expect(result).toMatchObject({
      count: 24,
      accounting: {
        recordsProcessed: 25,
        duplicateVehicles: 1,
        recordsRejected: 0,
      },
    });
  });
  test("stops a denied detail without retrying or emitting its page", async () => {
    const requests = mockCatalog({
      detailResponse: (id, response) =>
        id === 3 ? new Response("Forbidden", { status: 403 }) : response,
    });
    let batches = 0;
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                batches++;
              }),
          },
          gate,
        ),
      ),
    ).rejects.toThrow("HTTP 403");
    expect(requests.filter((url) => url.endsWith("/test-3/"))).toHaveLength(1);
    expect(batches).toBe(0);
  });
  test("fails a partial detail response before callbacks for its page", async () => {
    mockCatalog({
      html: (id, html) => (id === 3 ? html.replace("</html>", "") : html),
    });
    let batches = 0;
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                batches++;
              }),
          },
          gate,
        ),
      ),
    ).rejects.toThrow("truncated");
    expect(batches).toBe(0);
  });
  test("fails when the full traversal loses a known yard", async () => {
    mockCatalog({
      total: 25,
      html: (_id, html) => html.replace(">Roanoke</div>", ">Lynchburg</div>"),
    });
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("both verified yards");
  });
  test("rejects changed totals and repeated pages after a saved checkpoint", async () => {
    mockCatalog();
    const first = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        { maxPages: 1, onBatch: () => Effect.void },
        gate,
      ),
    );
    mockCatalog({ total: 27 });
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          { startCursor: first.cursor, onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("catalog changed");
    mockCatalog({
      page: (page, response) =>
        page === 2
          ? Response.json([product(1)], { headers: response.headers })
          : response,
    });
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          { startCursor: first.cursor, onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("repeated or reordered");
  });
  test("a failed callback returns no advanced checkpoint and can replay", async () => {
    mockCatalog({ total: 25 });
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          { onBatch: () => Effect.fail(new Error("snapshot failed")) },
          gate,
        ),
      ),
    ).rejects.toThrow("snapshot failed");
    const replay = await Effect.runPromise(
      streamPickNSaveInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    );
    expect(replay).toMatchObject({ status: "complete", count: 25 });
  });
  test.each([
    [
      "missing totals",
      (r: Response) => {
        r.headers.delete("x-wp-total");
        return r;
      },
    ],
    [
      "contradictory pages",
      (r: Response) => {
        r.headers.set("x-wp-totalpages", "9");
        return r;
      },
    ],
    [
      "partial HTTP response",
      (r: Response) => new Response("[]", { status: 206, headers: r.headers }),
    ],
    [
      "short page",
      (r: Response) => Response.json([product(1)], { headers: r.headers }),
    ],
    [
      "unverified vehicle host",
      (r: Response) =>
        Response.json(
          Array.from({ length: 25 }, (_, i) => ({
            ...product(i + 1),
            link: "https://example.com/vehicles/test/",
          })),
          { headers: r.headers },
        ),
    ],
  ] as const)("rejects %s", async (_name, mutate) => {
    mockCatalog({ page: (_page, response) => mutate(response) });
    await expect(
      Effect.runPromise(fetchPickNSavePage(1, gate)),
    ).rejects.toThrow();
  });
  test("validates checkpoints before requesting inventory", async () => {
    const requests = mockCatalog();
    await expect(
      Effect.runPromise(
        streamPickNSaveInventoryWithRequestGate(
          {
            startCursor: {
              source: "picknsave",
              phase: "page",
              page: 4,
              totalProducts: 26,
              lastProductId: 25,
              yardsSeen: [],
            },
            onBatch: () => Effect.void,
          },
          gate,
        ),
      ),
    ).rejects.toThrow("Inconsistent");
    expect(requests).toEqual([]);
    expect(PickNSaveCursor.initial).toEqual({
      source: "picknsave",
      phase: "start",
    });
  });
});
