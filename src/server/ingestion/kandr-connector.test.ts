import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamKandrInventory,
  type KandrOptions,
  type KandrStreamResult,
} from "./kandr-connector";
import { KandrError, type KandrResult } from "./kandr-contract";
import { KandrCursor } from "./kandr-cursor";
import { kandrHash } from "./kandr-native";
import { kandrFixture } from "./kandr-test-fixtures";

const contract = { minimumUniqueInventory: 40 };
const unwrap = <T>(result: KandrResult<T>) => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const actualResponses = () =>
  structuredClone([
    kandrFixture.controls,
    ...kandrFixture.opening,
    ...kandrFixture.details,
    ...kandrFixture.closing,
  ]);
function harness(responses = actualResponses()) {
  let requests = 0,
    batches = 0;
  const options: KandrOptions<never, never> = {
    contract,
    previousUniqueInventory: null,
    readPage(url) {
      return Effect.suspend(() => {
        const receipt = responses[requests++];
        return receipt?.url === url
          ? Effect.succeed(receipt.html)
          : Effect.fail(
              KandrError.create(
                "fixture traversal",
                "Unexpected or repeated request: " + url,
              ),
            );
      });
    },
    onBatch(vehicles) {
      return Effect.sync(() => {
        batches++;
        expect(vehicles).toHaveLength(48);
        expect(requests).toBe(56);
      });
    },
  };
  return { options, requests: () => requests, batches: () => batches };
}
async function finish(options: KandrOptions<never, never>) {
  let result: KandrStreamResult;
  let cursor: unknown = options.startCursor;
  do {
    result = await Effect.runPromise(
      streamKandrInventory({ ...options, startCursor: cursor }),
    );
    expect(result.pagesProcessed).toBeLessThanOrEqual(8);
    cursor = unwrap(KandrCursor.serialize(result.cursor, contract));
  } while (result.status === "paused");
  return result;
}

describe("K&R closed native graph connector", () => {
  test("replays all 56 saved responses through seven durable eight-GET chunks", async () => {
    const h = harness();
    const result = await finish(h.options);
    expect(h.requests()).toBe(56);
    expect(h.batches()).toBe(1);
    expect(result.status).toBe("complete");
    expect(result.count).toBe(48);
    expect(result.accounting).toEqual({
      recordsProcessed: 49,
      recordsRejected: 1,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    });
    expect(result.observedVins).toEqual(["3HSDJSJR0DN170483"]);
    expect(result.cursor.requests).toBe(56);
    expect(result.cursor.bytes).toBe(
      actualResponses().reduce((sum, r) => sum + Buffer.byteLength(r.html), 0),
    );
    const terminal = await Effect.runPromise(
      streamKandrInventory({
        ...h.options,
        startCursor: unwrap(KandrCursor.serialize(result.cursor, contract)),
      }),
    );
    expect(terminal.status).toBe("complete");
    expect(terminal.count).toBe(0);
    expect(h.batches()).toBe(1);
    expect(h.requests()).toBe(56);
  });
  test("does not emit a partial graph, and rejects changed closing inventory", async () => {
    const responses = actualResponses();
    const closing = responses.at(-1);
    if (!closing) throw new Error("Missing closing fixture");
    closing.html = closing.html.replaceAll("111222", "111223");
    const h = harness(responses);
    const paused = await Effect.runPromise(streamKandrInventory(h.options));
    expect(paused.status).toBe("paused");
    expect(paused.count).toBe(0);
    expect(paused.accounting.recordsProcessed).toBe(0);
    expect(h.batches()).toBe(0);
    await expect(
      finish({ ...h.options, startCursor: paused.cursor }),
    ).rejects.toThrow("opening/closing");
    expect(h.batches()).toBe(0);
  });
  test("preserves prior inventory on transport failure, drift and failed batch", async () => {
    const failed = harness();
    await expect(
      finish({
        ...failed.options,
        readPage: () =>
          Effect.fail(KandrError.create("request", "saved denial")),
      }),
    ).rejects.toThrow("saved denial");
    expect(failed.batches()).toBe(0);
    const drift = harness();
    await expect(
      finish({ ...drift.options, previousUniqueInventory: 100 }),
    ).rejects.toThrow("drift");
    expect(drift.batches()).toBe(0);
    const callback = harness();
    await expect(
      finish({
        ...callback.options,
        onBatch: () => Effect.die(new Error("batch refused")),
      }),
    ).rejects.toThrow("batch refused");
    expect(callback.batches()).toBe(0);
  });
  test("rejects the full snapshot when real donor bodies lose required make fields", async () => {
    const responses = actualResponses();
    for (const response of responses.slice(4, 10))
      response.html = response.html.replace(
        /(<strong>Vehicle Make:<\/strong>)[^<]*/,
        "$1",
      );
    const h = harness(responses);
    await expect(finish(h.options)).rejects.toThrow("rejection");
    expect(h.requests()).toBe(56);
    expect(h.batches()).toBe(0);
  });
  test("rejects corrupt, cross-scope, reordered and incomplete checkpoints before HTTP", async () => {
    const h = harness();
    const first = await Effect.runPromise(
      streamKandrInventory({ ...h.options, maxPages: 1 }),
    );
    expect(first.status).toBe("paused");
    expect(KandrCursor.parse({ ...first.cursor, bytes: 1 }, contract).ok).toBe(
      false,
    );
    expect(
      KandrCursor.parse(first.cursor, { minimumUniqueInventory: 1 }).ok,
    ).toBe(false);
    expect(KandrCursor.complete(first.cursor, contract).ok).toBe(false);
    if (first.cursor.phase !== "collecting")
      throw new Error("Expected collecting cursor");
    const reordered = { ...first.cursor, receipts: [] };
    reordered.checksum = kandrHash({ ...reordered, checksum: undefined });
    expect(KandrCursor.parse(reordered, contract).ok).toBe(false);
    await expect(
      Effect.runPromise(
        streamKandrInventory({
          ...h.options,
          startCursor: { ...first.cursor, source: "other" },
        }),
      ),
    ).rejects.toThrow();
    expect(h.requests()).toBe(1);
    expect(h.batches()).toBe(0);
  });
  test("validates request budgets before any HTTP", async () => {
    const h = harness();
    for (const budget of [0, 9, 1.5])
      await expect(
        Effect.runPromise(
          streamKandrInventory({ ...h.options, maxPages: budget }),
        ),
      ).rejects.toThrow("1 to 8");
    expect(h.requests()).toBe(0);
  });
});
