import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { soakMccauleyInventory } from "../../../scripts/soak-mccauley";
import {
  streamMccauleyInventory,
  streamMccauleyInventoryWithRequestGate,
  type MccauleyStreamResult,
} from "./mccauley-connector";
import { MccauleyCursor, MccauleyCursorSchema } from "./mccauley-cursor";
import type { MccauleyCanonicalVehicle } from "./mccauley-record";
import {
  mccauleyCatalogHtml,
  mccauleyCurrentHtml,
  mccauleyDetailHtml,
  mccauleyNativeDetails,
} from "./mccauley-test-fixtures";
import {
  MCCAULEY_CURRENT,
  MCCAULEY_INDEX,
  MCCAULEY_YARD,
} from "./mccauley-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

function savedFetch(
  change?: (url: string, occurrence: number, body: string) => Response,
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(init?.redirect).toBe("manual");
      requests.push(url);
      const detail = mccauleyNativeDetails.find((item) => item.url === url);
      const body =
        url === MCCAULEY_INDEX
          ? mccauleyCatalogHtml()
          : url === MCCAULEY_CURRENT
            ? mccauleyCurrentHtml()
            : detail
              ? mccauleyDetailHtml(detail)
              : null;
      if (body === null) throw new Error("Unexpected mock request " + url);
      return (
        change?.(url, requests.filter((value) => value === url).length, body) ??
        new Response(body, { headers: { "content-type": "text/html" } })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

describe("McCauley bounded connector", () => {
  for (const cap of [1, 8, 24])
    test(`finishes a JSON-roundtripped census with ${cap}-request chunks and final-only emission`, async () => {
      const requests = savedFetch();
      const vehicles: MccauleyCanonicalVehicle[] = [];
      let cursor: MccauleyCursor = MccauleyCursor.initial;
      let callbacks = 0;
      let chunks = 0;
      while (cursor.phase !== "complete") {
        const result: MccauleyStreamResult = await Effect.runPromise(
          streamMccauleyInventoryWithRequestGate(
            {
              startCursor: MccauleyCursorSchema.parse(
                JSON.parse(JSON.stringify(cursor)),
              ),
              maxPages: cap,
              onBatch: (batch) =>
                Effect.sync(() => {
                  callbacks++;
                  expect(requests).toHaveLength(24);
                  vehicles.push(...batch);
                }),
            },
            gate,
          ),
        );
        chunks++;
        expect(result.pagesProcessed).toBeLessThanOrEqual(cap);
        cursor = result.cursor;
        if (result.status === "paused") {
          expect(callbacks).toBe(0);
          expect(result.count).toBe(0);
          expect(result.accounting).toEqual({
            recordsProcessed: 0,
            recordsExcluded: 0,
            recordsRejected: 0,
            duplicateVehicles: 0,
          });
        } else {
          expect(result.count).toBe(24);
          expect(result.accounting).toEqual({
            recordsProcessed: 27,
            recordsExcluded: 0,
            recordsRejected: 1,
            duplicateVehicles: 2,
          });
        }
      }
      expect(chunks).toBe(24 / cap);
      expect(callbacks).toBe(1);
      expect(vehicles).toHaveLength(24);
      const terminal = await Effect.runPromise(
        streamMccauleyInventoryWithRequestGate(
          {
            startCursor: cursor,
            onBatch: () => Effect.die("duplicate batch"),
            onYards: () => Effect.die("duplicate yard"),
          },
          gate,
        ),
      );
      expect(requests).toHaveLength(24);
      expect(terminal.pagesProcessed).toBe(0);
      expect(terminal.count).toBe(0);
    });

  test("consumer mutation preserves accounting and yard metadata; failure returns no advanced checkpoint", async () => {
    savedFetch();
    const result = await Effect.runPromise(
      streamMccauleyInventoryWithRequestGate(
        {
          maxPages: 24,
          onYards: (yards) =>
            Effect.sync(() => {
              const yard = yards.at(0);
              if (yard) Reflect.set(yard, "name", "changed");
              yards.splice(0);
            }),
          onBatch: (batch) =>
            Effect.sync(() => {
              batch.splice(0);
            }),
        },
        gate,
      ),
    );
    expect(result.count).toBe(24);
    expect(result.accounting?.recordsProcessed).toBe(27);
    expect(MCCAULEY_YARD.name).toBe("McCauley's Auto LLC");
    await expect(
      Effect.runPromise(
        streamMccauleyInventoryWithRequestGate(
          { maxPages: 24, onBatch: () => Effect.fail("consumer failure") },
          gate,
        ),
      ),
    ).rejects.toThrow("consumer failure");
  });

  test("rejects both closing list drifts before callbacks", async () => {
    for (const control of [MCCAULEY_INDEX, MCCAULEY_CURRENT]) {
      const requests = savedFetch(
        (url, occurrence, body) =>
          new Response(
            url === control && occurrence === 2
              ? body.replace(
                  control === MCCAULEY_INDEX ? "2003 MDX" : "2003 Acura MDX",
                  "2004 Acura MDX",
                )
              : body,
            { headers: { "content-type": "text/html" } },
          ),
      );
      await expect(
        Effect.runPromise(
          streamMccauleyInventoryWithRequestGate(
            { maxPages: 24, onBatch: () => Effect.die("early callback") },
            gate,
          ),
        ),
      ).rejects.toThrow("changed during traversal");
      expect(requests.length).toBe(control === MCCAULEY_INDEX ? 23 : 24);
    }
  });

  test("rejects redirect, transient HTTP, MIME, truncation and oversized documents without retries", async () => {
    for (const response of [
      () =>
        new Response("", {
          status: 302,
          headers: { location: MCCAULEY_CURRENT },
        }),
      () => new Response("", { status: 503 }),
      () =>
        new Response("{}", { headers: { "content-type": "application/json" } }),
      () =>
        new Response("<html>partial", {
          headers: { "content-type": "text/html" },
        }),
      () =>
        new Response("x".repeat(2 * 1024 * 1024 + 1), {
          headers: { "content-type": "text/html" },
        }),
    ]) {
      const requests = savedFetch(() => response());
      await expect(
        Effect.runPromise(
          streamMccauleyInventoryWithRequestGate(
            { maxPages: 24, onBatch: () => Effect.die("early callback") },
            gate,
          ),
        ),
      ).rejects.toThrow("previous inventory is preserved");
      expect(requests).toHaveLength(1);
    }
  });

  test("validates budget and corrupted checkpoints before requesting", async () => {
    const requests = savedFetch();
    for (const maxPages of [0, 25, 1.5])
      await expect(
        Effect.runPromise(
          streamMccauleyInventoryWithRequestGate(
            { maxPages, onBatch: () => Effect.void },
            gate,
          ),
        ),
      ).rejects.toThrow("1-24");
    expect(requests).toHaveLength(0);
  });

  test("count/discard soak retains native accounting across durable chunks", async () => {
    savedFetch();
    const summary = await soakMccauleyInventory(
      (cursor, maxPages) =>
        Effect.runPromise(
          streamMccauleyInventoryWithRequestGate(
            { startCursor: cursor, maxPages, onBatch: () => Effect.void },
            gate,
          ),
        ),
      24,
      8,
    );
    expect(summary.status).toBe("complete");
    expect(summary.pagesProcessed).toBe(24);
    expect(summary.count).toBe(24);
    expect(summary.accounting?.recordsProcessed).toBe(27);
  });

  test("default wrapper pads serialized chunk boundaries after success and failure", async () => {
    const times: number[] = [];
    savedFetch((_url, _occurrence, body) => {
      times.push(Date.now());
      return new Response(body, {
        status: times.length === 2 ? 503 : 200,
        headers: { "content-type": "text/html" },
      });
    });
    const run = () =>
      Effect.runPromise(
        streamMccauleyInventory({ maxPages: 1, onBatch: () => Effect.void }),
      );
    await run();
    await expect(run()).rejects.toThrow("503");
    await run();
    for (let index = 1; index < times.length; index++) {
      const current = times[index];
      const previous = times[index - 1];
      if (current === undefined || previous === undefined)
        throw new Error("Missing observed request timestamp");
      expect(current - previous).toBeGreaterThanOrEqual(1500);
    }
  }, 10_000);
});
