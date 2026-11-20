import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamMichigantruckInventoryWithRequestGate } from "./michigantruck-connector";
import { getDurableSourceDefinition } from "./durable-source";
import { soakMichigantruckInventory } from "../../../scripts/soak-michigantruck";
import { MichigantruckCursorSchema } from "./michigantruck-cursor";
import {
  michigantruckTestDetail,
  michigantruckTestOwnership,
  michigantruckTestPage,
  michigantruckTestRecord,
} from "./michigantruck-test-fixtures";
import {
  MICHIGANTRUCK_CATALOG,
  MICHIGANTRUCK_ORIGIN,
  MICHIGANTRUCK_SALVAGE,
} from "./michigantruck-yard-metadata";
import type { MichigantruckRecord } from "./michigantruck-record";
import { MICHIGANTRUCK_MAX_PAGES } from "./michigantruck-parser";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
const records = () =>
  Array.from({ length: 50 }, (_, index) =>
    michigantruckTestRecord(
      index + 1,
      index === 49 ? { condition: "Complete" } : {},
    ),
  );
function mockSource(
  rows: readonly MichigantruckRecord[] = records(),
  mutate: (url: string, body: string, request: number) => string = (
    _url,
    body,
  ) => body,
) {
  const calls: string[] = [];
  const bodies = new Map<string, string>([
    [
      MICHIGANTRUCK_ORIGIN + "/contact/",
      `<html><body>${michigantruckTestOwnership}</body></html>`,
    ],
    [MICHIGANTRUCK_CATALOG, michigantruckTestPage(rows, 1)],
    ...Array.from(
      { length: Math.ceil(rows.length / 25) - 1 },
      (_, index): [string, string] => [
        MICHIGANTRUCK_CATALOG + "?page_number=" + (index + 2),
        michigantruckTestPage(rows, index + 2),
      ],
    ),
    [MICHIGANTRUCK_SALVAGE, michigantruckTestPage(rows, 1, true)],
  ]);
  const control = rows.find((row) => row.condition === "Salvage");
  if (control) bodies.set(control.detailsUrl, michigantruckTestDetail(control));
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      const body = bodies.get(url);
      if (body === undefined)
        throw new Error("Unexpected native request " + url);
      return new Response(
        mutate(url, body, calls.filter((call) => call === url).length),
        { headers: { "content-type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return { calls, bodies };
}

test("Michigan Truck completes actual Next traversal with native controls and separate retail/reject accounting", async () => {
  const rows = records();
  rows[29] = michigantruckTestRecord(30, { model: "Other" });
  const mocked = mockSource(rows);
  let emitted = 0,
    yards = 0;
  const result = await Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      {
        maxPages: 2,
        onBatch: (batch) =>
          Effect.sync(() => {
            emitted += batch.length;
          }),
        onYards: () =>
          Effect.sync(() => {
            yards++;
          }),
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.count).toBe(48);
  expect(emitted).toBe(48);
  expect(yards).toBe(1);
  expect(result.accounting).toEqual({
    recordsProcessed: 50,
    recordsExcluded: 1,
    recordsRejected: 1,
    duplicateVehicles: 0,
  });
  expect(result.observedVins).toEqual(["1FVACXDT6B0000030"]);
  expect(mocked.calls).toHaveLength(7);
});

test("Michigan Truck serializes resume and rebuilds the retained prefix before continuation", async () => {
  const mocked = mockSource();
  const first = await Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      { onBatch: () => Effect.void },
      gate,
    ),
  );
  const cursor = MichigantruckCursorSchema.parse(
    JSON.parse(JSON.stringify(first.cursor)),
  );
  expect(first.status).toBe("paused");
  const last = await Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      { startCursor: cursor, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(last.status).toBe("complete");
  expect(first.count + last.count).toBe(49);
  expect(
    mocked.calls.filter((url) => url === MICHIGANTRUCK_CATALOG),
  ).toHaveLength(3);
  const priorCalls = mocked.calls.length;
  const empty = await Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      { startCursor: last.cursor, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(empty.count).toBe(0);
  expect(mocked.calls).toHaveLength(priorCalls);
});

test("Michigan Truck rejects forged cursors and native payload drift before resumed writes", async () => {
  const mocked = mockSource();
  const first = await Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      { onBatch: () => Effect.void },
      gate,
    ),
  );
  if (first.cursor.phase !== "pages")
    throw new Error("Expected page checkpoint");
  expect(
    MichigantruckCursorSchema.safeParse({
      ...first.cursor,
      emitted: first.cursor.emitted + 1,
    }).success,
  ).toBe(false);
  const forged = {
    ...first.cursor,
    seen: first.cursor.seen.map((row, index) =>
      index === 0 && row.status === "available"
        ? { ...row, identity: "a".repeat(64) }
        : row,
    ),
  };
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        {
          startCursor: forged,
          onBatch: () => Effect.fail(new Error("must not emit")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("rebuilt native prefix");
  const body = mocked.bodies.get(MICHIGANTRUCK_CATALOG);
  if (!body) throw new Error("Missing fixture");
  mocked.bodies.set(
    MICHIGANTRUCK_CATALOG,
    body.replace("photo-1.webp", "photo-changed.webp"),
  );
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        {
          startCursor: first.cursor,
          onBatch: () => Effect.fail(new Error("must not emit")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("payload changed");
});

test("Michigan Truck blocks final full-traversal drift before terminal callback", async () => {
  mockSource(records(), (url, body, request) =>
    url === MICHIGANTRUCK_CATALOG && request > 1
      ? body.replace("photo-1.webp", "photo-changed.webp")
      : body,
  );
  let batches = 0;
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        {
          maxPages: 2,
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("previously consumed");
  expect(batches).toBe(1);
});

test("Michigan Truck keeps cumulative rejection quality across checkpoints and detects conflicting identities", async () => {
  const bad = records();
  for (let i = 0; i < 6; i++)
    bad[i + 1] = michigantruckTestRecord(i + 2, { model: "Other" });
  mockSource(bad);
  const first = await Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      { onBatch: () => Effect.void },
      gate,
    ),
  );
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        { startCursor: first.cursor, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("10%");
  const conflicting = records();
  conflicting[29] = michigantruckTestRecord(30, {
    vin: "1FVACXDT6B0000001",
    model: "OTHER MODEL",
  });
  mockSource(conflicting);
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        { maxPages: 2, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("conflicting");
});

test("Michigan Truck callback failures return no advanced checkpoint or later writes", async () => {
  const mocked = mockSource();
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        { maxPages: 2, onBatch: () => Effect.fail(new Error("batch failed")) },
        gate,
      ),
    ),
  ).rejects.toThrow("batch failed");
  expect(mocked.calls.some((url) => url.includes("page_number=2"))).toBe(false);
  mockSource();
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        {
          maxPages: 2,
          onBatch: () => Effect.void,
          onYards: () => Effect.fail(new Error("yard failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("yard failed");
});

test("Michigan Truck invalid budgets make no requests and HTTP denial is never retried", async () => {
  const mocked = mockSource();
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        { maxPages: 0, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow(`1-${MICHIGANTRUCK_MAX_PAGES}`);
  expect(mocked.calls).toEqual([]);
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      return new Response("Forbidden", { status: 403 });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(
      streamMichigantruckInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("403");
  expect(calls).toBe(1);
});

const fleet = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    michigantruckTestRecord(
      index + 1,
      index % 50 === 49 ? { condition: "Complete" } : {},
    ),
  );
const chunk = (
  maxPages: number,
  startCursor?: Parameters<
    typeof streamMichigantruckInventoryWithRequestGate
  >[0]["startCursor"],
) =>
  Effect.runPromise(
    streamMichigantruckInventoryWithRequestGate(
      { startCursor, maxPages, onBatch: () => Effect.void },
      gate,
    ),
  );

test("Michigan Truck reads today's 195-row census in one production chunk", async () => {
  const { maxPagesPerChunk } = getDurableSourceDefinition("michigantruck");
  const mocked = mockSource(fleet(195));
  const result = await chunk(maxPagesPerChunk);
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(8);
  expect(result.accounting?.recordsProcessed).toBe(195);
  // Contact, 8 new pages, the 8-page terminal reread, detail and selector.
  expect(mocked.calls).toHaveLength(19);
});

test("Michigan Truck pages past 200 rows instead of failing its census bound", async () => {
  const mocked = mockSource(fleet(201));
  const first = await chunk(8);
  expect(first.status).toBe("paused");
  const last = await chunk(8, first.cursor);
  expect(last.status).toBe("complete");
  expect(
    (first.accounting?.recordsProcessed ?? 0) +
      (last.accounting?.recordsProcessed ?? 0),
  ).toBe(201);
  expect(mocked.calls).toContain(MICHIGANTRUCK_CATALOG + "?page_number=9");
});

test("Michigan Truck completes a 400-row census within its chunk request budget and refuses 401", async () => {
  mockSource(fleet(400));
  const first = await chunk(8);
  const last = await chunk(8, first.cursor);
  expect(last.status).toBe("complete");
  mockSource(fleet(401));
  await expect(chunk(8)).rejects.toThrow("exceeded its budget");
});

test("Michigan Truck soak finishes a census past 200 rows by default", async () => {
  mockSource(fleet(201));
  const summary = await soakMichigantruckInventory((cursor, maxPages) =>
    chunk(maxPages, cursor),
  );
  expect(summary.status).toBe("complete");
  expect(summary.pagesProcessed).toBe(9);
});
