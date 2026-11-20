import { describe, expect, test } from "bun:test";
import {
  withAlgoliaWriterLock,
  type AlgoliaWriterHook,
} from "./algolia-writer-lock";

/** Records each hook's acquisition and disposal in order. */
function recordingHooks(conflicts: Array<{ runId: string } | null>) {
  const events: string[] = [];
  let next = 0;
  const acquire = (): AlgoliaWriterHook => {
    const id = next++;
    events.push(`acquire ${id}`);
    return {
      getConflict: async () => conflicts[id] ?? null,
      [Symbol.dispose]: () => {
        events.push(`dispose ${id}`);
      },
    };
  };
  return { events, acquire };
}

describe("withAlgoliaWriterLock", () => {
  test("holds the lock until the write resolves", async () => {
    const { events, acquire } = recordingHooks([null]);
    let finish = (_value: string) => {};
    const result = withAlgoliaWriterLock({
      acquire,
      waitForWriter: async () => {},
      write: () =>
        new Promise<string>((resolve) => {
          events.push("write started");
          finish = (value) => {
            events.push("write settled");
            resolve(value);
          };
        }),
    });
    // Let the lock register and the write start, then check it is still held.
    await Bun.sleep(0);
    expect(events).toEqual(["acquire 0", "write started"]);
    finish("projected");
    expect(await result).toBe("projected");
    expect(events).toEqual([
      "acquire 0",
      "write started",
      "write settled",
      "dispose 0",
    ]);
  });

  test("holds the lock until the write rejects", async () => {
    const { events, acquire } = recordingHooks([null]);
    const failure = new Error("projection failed");
    await expect(
      withAlgoliaWriterLock({
        acquire,
        waitForWriter: async () => {},
        write: async () => {
          await Bun.sleep(0);
          events.push("write settled");
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(["acquire 0", "write settled", "dispose 0"]);
  });

  test("waits out another writer with a fresh hook each attempt", async () => {
    const { events, acquire } = recordingHooks([
      { runId: "other-run" },
      { runId: "other-run" },
      null,
    ]);
    const waitedFor: string[] = [];
    expect(
      await withAlgoliaWriterLock({
        acquire,
        waitForWriter: async (runId) => {
          waitedFor.push(runId);
        },
        write: async () => {
          events.push("write");
          return "done";
        },
      }),
    ).toBe("done");
    expect(waitedFor).toEqual(["other-run", "other-run"]);
    expect(events).toEqual([
      "acquire 0",
      "dispose 0",
      "acquire 1",
      "dispose 1",
      "acquire 2",
      "write",
      "dispose 2",
    ]);
  });
});
