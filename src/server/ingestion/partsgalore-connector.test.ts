import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { PARTSGALORE_INVENTORY_URL } from "./partsgalore-client";
import {
  streamPartsGaloreInventoryWithRequestGate,
  PARTSGALORE_BATCH_SIZE,
} from "./partsgalore-connector";
import {
  PARTSGALORE_YARD,
  type PartsGaloreYard,
} from "./partsgalore-yard-metadata";
import type { PartsGaloreCanonicalVehicle } from "./partsgalore-transform";

const fixture = await Bun.file(
  new URL("./fixtures/partsgalore-catalog.html", import.meta.url),
).text();
const originalFetch = globalThis.fetch;
const originalYard = { ...PARTSGALORE_YARD };
afterEach(() => {
  globalThis.fetch = originalFetch;
  Object.assign(PARTSGALORE_YARD, originalYard);
});
function mockResponse(html = fixture, init?: ResponseInit) {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      requests.push({ url: String(input), init: requestInit });
      return new Response(html, init);
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

describe("Parts Galore atomic catalog", () => {
  test("one truthful-UA request emits yard metadata and raw counters at terminal cursor 1", async () => {
    const requests = mockResponse(
      fixture.replace(
        "</tbody>",
        `<tr><td>bad</td></tr>
      <tr><td>2014</td><td>Chrysler</td><td>Town &amp; Country</td><td>2c4rc1cg6er328677</td><td></td><td></td><td></td></tr>
      <tr><td>2014</td><td>Chrysler</td><td></td><td>1FADP3K20EL345103</td><td></td><td></td><td></td></tr></tbody>`,
      ),
    );
    const vehicles: PartsGaloreCanonicalVehicle[] = [];
    const yards: PartsGaloreYard[] = [];
    const result = await Effect.runPromise(
      streamPartsGaloreInventoryWithRequestGate(
        {
          onYards: (batch) =>
            Effect.sync(() => {
              yards.push(...batch);
            }),
          onBatch: (batch) =>
            Effect.sync(() => {
              expect(yards).toHaveLength(1);
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: PARTSGALORE_INVENTORY_URL,
      init: { method: "GET", headers: { "User-Agent": "JunkyardIndex/1.0" } },
    });
    expect(vehicles).toHaveLength(2);
    expect(yards).toEqual([PARTSGALORE_YARD]);
    expect(result).toMatchObject({
      source: "partsgalore",
      status: "complete",
      cursor: 1,
      count: 2,
      pagesProcessed: 1,
      errors: [],
      observedVins: ["1FADP3K20EL345103"],
      accounting: {
        recordsProcessed: 5,
        recordsRejected: 2,
        recordsExcluded: 0,
        duplicateVehicles: 1,
      },
    });
  });
  test("bounded batches are local delivery, not synthetic provider pages", async () => {
    const rows = Array.from(
      { length: 601 },
      (_, index) =>
        `<tr><td>2014</td><td>Ford</td><td>Focus</td><td>1FADP3K20EL${String(index).padStart(6, "0")}</td><td></td><td></td><td></td></tr>`,
    ).join("");
    const requests = mockResponse(
      fixture.replace(/<tbody>[\s\S]*?<\/tbody>/, `<tbody>${rows}</tbody>`),
    );
    const sizes: number[] = [];
    const result = await Effect.runPromise(
      streamPartsGaloreInventoryWithRequestGate(
        {
          onBatch: (batch) =>
            Effect.sync(() => {
              sizes.push(batch.length);
            }),
        },
        gate,
      ),
    );
    expect(sizes).toEqual([
      PARTSGALORE_BATCH_SIZE,
      PARTSGALORE_BATCH_SIZE,
      101,
    ]);
    expect(result).toMatchObject({ count: 601, pagesProcessed: 1, cursor: 1 });
    expect(requests).toHaveLength(1);
  });
  test("terminal cursor performs no fetch or callbacks", async () => {
    const requests = mockResponse();
    const result = await Effect.runPromise(
      streamPartsGaloreInventoryWithRequestGate(
        {
          startCursor: 1,
          onBatch: () => Effect.die("unexpected batch"),
          onYards: () => Effect.die("unexpected yards"),
        },
        gate,
      ),
    );
    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ count: 0, pagesProcessed: 0, cursor: 1 });
  });
  test.each([
    ["WAF with full table", fixture, { status: 403 }],
    ["partial response", fixture, { status: 206 }],
    [
      "content range",
      fixture,
      { headers: { "Content-Range": "items 0-1/1059" } },
    ],
    [
      "next link",
      fixture,
      { headers: { Link: '</inventory/?page=2>; rel="next"' } },
    ],
    ["challenge", "<html>Access denied</html>", {}],
    ["truncated", fixture.replace("</table>", ""), {}],
    [
      "all unusable",
      fixture.replace(/<td>(1979|2014)<\/td>/g, "<td></td>"),
      {},
    ],
  ])("fails closed before callbacks: %s", async (_label, html, init) => {
    const requests = mockResponse(html, init);
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    const result = await Effect.runPromise(
      Effect.either(
        streamPartsGaloreInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
    expect(callbacks).toBe(0);
    expect(requests).toHaveLength(1);
    if (_label === "WAF with full table" && result._tag === "Left")
      expect(result.left.message).toContain("403");
  });
  test("missing yard coordinates retain observed VINs with truthful exclusions and a warning", async () => {
    mockResponse();
    Object.assign(PARTSGALORE_YARD, { lat: null, lng: null });
    const result = await Effect.runPromise(
      streamPartsGaloreInventoryWithRequestGate(
        { onBatch: () => Effect.die("unexpected batch") },
        gate,
      ),
    );
    expect(result).toMatchObject({
      count: 0,
      observedVins: ["3N69R9M338069", "2C4RC1CG6ER328677"],
      accounting: {
        recordsProcessed: 2,
        recordsExcluded: 2,
        recordsRejected: 0,
        duplicateVehicles: 0,
      },
    });
    expect(result.warnings?.[0]).toContain(
      "Observed VINs preserve existing inventory",
    );
  });
  test("callback failure cannot return a terminal checkpoint", async () => {
    mockResponse();
    const result = await Effect.runPromise(
      Effect.either(
        streamPartsGaloreInventoryWithRequestGate(
          { onBatch: () => Effect.fail("sink failed") },
          gate,
        ),
      ),
    );
    expect(result).toMatchObject({ _tag: "Left", left: "sink failed" });
  });
});
