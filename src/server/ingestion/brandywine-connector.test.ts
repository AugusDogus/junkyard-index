import { afterEach, expect, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  streamBrandywineInventoryWithRequestGate,
  streamBrandywineInventory,
  BRANDYWINE_REQUEST_GAP_MS,
} from "./brandywine-connector";
import {
  BRANDYWINE_MAX_CURSOR_BYTES,
  BRANDYWINE_MAX_RUN_MS,
  BrandywineCursor,
  inspectBrandywineCursor,
  BRANDYWINE_MAX_RUN_REQUESTS,
} from "./brandywine-cursor";
import {
  brandywineSavedControls,
  brandywineSavedDetails,
  brandywineNativeFixtures,
} from "./brandywine-test-fixtures";
import { brandywineRedirect } from "./brandywine-html";
import type { BrandywineCanonicalVehicle } from "./brandywine-transform";

const opening = brandywineSavedControls("opening"),
  details = brandywineSavedDetails(),
  closing = brandywineSavedControls("closing");
const terminal = () =>
  BrandywineCursor.checkpoint({
    ...BrandywineCursor.initial(null),
    startedAt: Date.now(),
    phase: "complete",
    opening,
    details,
    closing,
  });
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a static ready cursor starts its clock only at the first logical request", async () => {
  const ready = BrandywineCursor.initial(null);
  expect(ready.phase).toBe("ready");
  expect(ready.startedAt).toBe(null);
  expect(BrandywineCursor.serialize(ready)).toBe(
    BrandywineCursor.serialize(BrandywineCursor.initial(null)),
  );
  const page = brandywineNativeFixtures().pages.find(
    (page) => page.kind === "opening" && page.url === opening[0]?.url,
  );
  if (!page) throw new Error("Missing native root");
  const calls = mockPage(page.html, page.url);
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.adjust("49 hours");
      return yield* streamBrandywineInventoryWithRequestGate(
        {
          startCursor: BrandywineCursor.parse(
            BrandywineCursor.serialize(ready),
          ),
          maxPages: 1,
          onBatch: () => Effect.void,
        },
        gate,
      );
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result.cursor.phase).toBe("opening");
  expect(result.cursor.startedAt).toBe(49 * 60 * 60 * 1000);
  expect(calls()).toBe(1);
});

test("live pacing preserves 1.6-second body completion gaps within and between chunks", async () => {
  const startCursor = BrandywineCursor.checkpoint({
    ...BrandywineCursor.initial(null),
    phase: "opening",
    startedAt: 0,
    opening: opening.slice(0, 2),
  });
  const urls = opening.slice(2, 4).map((control) => control.url);
  const pages = brandywineNativeFixtures().pages.filter(
    (page) => page.kind === "opening" && urls.includes(page.url),
  );
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const target = brandywineRedirect(url);
      if (target)
        return new Response(null, {
          status: 301,
          headers: { "content-type": "text/html", location: target },
        });
      const page = pages.find((page) => brandywineRedirect(page.url) === url);
      if (!page) throw new Error("Unexpected pacing-test URL " + url);
      return new Response(page.html, {
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* streamBrandywineInventory({
        startCursor,
        maxPages: 1,
        onBatch: () => Effect.void,
      }).pipe(
        Effect.flatMap((first) =>
          streamBrandywineInventory({
            startCursor: first.cursor,
            maxPages: 1,
            onBatch: () => Effect.void,
          }),
        ),
        Effect.fork,
      );
      yield* TestClock.adjust("1599 millis");
      expect(calls).toHaveLength(0);
      yield* TestClock.adjust("1 millis");
      expect(calls).toEqual([urls[0] ?? ""]);
      yield* TestClock.adjust("1599 millis");
      expect(calls).toHaveLength(1);
      yield* TestClock.adjust("1 millis");
      expect(calls).toEqual([
        urls[0] ?? "",
        brandywineRedirect(urls[0] ?? "") ?? "",
      ]);
      yield* TestClock.adjust("1600 millis");
      expect(calls).toHaveLength(2);
      yield* TestClock.adjust("1599 millis");
      expect(calls).toHaveLength(2);
      yield* TestClock.adjust("1 millis");
      expect(calls).toHaveLength(3);
      yield* TestClock.adjust("1600 millis");
      expect(calls).toHaveLength(4);
      yield* TestClock.adjust("1600 millis");
      return yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result.status).toBe("paused");
  expect(result.cursor.opening).toHaveLength(4);
});

test("finite lifetime can contain the largest graph at full per-control deadlines", () => {
  const logical = BRANDYWINE_MAX_RUN_REQUESTS / 2;
  const activeAndChunkStart = logical * (25_000 + BRANDYWINE_REQUEST_GAP_MS);
  expect(logical).toBe(4160);
  expect(activeAndChunkStart).toBe(110656000);
  expect(BRANDYWINE_MAX_RUN_MS - activeAndChunkStart).toBe(62144000);
});

test("whole-run byte exhaustion fails before any inventory emission", () => {
  const oversized = structuredClone(terminal());
  for (const observation of [
    ...oversized.opening,
    ...oversized.details,
    ...oversized.closing,
  ]) {
    observation.body.bytes = 500 * 1024;
    const last = observation.receipt.wires.at(-1);
    if (!last) throw new Error("Missing final native wire");
    last.body.bytes = 500 * 1024;
  }
  expect(() => BrandywineCursor.checkpoint(oversized)).toThrow(
    "whole-run request or byte cap",
  );
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockPage(html: string, logicalUrl: string) {
  let requests = 0;
  const target = brandywineRedirect(logicalUrl);
  globalThis.fetch = Object.assign(
    async (input: unknown) => {
      requests++;
      if (String(input) === logicalUrl && target)
        return new Response("Moved", {
          status: 301,
          headers: { "content-type": "text/html", location: target },
        });
      if (String(input) !== (target ?? logicalUrl))
        throw new Error("Unexpected request URL " + String(input));
      return new Response(html, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => requests;
}

test("a durable terminal cursor round-trips the complete graph and canonical snapshot", () => {
  const cursor = terminal();
  const parsed = BrandywineCursor.parse(BrandywineCursor.serialize(cursor));
  const result = inspectBrandywineCursor(parsed);
  expect(parsed.phase).toBe("complete");
  expect(
    isDurableSourceCursorTerminal(
      "brandywine",
      serializeDurableSourceCursor(cursor),
    ),
  ).toBe(true);
  expect(result.vehicles).toHaveLength(1807);
  expect(result.accounting).toEqual({
    recordsProcessed: 2027,
    recordsExcluded: 209,
    recordsRejected: 11,
    duplicateVehicles: 0,
  });
});

test("opening and detail continuation checkpoints emit no partial vehicles or presence", async () => {
  const root = brandywineNativeFixtures().pages.find(
    (page) => page.kind === "opening" && page.url === opening[0]?.url,
  );
  if (!root) throw new Error("Missing native root");
  mockPage(root.html, root.url);
  const batches: BrandywineCanonicalVehicle[][] = [];
  const onBatch = (vehicles: BrandywineCanonicalVehicle[]) =>
    Effect.sync(() => {
      batches.push(vehicles);
    });
  const first = await Effect.runPromise(
    streamBrandywineInventoryWithRequestGate(
      { previousAcceptedCount: null, maxPages: 1, onBatch },
      gate,
    ),
  );
  expect(first.status).toBe("paused");
  expect(first.cursor.opening).toHaveLength(1);
  expect(first.observedVins).toEqual([]);
  expect(batches).toEqual([]);
  const detail = details.at(-1);
  if (!detail) throw new Error("Missing final native detail");
  const fixture = brandywineNativeFixtures().pages.find(
    (page) => page.kind === "detail" && page.url === detail.url,
  );
  if (!fixture) throw new Error("Missing native detail fixture");
  const startCursor = BrandywineCursor.checkpoint({
    ...BrandywineCursor.initial(null),
    startedAt: Date.now(),
    phase: "details",
    opening,
    details: details.slice(0, -1),
    closing: [],
  });
  mockPage(fixture.html, fixture.url);
  const continued = await Effect.runPromise(
    streamBrandywineInventoryWithRequestGate(
      {
        startCursor: BrandywineCursor.parse(
          BrandywineCursor.serialize(startCursor),
        ),
        maxPages: 1,
        onBatch,
      },
      gate,
    ),
  );
  expect(continued.cursor.phase).toBe("closing");
  expect(continued.cursor.details).toHaveLength(2027);
  expect(continued.count).toBe(0);
  expect(continued.observedVins).toEqual([]);
  expect(batches).toEqual([]);
});

test("only the final validated closing control emits, terminal re-entry emits nothing", async () => {
  const cursor = terminal();
  const startCursor = BrandywineCursor.checkpoint({
    ...cursor,
    phase: "closing",
    closing: closing.slice(0, -1),
  });
  const page = brandywineNativeFixtures().pages.find(
    (page) => page.kind === "closing" && page.url === closing.at(-1)?.url,
  );
  if (!page) throw new Error("Missing final closing control");
  const requests = mockPage(page.html, page.url);
  const batches: BrandywineCanonicalVehicle[][] = [];
  let yards = 0;
  const onBatch = (vehicles: BrandywineCanonicalVehicle[]) =>
    Effect.sync(() => {
      batches.push(vehicles);
    });
  const result = await Effect.runPromise(
    streamBrandywineInventoryWithRequestGate(
      {
        startCursor,
        maxPages: 1,
        onBatch,
        onYards: (values) =>
          Effect.sync(() => {
            yards += values.length;
          }),
      },
      gate,
    ),
  );
  expect(result.status).toBe("complete");
  expect(result.cursor.phase).toBe("complete");
  expect(result.count).toBe(1807);
  expect(result.observedVins).toHaveLength(1816);
  expect(batches).toHaveLength(1);
  expect(yards).toBe(1);
  const before = requests();
  const reentered = await Effect.runPromise(
    streamBrandywineInventoryWithRequestGate(
      { startCursor: result.cursor, maxPages: 1, onBatch },
      gate,
    ),
  );
  expect(reentered.status).toBe("complete");
  expect(reentered.count).toBe(0);
  expect(requests()).toBe(before);
  expect(batches).toHaveLength(1);
});

test("failed native controls and changed closing membership preserve the prior checkpoint", async () => {
  const startCursor = BrandywineCursor.checkpoint({
    ...terminal(),
    phase: "closing",
    closing: [],
  });
  const before = BrandywineCursor.serialize(startCursor);
  let emitted = 0;
  const onBatch = () =>
    Effect.sync(() => {
      emitted++;
    });
  globalThis.fetch = Object.assign(
    async () =>
      new Response("Denied", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(
      streamBrandywineInventoryWithRequestGate(
        { startCursor, maxPages: 1, onBatch },
        gate,
      ),
    ),
  ).rejects.toThrow("Prior inventory is preserved");
  expect(BrandywineCursor.serialize(startCursor)).toBe(before);
  const next = BrandywineCursor.checkpoint({
    ...startCursor,
    closing: closing.slice(0, 1),
  });
  const page = brandywineNativeFixtures().pages.find(
    (page) => page.kind === "closing" && page.url === closing[1]?.url,
  );
  if (!page) throw new Error("Missing closing manufacturers");
  mockPage(
    page.html
      .replaceAll("modelinput=ACURA", "modelinput=OTHER")
      .replaceAll(">ACURA<", ">OTHER<"),
    page.url,
  );
  await expect(
    Effect.runPromise(
      streamBrandywineInventoryWithRequestGate(
        { startCursor: next, maxPages: 1, onBatch },
        gate,
      ),
    ),
  ).rejects.toThrow("closing membership");
  expect(emitted).toBe(0);
});

test("corrupt, reordered, oversized and expired checkpoints cannot reach the request gate", async () => {
  const cursor = terminal();
  expect(() =>
    BrandywineCursor.parse(
      JSON.stringify({ ...cursor, previousAcceptedCount: 1 }),
    ),
  ).toThrow("checksum");
  expect(() =>
    BrandywineCursor.checkpoint({ ...cursor, details: [...details].reverse() }),
  ).toThrow("ordering");
  expect(() =>
    BrandywineCursor.checkpoint({ ...cursor, closing: closing.slice(0, -1) }),
  ).toThrow("contiguous complete");
  expect(() =>
    BrandywineCursor.parse(" ".repeat(BRANDYWINE_MAX_CURSOR_BYTES + 1)),
  ).toThrow("16 MiB");
  let gated = 0;
  const guarded = <A, E, R>(request: Effect.Effect<A, E, R>) => {
    gated++;
    return request;
  };
  const expired = BrandywineCursor.checkpoint({
    ...BrandywineCursor.initial(null),
    phase: "opening",
    startedAt: Date.now() - BRANDYWINE_MAX_RUN_MS - 1,
  });
  await expect(
    Effect.runPromise(
      streamBrandywineInventoryWithRequestGate(
        { startCursor: expired, onBatch: () => Effect.void },
        guarded,
      ),
    ),
  ).rejects.toThrow("48-hour");
  expect(gated).toBe(0);
});
