import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Database } from "./context";
import { expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import {
  ARIO_HOURLY_REQUEST_BUDGET,
  ArioRateLimit,
  type ArioBatchClient,
} from "./autorecycler-ario-client";
import { ArioPageSchema } from "./autorecycler-ario-inventory";
import {
  loadArioState,
  readArioRun,
  type ArioRunState,
} from "./autorecycler-ario-run";
import { ARIO_CUSTOMER_YARDS } from "./autorecycler-ario-yards";
import {
  AutorecyclerCursorSchema,
  type AutorecyclerCursor,
} from "./autorecycler-cursor";
import { streamAutorecyclerInventory } from "./autorecycler-connector";
import { IngestionSnapshotStore } from "./ingestion-snapshot-store";
import { ingestDurableSource } from "./durable-ingestion-orchestrator";

const freshness = {
  asOf: Date.parse("2026-11-15T12:00:00Z"),
  legacy: {},
  eligibleYards: [],
};
const initial: AutorecyclerCursor = {
  source: "autorecycler",
  phase: "ario-read",
  offset: 0,
  closing: false,
  statePath: null,
  freshness,
};

async function capturedGroupClient(failAt?: number) {
  const directory: unknown = await Bun.file(
    new URL("./fixtures/ario/yards.json", import.meta.url),
  ).json();
  const yards = new Map<
    string,
    Record<string, z.infer<typeof ArioPageSchema>>
  >();
  for (const yard of ARIO_CUSTOMER_YARDS) {
    const bytes = await Bun.file(
      new URL(`./fixtures/ario/${yard.slug}.json.gz`, import.meta.url),
    ).arrayBuffer();
    yards.set(
      yard.slug,
      z
        .record(ArioPageSchema)
        .parse(JSON.parse(gunzipSync(new Uint8Array(bytes)).toString())),
    );
  }
  const calls: { slugs: readonly string[]; offset: number }[] = [];
  let directoryCalls = 0;
  let failed = false;
  const openings = new Set<string>();
  const client: ArioBatchClient = {
    yards: async () => {
      directoryCalls++;
      return directory;
    },
    pages: async (slugs, offset) => {
      calls.push({ slugs, offset });
      if (!failed && offset === failAt) {
        failed = true;
        throw new ArioRateLimit(Date.now() + 3_600_000);
      }
      const pages = slugs.map((slug) => {
        const key =
          offset === 0 && openings.has(slug) ? "closing" : String(offset);
        if (offset === 0) openings.add(slug);
        const page = yards.get(slug)?.[key];
        if (!page) throw new Error(`Unsaved window ${slug}/${key}`);
        return page;
      });
      return {
        items: pages.flatMap((page) => page.items),
        total: pages[0]?.total ?? 0,
        yards_meta: pages.flatMap((page) => page.yards_meta),
      };
    },
  };
  return { client, calls, directoryCalls: () => directoryCalls };
}

async function replay(failAt?: number) {
  const saved = await capturedGroupClient(failAt);
  const store = IngestionSnapshotStore.memory();
  const load = async (path: string) => (await store.load(path)).checkpointState;
  let bootstraps = 0;
  const makeClient = (state: ArioRunState) => {
    if (!state.session.key) {
      bootstraps++;
      state.session.key = "offline-public-key";
    }
    return saved.client;
  };
  const database = createClient({ url: ":memory:" });
  const waits: number[] = [];
  const failures: string[] = [];
  let accepted = 0;
  let chunks = 0;
  let closing = false;
  const result = await ingestDurableSource({
    runId: "ario-replay",
    initialCursor: initial,
    operations: {
      sleepUntil: async (time) => {
        waits.push(time);
      },
      markFailed: async (_runId, _source, message) => {
        failures.push(message);
        throw new Error(message);
      },
      runChunk: async (_runId, cursor) => {
        chunks++;
        if (cursor.phase === "ario-read") {
          const chunk = await Effect.runPromise(
            readArioRun(cursor, load, makeClient),
          );
          const path = await store.put({
            runId: "ario-replay",
            source: "autorecycler",
            chunk: {
              vehicles: [],
              observedVins: [],
              checkpointState: chunk.checkpointState,
            },
          });
          return {
            ...chunk,
            cursor: AutorecyclerCursorSchema.parse({
              ...chunk.cursor,
              statePath: path,
            }),
          };
        }
        if (cursor.phase === "ario") {
          closing = true;
          const chunk = await Effect.runPromise(
            streamAutorecyclerInventory({
              startCursor: cursor,
              loadArioState: load,
              onBatch: (vehicles) =>
                Effect.sync(() => {
                  accepted += vehicles.length;
                }),
            }).pipe(Effect.provideService(Database, drizzle(database))),
          );
          return chunk;
        }
        return {
          cursor: { source: "autorecycler", phase: "complete", freshness },
          status: "complete",
          count: accepted,
          errors: [],
          pagesProcessed: 0,
        };
      },
    },
  });
  database.close();
  expect(result.status).toBe("complete");
  expect(failures).toEqual([]);
  expect(closing).toBe(true);
  expect(accepted).toBe(19_212);
  expect(bootstraps).toBe(1);
  expect(saved.directoryCalls()).toBe(1);
  return { ...saved, waits, chunks };
}

test("daily grouped census retains complete stable windows below the hourly budget", async () => {
  const result = await replay();
  expect(result.calls).toHaveLength(34); // 33 windows, including stale Santa Maria, and one closing check.
  expect(result.calls.length + 3).toBe(37); // HTML, bundle, directory.
  expect(result.calls.length + 3).toBeLessThan(ARIO_HOURLY_REQUEST_BUDGET);
  expect(result.waits).toEqual([]);
  expect(result.chunks).toBe(56); // 34 capture, 21 publish, one legacy terminal stand-in.
  expect(result.calls.at(-1)?.slugs).toHaveLength(21);
  expect(
    result.calls
      .filter((call) => call.slugs.includes("cfc-recycling"))
      .map((call) => call.offset),
  ).toEqual([0, 100, 200, 300, 400, 0]);
}, 60_000);

test("429 mid-run checkpoints, sleeps durably and resumes only the unfinished window", async () => {
  const result = await replay(200);
  expect(result.waits).toHaveLength(1);
  expect(result.waits[0]).toBeGreaterThan(Date.now());
  expect(result.calls.map((call) => call.offset).slice(0, 5)).toEqual([
    0, 100, 200, 200, 300,
  ]);
  expect(result.calls.filter((call) => call.offset === 100)).toHaveLength(1);
  expect(result.calls).toHaveLength(35);
}, 60_000);

test("persistent 429 pauses fail the source after 24 checkpoints and preserve published inventory", async () => {
  let checkpointState: unknown;
  let calls = 0;
  let waits = 0;
  let failure = "";
  const result = await ingestDurableSource({
    runId: "ario-rate-limited",
    initialCursor: initial,
    operations: {
      sleepUntil: async () => {
        waits++;
      },
      runChunk: async (_runId, cursor) => {
        if (cursor.phase !== "ario-read") throw new Error("Unexpected cursor");
        const chunk = await Effect.runPromise(
          readArioRun(
            cursor,
            async () => checkpointState,
            () => ({
              yards: async () => {
                calls++;
                if (calls > 24)
                  throw new Error(
                    "Exceeded the expected rate-limit retry bound",
                  );
                throw new ArioRateLimit(Date.now() + 3_600_000);
              },
              pages: async () => {
                throw new Error("Directory did not complete");
              },
            }),
          ),
        );
        checkpointState = chunk.checkpointState;
        return {
          ...chunk,
          cursor: AutorecyclerCursorSchema.parse({
            ...chunk.cursor,
            statePath: "offline-state",
          }),
        };
      },
      markFailed: async (_runId, _source, message) => {
        failure = message;
        return {
          cursor: initial,
          status: "failed",
          count: 0,
          errors: [message],
          pagesProcessed: 0,
        };
      },
    },
  });
  expect(result.status).toBe("failed");
  expect(calls).toBe(24);
  expect(waits).toBe(23);
  expect(failure).toContain("24 consecutive rate-limit pauses");
  expect(failure).toContain("Published inventory is preserved");
});

test("a completed rank window resets the persisted consecutive rate-limit count", async () => {
  const saved = await capturedGroupClient();
  const recovered = await Effect.runPromise(
    readArioRun(
      { ...initial, statePath: "offline-state" },
      async () => ({ session: {}, pages: {}, consecutiveRateLimits: 23 }),
      () => saved.client,
    ),
  );
  const state = await loadArioState(
    "offline-state",
    async () => recovered.checkpointState,
  );
  expect(state.consecutiveRateLimits).toBe(0);
  if (recovered.cursor.phase !== "ario-read")
    throw new Error("Expected the next rank window");
  const paused = await Effect.runPromise(
    readArioRun(
      { ...recovered.cursor, statePath: "offline-state" },
      async () => recovered.checkpointState,
      () => ({
        ...saved.client,
        pages: async () => {
          throw new ArioRateLimit(Date.now() + 3_600_000);
        },
      }),
    ),
  );
  const resumed = await loadArioState(
    "offline-state",
    async () => paused.checkpointState,
  );
  expect(resumed.consecutiveRateLimits).toBe(1);
});

test("the saved live 21-customer response fits the grouped bounds with CFC intact", async () => {
  const directory: unknown = await Bun.file(
    new URL("./fixtures/ario/yards.json", import.meta.url),
  ).json();
  const raw: unknown = JSON.parse(
    gunzipSync(
      await Bun.file(
        new URL("./fixtures/ario/cfc-group-21.json.gz", import.meta.url),
      ).bytes(),
    ).toString(),
  );
  const result = await Effect.runPromise(
    readArioRun(initial, undefined, () => ({
      yards: async () => directory,
      pages: async (slugs, offset) => {
        expect(slugs).toEqual(ARIO_CUSTOMER_YARDS.map((yard) => yard.slug));
        expect(offset).toBe(0);
        return raw;
      },
    })),
  );
  const state = await loadArioState(
    "saved-live-group",
    async () => result.checkpointState,
  );
  expect(Object.keys(state.pages)).toHaveLength(21);
  expect(
    Object.values(state.pages).reduce(
      (sum, windows) => sum + (windows["0"]?.items.length ?? 0),
      0,
    ),
  ).toBe(2095);
  expect(state.pages["cfc-recycling"]?.["0"]?.total).toBe(422);
  expect(state.pages["cfc-recycling"]?.["0"]?.items).toHaveLength(100);
});
