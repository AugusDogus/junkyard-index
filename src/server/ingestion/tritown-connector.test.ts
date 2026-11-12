import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamTritownInventoryWithRequestGate } from "./tritown-connector";
import { TritownCursor, TritownCursorSchema } from "./tritown-cursor";
import type { TritownCanonicalVehicle } from "./tritown-transform";
import {
  tritownTestCard,
  tritownTestContext,
  tritownTestPage,
} from "./tritown-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;

function mockSource(
  pages: ReadonlyMap<number, string>,
  context = tritownTestContext,
) {
  const requested: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      expect(url.origin).toBe("https://tritownautosalvage.com");
      requested.push(url.pathname + url.search);
      if (url.pathname === "/cars/")
        return new Response(context, {
          headers: { "Content-Type": "text/html" },
        });
      expect(url.searchParams.get("wpcm-ajax")).toBe("get_vehicle_results");
      expect(url.searchParams.get("sort")).toBe("power_kw-asc");
      const body = pages.get(Number(url.searchParams.get("page")));
      if (body === undefined) throw new Error("Unexpected TriTown page " + url);
      return new Response(body, {
        headers: { "Content-Type": "application/json" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requested;
}

test("TriTown emits required donor identity when every optional field is absent", async () => {
  mockSource(
    new Map([
      [1, tritownTestPage(1, 1, [tritownTestCard(1, { position: "" })])],
    ]),
    tritownTestContext.replace(
      "Please note that pictures of vehicles are taken at the time the car is set in the yard.",
      "",
    ),
  );
  const vehicles: TritownCanonicalVehicle[] = [];
  const result = await Effect.runPromise(
    streamTritownInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => vehicles.push(...batch)).pipe(Effect.asVoid),
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(vehicles).toHaveLength(1);
  expect(vehicles[0]).toMatchObject({
    vin: "2CNALBEW8A0000001",
    make: "Chevrolet",
    year: 2010,
    model: "Equinox",
    stockNumber: null,
    color: null,
    imageUrl: null,
    availableDate: null,
    row: null,
    locationCode: "mount-joy",
  });
});

test("TriTown preserves valid VIN presence for rejected YMM and rejects malformed modern VINs", async () => {
  mockSource(
    new Map([
      [1, tritownTestPage(1, 2)],
      [
        2,
        tritownTestPage(
          2,
          2,
          Array.from({ length: 5 }, (_, index) =>
            tritownTestCard(
              index + 6,
              index === 0 ? { title: "2010 Unknown" } : {},
            ),
          ),
        ),
      ],
    ]),
  );
  const result = await Effect.runPromise(
    streamTritownInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result.count).toBe(9);
  expect(result.observedVins).toEqual(["2CNALBEW8A0000006"]);
  expect(result.accounting?.recordsRejected).toBe(1);
  mockSource(
    new Map([
      [1, tritownTestPage(1, 1, [tritownTestCard(1, { vin: "INVALID" })])],
    ]),
  );
  await expect(
    Effect.runPromise(
      streamTritownInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("10%");
});

test("TriTown rejects ignored pages and changed pagination before advancing", async () => {
  for (const second of [tritownTestPage(1, 2), tritownTestPage(2, 3)]) {
    mockSource(
      new Map([
        [1, tritownTestPage(1, 2)],
        [2, second],
      ]),
    );
    await expect(
      Effect.runPromise(
        streamTritownInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("pagination");
  }
});

test("TriTown resumes a serialized cursor and never returns a cursor past a failed callback", async () => {
  const requested = mockSource(
    new Map([
      [1, tritownTestPage(1, 2)],
      [2, tritownTestPage(2, 2)],
    ]),
  );
  const first = await Effect.runPromise(
    streamTritownInventoryWithRequestGate(
      { maxPages: 1, onBatch: () => Effect.void },
      gate,
    ),
  );
  const cursor = TritownCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  expect(cursor.phase).toBe("pages");
  await expect(
    Effect.runPromise(
      streamTritownInventoryWithRequestGate(
        {
          startCursor: cursor,
          onBatch: () => Effect.fail(new Error("batch failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("batch failed");
  const resumed = await Effect.runPromise(
    streamTritownInventoryWithRequestGate(
      { startCursor: cursor, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(resumed.status).toBe("complete");
  expect(resumed.count).toBe(5);
  expect(requested.filter((url) => url.includes("page=1&"))).toHaveLength(1);
  expect(TritownCursor.initial.phase).toBe("start");
});

test("TriTown rejects changed yard ownership before requesting donors", async () => {
  const requested = mockSource(
    new Map(),
    tritownTestContext.replace("865 Milton Grove Rd", "other yard"),
  );
  await expect(
    Effect.runPromise(
      streamTritownInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("ownership");
  expect(requested).toEqual(["/cars/"]);
});

test("TriTown rejects reused VINs across distinct pages even after serialized resume", async () => {
  mockSource(
    new Map([
      [1, tritownTestPage(1, 2)],
      [
        2,
        tritownTestPage(2, 2, [
          tritownTestCard(6, { vin: "2CNALBEW8A0000001" }),
        ]),
      ],
    ]),
  );
  const first = await Effect.runPromise(
    streamTritownInventoryWithRequestGate(
      {
        maxPages: 1,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const cursor = TritownCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  await expect(
    Effect.runPromise(
      streamTritownInventoryWithRequestGate(
        {
          startCursor: cursor,
          onBatch: () => Effect.void,
        },
        gate,
      ),
    ),
  ).rejects.toThrow("reuse");
});

test("TriTown terminal cursor makes no requests", async () => {
  const requests = mockSource(new Map());
  const result = await Effect.runPromise(
    streamTritownInventoryWithRequestGate(
      {
        startCursor: { source: "tritown", phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(requests).toEqual([]);
});

test("TriTown does not retry a denied source response", async () => {
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response("Forbidden", {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(
      streamTritownInventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
        },
        gate,
      ),
    ),
  ).rejects.toThrow("403");
  expect(requests).toBe(1);
});
