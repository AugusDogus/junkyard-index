import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { streamSpeedysInventoryWithRequestGate } from "./speedys-connector";
import { SpeedysCursor } from "./speedys-cursor";
import type { ProviderRequestGate } from "./provider-http-client";
import { speedysSaved } from "./speedys-test-fixtures";
import { SPEEDYS_ALL, SPEEDYS_CATALOG } from "./speedys-yard-metadata";
import type { SpeedysCanonicalVehicle } from "./speedys-transform";

const category = SPEEDYS_CATALOG + "?cat=478&pag=0";
const detail = "https://parts.speedysgroup.com/car/?car=1";
const sequence = [
  SPEEDYS_CATALOG,
  SPEEDYS_ALL,
  category,
  detail,
  SPEEDYS_CATALOG,
  SPEEDYS_ALL,
  category,
  detail,
];
const gate: ProviderRequestGate = (effect) => effect;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function nativeFetch(
  change: (raw: string, index: number) => string = (raw) => raw,
  headerOverrides: Record<string, string> = {},
) {
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const index = calls.length;
      calls.push(url);
      const expected = sequence[index];
      if (url !== expected)
        throw new Error(
          `Unexpected saved request ${url}, expected ${expected}`,
        );
      const raw =
        url === detail
          ? index < 4
            ? speedysSaved.detail
            : speedysSaved.closingDetail
          : url === SPEEDYS_ALL
            ? index < 4
              ? speedysSaved.all
              : speedysSaved.closingAll
            : url === category
              ? speedysSaved.nissan
              : speedysSaved.default;
      return new Response(change(raw, index), {
        status: 200,
        headers: {
          "content-type": "text/html; charset=UTF-8",
          ...headerOverrides,
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return calls;
}
describe("Speedys saved-response stream", () => {
  test("closes default, ALL, every category and donor before emitting", async () => {
    const calls = nativeFetch();
    const batches: SpeedysCanonicalVehicle[][] = [];
    const result = await Effect.runPromise(
      streamSpeedysInventoryWithRequestGate(
        {
          onBatch: (vehicles) =>
            Effect.sync(() => {
              expect(calls.length).toBe(8);
              batches.push(vehicles);
            }),
        },
        gate,
      ),
    );
    expect(calls).toEqual(sequence);
    expect(result.status).toBe("complete");
    expect(result.count).toBe(1);
    expect(result.accounting).toEqual({
      recordsProcessed: 1,
      recordsExcluded: 0,
      recordsRejected: 0,
      duplicateVehicles: 0,
    });
    expect(batches[0]?.[0]?.imageUrl).toBeNull();
    expect(batches[0]?.[0]?.stockNumber).toBe("1");
  });
  test("resumes each serialized native prefix and emits once at closure", async () => {
    nativeFetch();
    let cursor = SpeedysCursor.initial;
    let emitted = 0;
    for (let index = 0; index < 8; index++) {
      const result = await Effect.runPromise(
        streamSpeedysInventoryWithRequestGate(
          {
            startCursor: cursor,
            maxPages: 1,
            onBatch: (vehicles) =>
              Effect.sync(() => {
                emitted += vehicles.length;
              }),
          },
          gate,
        ),
      );
      cursor = SpeedysCursor.parse(SpeedysCursor.serialize(result.cursor));
      expect(result.status).toBe(index < 7 ? "paused" : "complete");
      expect(emitted).toBe(index < 7 ? 0 : 1);
    }
    expect(cursor.phase).toBe("complete");
  });
  test.each([
    [
      "unsupported pager",
      (raw: string, i: number) =>
        i === 0
          ? raw.replace(
              '<ul class="pagination justify-content-end">',
              '<ul class="pagination justify-content-end"><a href="?cat=0&pag=1">next</a>',
            )
          : raw,
      1,
    ],
    [
      "category count drift",
      (raw: string, i: number) =>
        i === 2 ? raw.replace("NISSAN (1)", "NISSAN (2)") : raw,
      3,
    ],
    [
      "malformed required identity",
      (raw: string, i: number) =>
        i === 3 ? raw.replace("<b>2011</b>", "<b>0</b>") : raw,
      4,
    ],
    [
      "closing category drift",
      (raw: string, i: number) =>
        i === 6 ? raw.replace("Rogue - 2011", "Sentra - 2011") : raw,
      7,
    ],
    [
      "closing detail drift",
      (raw: string, i: number) =>
        i === 7 ? raw.replace("JN8AS5MV6BW668679", "JN8AS5MV6BW668680") : raw,
      8,
    ],
  ])(
    "preserves prior inventory on %s",
    async (_name, change, expectedCalls) => {
      const calls = nativeFetch(change);
      let emitted = 0;
      const result = await Effect.runPromiseExit(
        streamSpeedysInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                emitted++;
              }),
          },
          gate,
        ),
      );
      expect(Exit.isFailure(result)).toBeTrue();
      expect(emitted).toBe(0);
      expect(calls).toHaveLength(expectedCalls);
    },
  );
  test("does not advance a checkpoint when the batch callback fails", async () => {
    nativeFetch();
    const result = await Effect.runPromiseExit(
      streamSpeedysInventoryWithRequestGate(
        { onBatch: () => Effect.fail("saved callback failure") },
        gate,
      ),
    );
    expect(Exit.isFailure(result)).toBeTrue();
    expect(SpeedysCursor.initial.pages).toHaveLength(0);
  });
  const invalidHeaders: Record<string, string>[] = [
    { "content-type": "application/json" },
    { "content-range": "bytes 0-10/100" },
    { link: '<https://parts.speedysgroup.com/partingout/?pag=1>; rel="next"' },
  ];
  test.each(invalidHeaders)(
    "rejects incomplete or wrong-scope HTTP envelope %j",
    async (headers) => {
      nativeFetch(undefined, headers);
      const result = await Effect.runPromiseExit(
        streamSpeedysInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          gate,
        ),
      );
      expect(Exit.isFailure(result)).toBeTrue();
    },
  );
});
