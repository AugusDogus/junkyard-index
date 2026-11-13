import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  CentralCursor,
  CENTRAL_MAX_CURSOR_BYTES,
  type CentralCursor as Cursor,
} from "./central-cursor";
import { streamCentralInventoryWithRequestGate } from "./central-connector";
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
  expect(requested).toHaveLength(13);
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
  ).toThrow("2 MiB");
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
});
