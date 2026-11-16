import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { soakKodakInventory } from "../../../scripts/soak-kodak";
import { fetchKodakPage } from "./kodak-client";
import { streamKodakInventoryWithRequestGate } from "./kodak-connector";
import { KodakCursor } from "./kodak-cursor";
import {
  kodakTestCard,
  kodakTestInventory,
  kodakTestRoot,
} from "./kodak-test-fixtures";
import { KODAK_HOME } from "./kodak-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

const gate: ProviderRequestGate = (request) => request;
const originalFetch = globalThis.fetch;
const nativeInventory = () =>
  kodakTestInventory(
    Array.from({ length: 30 }, (_, i) =>
      kodakTestCard(
        i,
        "2023 NISSAN ALTIMA",
        "1N4BL4DV0PN" + String(i).padStart(6, "0"),
      ),
    ).join(""),
  );
let mockFetch: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => mockFetch?.mockRestore());

function serve(inventory = nativeInventory()) {
  const calls: string[] = [];
  mockFetch = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        return new Response(url === KODAK_HOME ? kodakTestRoot : inventory, {
          headers: { "content-type": "text/html" },
        });
      },
      { preconnect: originalFetch.preconnect },
    ),
  );
  return calls;
}

test("one-unit checkpoint serializes without emitting, then complete roster emits once", async () => {
  const calls = serve();
  const batches: number[] = [];
  const onBatch = (vehicles: readonly unknown[]) =>
    Effect.sync(() => {
      batches.push(vehicles.length);
    });
  const first = await Effect.runPromise(
    streamKodakInventoryWithRequestGate({ maxPages: 1, onBatch }, gate),
  );
  expect(first.status).toBe("paused");
  expect(first.count).toBe(0);
  expect(batches).toEqual([]);
  const cursor = KodakCursor.parse(KodakCursor.serialize(first.cursor));
  const final = await Effect.runPromise(
    streamKodakInventoryWithRequestGate(
      { startCursor: cursor, maxPages: 1, onBatch },
      gate,
    ),
  );
  expect(final.status).toBe("complete");
  expect(final.count).toBe(30);
  expect(final.accounting.recordsProcessed).toBe(30);
  expect(batches).toEqual([30]);
  expect(calls).toEqual([
    "https://kodakauto.co/",
    "https://kodakauto.co/pull-a-part",
  ]);
});

test("serialized count-only soak respects total request budget", async () => {
  const calls = serve();
  const result = await soakKodakInventory((startCursor, maxPages) =>
    Effect.runPromise(
      streamKodakInventoryWithRequestGate(
        { startCursor, maxPages, onBatch: () => Effect.void },
        gate,
      ),
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.pagesProcessed).toBe(2);
  expect(calls).toHaveLength(2);
});

test("quality or shape failures emit neither yard nor vehicle", async () => {
  serve(kodakTestInventory());
  let emitted = 0;
  await expect(
    Effect.runPromise(
      streamKodakInventoryWithRequestGate(
        {
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
          onYards: () =>
            Effect.sync(() => {
              emitted++;
            }),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("12-donor");
  expect(emitted).toBe(0);
});

test.each([
  () =>
    new Response("redirect", {
      status: 301,
      headers: { location: "https://foreign.example" },
    }),
  () => new Response("partial", { status: 206 }),
  () =>
    new Response("body", { headers: { "content-type": "application/json" } }),
  () =>
    new Response("body", {
      headers: { "content-type": "text/html", "content-length": "10" },
    }),
  () =>
    new Response("a".repeat(2 * 1024 * 1024 + 1), {
      headers: { "content-type": "text/html" },
    }),
])(
  "client fails closed without retries for redirects, partial, MIME, length or byte bounds",
  async (response) => {
    mockFetch = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(async () => response(), {
        preconnect: originalFetch.preconnect,
      }),
    );
    await expect(
      Effect.runPromise(fetchKodakPage(KODAK_HOME, gate)),
    ).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  },
);

test("complete cursors are inert and malformed checkpoint evidence is rejected", async () => {
  const calls = serve();
  const complete = KodakCursor.parse(
    '{"source":"kodak","version":1,"phase":"complete"}',
  );
  expect(
    (
      await Effect.runPromise(
        streamKodakInventoryWithRequestGate(
          { startCursor: complete, onBatch: () => Effect.void },
          gate,
        ),
      )
    ).pagesProcessed,
  ).toBe(0);
  expect(calls).toHaveLength(0);
  expect(() =>
    KodakCursor.parse(
      '{"source":"kodak","version":1,"phase":"inventory","ownership":{"inventoryUrl":"https://foreign.example"}}',
    ),
  ).toThrow();
});
