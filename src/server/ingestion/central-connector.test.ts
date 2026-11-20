import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { ProviderTurnDeferred } from "./provider-chunk-clock";
import { runWithQueuedHost } from "./provider-host-test-support";
import {
  CentralCursor,
  CENTRAL_MAX_CURSOR_BYTES,
  type CentralCursor as Cursor,
} from "./central-cursor";
import {
  streamCentralInventoryWithRequestGate,
  type CentralStreamResult,
} from "./central-connector";
import type { CentralCanonicalVehicle } from "./central-transform";
import {
  centralFixtureDirectory,
  centralFixtureMake,
  centralFixtureModel,
  centralFixtureModelPage,
  centralFixtureRecord,
  centralFixtureRoot,
} from "./central-test-fixtures";
import {
  CENTRAL_MAKES,
  CENTRAL_ORIGIN,
  CENTRAL_ROOT,
} from "./central-yard-metadata";
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const fixture = () => {
  const models = Array.from({ length: 5 }, (_, index) => ({
    ...centralFixtureModel,
    path: centralFixtureModel.path + index,
    label: "ILX" + index,
    count: 1000,
  }));
  const pages = new Map<string, string>([
    [CENTRAL_ROOT, centralFixtureRoot],
    [CENTRAL_MAKES, centralFixtureDirectory([centralFixtureMake], "makes")],
    [
      CENTRAL_ORIGIN + centralFixtureMake.path,
      centralFixtureDirectory(models, "models"),
    ],
  ]);
  models.forEach((model, index) =>
    pages.set(
      CENTRAL_ORIGIN + model.path,
      centralFixtureModelPage(
        Array.from({ length: 1000 }, (_, offset) =>
          centralFixtureRecord(index * 1000 + offset + 1, model.label),
        ),
        centralFixtureMake,
        model,
      ),
    ),
  );
  const requested: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      requested.push(url);
      const body = pages.get(url);
      if (body === undefined)
        throw new Error("Unexpected fixture request " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: original.preconnect },
  );
  return { pages, requested };
};
test("Central serializes every paused prefix and emits the complete source only once", async () => {
  const { requested } = fixture();
  let cursor: Cursor = CentralCursor.initial;
  let vehicles: CentralCanonicalVehicle[] = [];
  let yards = 0;
  while (cursor.phase !== "complete") {
    const result = await Effect.runPromise(
      streamCentralInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 2,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles = batch;
            }),
          onYards: (batch) =>
            Effect.sync(() => {
              yards += batch.length;
            }),
        },
        gate,
      ),
    );
    cursor = CentralCursor.parse(CentralCursor.serialize(result.cursor));
    if (result.status === "paused") {
      expect(result.count).toBe(0);
      expect(result.observedVins).toEqual([]);
      expect(Object.values(result.accounting)).toEqual([0, 0, 0, 0]);
      expect(vehicles).toEqual([]);
    } else {
      expect(result.count).toBe(5000);
      expect(result.accounting.recordsProcessed).toBe(5000);
      expect(result.accounting.recordsRejected).toBe(0);
    }
  }
  expect(vehicles).toHaveLength(5000);
  expect(yards).toBe(1);
  // Opening root, makes, one menu and five models; closing root and makes.
  expect(requested).toHaveLength(10);
  const count = requested.length;
  await Effect.runPromise(
    streamCentralInventoryWithRequestGate(
      {
        startCursor: cursor,
        onBatch: () => Effect.die("terminal replay must not emit"),
      },
      gate,
    ),
  );
  expect(requested).toHaveLength(count);
});
test("Central closing changes and callback failures never return a completed checkpoint", async () => {
  const { pages, requested } = fixture();
  const opening = await Effect.runPromise(
    streamCentralInventoryWithRequestGate(
      { maxPages: 8, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(opening.status).toBe("paused");
  expect(requested).toHaveLength(8);
  pages.set(CENTRAL_ROOT, centralFixtureRoot.replace("DD15", "FOREIGN"));
  await expect(
    Effect.runPromise(
      streamCentralInventoryWithRequestGate(
        { startCursor: opening.cursor, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("supplier");
  fixture();
  await expect(
    Effect.runPromise(
      streamCentralInventoryWithRequestGate(
        {
          startCursor: opening.cursor,
          onBatch: () => Effect.fail(new Error("staging failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("staging failed");
  expect(opening.cursor.phase).toBe("closing");
});
test("Central rejects corrupt or oversized checkpoints before transport", async () => {
  const { requested } = fixture();
  expect(() =>
    CentralCursor.parse(" ".repeat(CENTRAL_MAX_CURSOR_BYTES + 1)),
  ).toThrow("4 MiB");
  const corrupt = { ...CentralCursor.initial, checksum: "0".repeat(64) };
  await expect(
    Effect.runPromise(
      streamCentralInventoryWithRequestGate(
        { startCursor: corrupt, onBatch: () => Effect.void },
        gate,
      ),
    ),
  ).rejects.toThrow("integrity");
  expect(requested).toEqual([]);
}, 60_000);
const queuedChunk = (startCursor: Cursor, turnWaitMs: number) =>
  runWithQueuedHost(
    streamCentralInventoryWithRequestGate(
      { startCursor, maxPages: 8, onBatch: () => Effect.void },
      gate,
    ),
    { turnWaitMs },
  );

test("Central keeps advancing when every request waits minutes for a shared host turn", async () => {
  // Production URG queue on 2026-11-19: about 20 sources shared one lease, so
  // each request waited about two minutes for its turn.
  const { requested } = fixture();
  let cursor: Cursor = CentralCursor.initial;
  const pages: number[] = [];
  let count = 0;
  while (cursor.phase !== "complete") {
    const chunk = await queuedChunk(cursor, 2 * 60_000);
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    const result: CentralStreamResult = chunk.result.right;
    pages.push(result.pagesProcessed);
    count = result.count;
    cursor = result.cursor;
    // Every chunk returns its checkpoint and releases each lease in time.
    expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
  }
  expect(pages).toEqual([2, 2, 2, 2, 2]);
  expect(count).toBe(5000);
  expect(requested).toHaveLength(10);
}, 120_000);

test("a Central chunk started five minutes into its function returns before the function ends", async () => {
  // Workflow starts chunk steps inline up to five minutes into an 800 s
  // function. Four-minute turns must not carry a chunk past the remaining
  // 500 s, less the checkpoint write after it.
  fixture();
  const chunk = await queuedChunk(CentralCursor.initial, 4 * 60_000);
  if (Either.isLeft(chunk.result)) throw chunk.result.left;
  expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
  expect(chunk.result.right.pagesProcessed).toBe(1);
  expect(chunk.result.right.cursor).not.toEqual(CentralCursor.initial);
  expect(chunk.turns).toHaveLength(1);
  expect(chunk.turns[0]?.releasedAt).not.toBeNull();
}, 60_000);

test("a Central chunk without a turn in time is deferred without advancing", async () => {
  const { requested } = fixture();
  const chunk = await queuedChunk(CentralCursor.initial, 7 * 60_000);
  expect(Either.isLeft(chunk.result) && chunk.result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(chunk.elapsedMs).toBeLessThanOrEqual(6 * 60_000);
  expect(chunk.turns).toHaveLength(0);
  expect(chunk.cancelled).toBe(1);
  expect(requested).toEqual([]);
}, 60_000);
