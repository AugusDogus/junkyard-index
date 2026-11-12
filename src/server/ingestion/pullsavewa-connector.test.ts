import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamPullsavewaInventoryWithRequestGate } from "./pullsavewa-connector";
import { PullsavewaCursor, PullsavewaCursorSchema } from "./pullsavewa-cursor";
import {
  pullsavewaTestHome,
  pullsavewaTestPage,
  pullsavewaTestRow,
} from "./pullsavewa-test-fixtures";
import type { PullsavewaCanonicalVehicle } from "./pullsavewa-transform";
import { PULLSAVEWA_YARDS } from "./pullsavewa-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
const rows = (start: number) =>
  Array.from({ length: 21 }, (_, i) => pullsavewaTestRow(start + i));

function mockSource(
  mead = rows(1),
  spokane = rows(101),
  mutate: (url: string, body: string) => string = (_url, body) => body,
) {
  const bodies = new Map<string, string>();
  for (const yard of PULLSAVEWA_YARDS) {
    const records = yard.code === "mead" ? mead : spokane;
    bodies.set(yard.websiteUrl, pullsavewaTestHome(yard));
    bodies.set(yard.inventoryUrl, pullsavewaTestPage("first", records));
    bodies.set(
      yard.inventoryUrl + "?recperpage=ALL",
      pullsavewaTestPage("all", records),
    );
    bodies.set(
      yard.inventoryUrl + "?start=21",
      pullsavewaTestPage("last", records),
    );
  }
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      const body = bodies.get(url);
      if (body === undefined) throw new Error("Unexpected native URL " + url);
      return new Response(mutate(url, body), {
        headers: { "Content-Type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

test("Pull & Save emits two physically owned catalogs with required fields and rejected presence", async () => {
  const firstRows = rows(1);
  firstRows[0] = pullsavewaTestRow(1, { make: "" });
  const requests = mockSource(firstRows);
  const vehicles: PullsavewaCanonicalVehicle[] = [];
  const yards: string[] = [];
  const result = await Effect.runPromise(
    streamPullsavewaInventoryWithRequestGate(
      {
        maxPages: 2,
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
        onYards: (batch) =>
          Effect.sync(() => {
            yards.push(...batch.map((yard) => yard.code));
          }),
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(41);
  expect(result.accounting).toEqual({
    recordsProcessed: 42,
    recordsExcluded: 0,
    recordsRejected: 1,
    duplicateVehicles: 0,
  });
  expect(result.observedVins).toEqual(["2CNALBEW8A0000001"]);
  expect(vehicles).toHaveLength(41);
  expect(vehicles[0]).toMatchObject({
    source: "pullsavewa",
    make: "Chevrolet",
    imageUrl: null,
    color: null,
    locationCode: "mead",
  });
  expect(yards).toEqual(["mead", "spokane"]);
  expect(requests).toHaveLength(8);
  expect(
    result.warnings?.some((warning) => warning.includes("90% accurate")),
  ).toBe(true);
});

test("Pull & Save serialized resume retains cross-yard identities and retries no failed callbacks", async () => {
  const requests = mockSource();
  const first = await Effect.runPromise(
    streamPullsavewaInventoryWithRequestGate(
      { onBatch: () => Effect.void },
      gate,
    ),
  );
  const cursor = PullsavewaCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  expect(first.status).toBe("paused");
  expect(cursor.phase).toBe("yards");
  await expect(
    Effect.runPromise(
      streamPullsavewaInventoryWithRequestGate(
        {
          startCursor: cursor,
          onBatch: () => Effect.fail(new Error("batch failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("batch failed");
  const last = await Effect.runPromise(
    streamPullsavewaInventoryWithRequestGate(
      { startCursor: cursor, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(last.status).toBe("complete");
  expect(last.count).toBe(21);
  expect(
    requests.filter((url) => url === PULLSAVEWA_YARDS[0].inventoryUrl),
  ).toHaveLength(1);
  expect(PullsavewaCursor.initial.phase).toBe("start");
});

test("Pull & Save blocks duplicate VINs within or across resumed yards before emitting", async () => {
  const duplicate = rows(101);
  duplicate[0] = pullsavewaTestRow(101, { vin: "2CNALBEW8A0000001" });
  mockSource(rows(1), duplicate);
  const first = await Effect.runPromise(
    streamPullsavewaInventoryWithRequestGate(
      { onBatch: () => Effect.void },
      gate,
    ),
  );
  await expect(
    Effect.runPromise(
      streamPullsavewaInventoryWithRequestGate(
        { startCursor: first.cursor, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("Duplicate");
  const within = rows(1);
  within[1] = pullsavewaTestRow(2, { vin: "2CNALBEW8A0000001" });
  mockSource(within);
  await expect(
    Effect.runPromise(
      streamPullsavewaInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("Duplicate");
});

test("Pull & Save retains the per-yard 10% reject limit", async () => {
  const rejected = rows(1);
  for (let i = 0; i < 3; i++)
    rejected[i] = pullsavewaTestRow(i + 1, { make: "" });
  mockSource(rejected);
  let batches = 0;
  await expect(
    Effect.runPromise(
      streamPullsavewaInventoryWithRequestGate(
        {
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("10%");
  expect(batches).toBe(0);
});

test("Pull & Save blocks changed native ownership and narrowed search before ALL requests", async () => {
  for (const mutation of [
    (url: string, body: string) =>
      url === PULLSAVEWA_YARDS[0].websiteUrl
        ? body.replace("11125", "99999")
        : body,
    (url: string, body: string) =>
      url === PULLSAVEWA_YARDS[0].inventoryUrl
        ? body.replace('name="psearch" value=""', 'name="psearch" value="FORD"')
        : body,
    (url: string, body: string) =>
      url === PULLSAVEWA_YARDS[0].inventoryUrl
        ? body.replace("filterList = null", 'filterList = { make: "FORD" }')
        : body,
  ]) {
    const requests = mockSource(rows(1), rows(101), mutation);
    await expect(
      Effect.runPromise(
        streamPullsavewaInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow();
    expect(requests.some((url) => url.includes("recperpage=ALL"))).toBe(false);
  }
});

test("Pull & Save complete checkpoint makes no requests and rejects inconsistent cursors", async () => {
  const requests = mockSource();
  const result = await Effect.runPromise(
    streamPullsavewaInventoryWithRequestGate(
      {
        startCursor: { source: "pullsavewa", phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  expect(result.count).toBe(0);
  expect(requests).toEqual([]);
  expect(
    PullsavewaCursorSchema.safeParse({
      source: "pullsavewa",
      phase: "yards",
      nextYard: 1,
      processed: 2,
      emitted: 1,
      rejected: 0,
      vins: ["2CNALBEW8A0000001"],
    }).success,
  ).toBe(false);
});

test("Pull & Save never retries a denied native response", async () => {
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
      streamPullsavewaInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("403");
  expect(requests).toBe(1);
});
