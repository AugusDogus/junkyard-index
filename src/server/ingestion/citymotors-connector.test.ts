import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect, Either, Fiber, Logger, TestClock, TestContext } from "effect";
import {
  CITYMOTORS_REQUEST_BUDGET_MS,
  CitymotorsTransientFailure,
  fetchCitymotorsPage,
} from "./citymotors-client";
import {
  CITYMOTORS_CHUNK_DEADLINE_MS,
  CITYMOTORS_COMPLETION_RESERVE_MS,
  CITYMOTORS_WORST_CASE_REQUEST_MS,
  streamCitymotorsInventoryWithRequestGate,
} from "./citymotors-connector";
import { CitymotorsCursor, CitymotorsCursorSchema } from "./citymotors-cursor";
import type { CitymotorsCanonicalVehicle } from "./citymotors-transform";
import { CITYMOTORS_CATALOG } from "./citymotors-yard-metadata";
import { DURABLE_SOURCE_DEFINITIONS } from "./durable-source";
import {
  citymotorsFixtureCatalog,
  citymotorsFixtureDetail,
  citymotorsFixturePost,
} from "./citymotors-test-fixtures";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mockInventory(
  options: {
    rejected?: number;
    duplicates?: number;
    changedClosing?: boolean;
    changedPhoto?: boolean;
    response?: ResponseInit;
    networkFailure?: boolean;
    redirected?: boolean;
    /**
     * 1-based request numbers that time out before headers, answer HTTP 503,
     * send HTML headers whose body never ends, or never answer at all.
     */
    transientFailures?: {
      at: number[];
      kind: "timeout" | "server" | "stalledBody" | "hang";
    };
    /** Called when a stalled body starts, so a test can fire its deadline. */
    onStalledBody?: () => void;
  } = {},
) {
  const posts = Array.from({ length: 10 }, (_, index) => ({
    ...citymotorsFixturePost,
    url: citymotorsFixturePost.url.replace(/\/$/, `-${index}/`),
  }));
  const requests: string[] = [];
  let listings = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      if (options.networkFailure) throw new TypeError("Network unavailable");
      if (options.transientFailures?.at.includes(requests.length)) {
        if (options.transientFailures.kind === "timeout")
          throw new DOMException("The operation timed out.", "TimeoutError");
        if (options.transientFailures.kind === "stalledBody")
          return new Response(
            new ReadableStream({ start: options.onStalledBody }),
            {
              headers: { "content-type": "text/html" },
            },
          );
        if (options.transientFailures.kind === "hang")
          return new Promise<Response>(() => {});
        return new Response("Service Unavailable", {
          status: 503,
          headers: { "content-type": "text/html" },
        });
      }
      let body: string;
      if (url === CITYMOTORS_CATALOG) {
        listings++;
        const visible =
          options.changedClosing && listings > 1 ? posts.slice(1) : posts;
        body = citymotorsFixtureCatalog(
          options.changedPhoto && listings > 1
            ? visible.map((post) => ({
                ...post,
                imageUrl: post.imageUrl.replace("IMG_9541", "IMG_9542"),
              }))
            : visible,
        );
      } else {
        const index = posts.findIndex((post) => post.url === url);
        if (index < 0) throw new Error("Unexpected native request " + url);
        const rejected = index >= 10 - (options.rejected ?? 0);
        const donor =
          !rejected && index >= 10 - (options.duplicates ?? 0) ? 0 : index;
        body = citymotorsFixtureDetail({
          url,
          vin: "5UXCW2C09L9" + String(100000 + donor),
          model: index >= 10 - (options.rejected ?? 0) ? "X5" : "X7",
        });
      }
      const response = new Response(
        body,
        options.response ?? { headers: { "content-type": "text/html" } },
      );
      if (options.redirected)
        Object.defineProperty(response, "url", {
          value: "https://example.com/",
        });
      return response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
function run<E = never>(
  cursor: CitymotorsCursor = CitymotorsCursor.initial,
  maxPages = 32,
  onBatch: (
    vehicles: CitymotorsCanonicalVehicle[],
  ) => Effect.Effect<void, E> = () => Effect.void,
) {
  return Effect.runPromise(
    streamCitymotorsInventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );
}

test("City Motors emits only a closed complete snapshot, preserves rejects and counts benign duplicates", async () => {
  const requests = mockInventory({ rejected: 1, duplicates: 2 });
  const result = await run();
  expect(result).toMatchObject({
    status: "complete",
    count: 8,
    pagesProcessed: 12,
    observedVins: ["5UXCW2C09L9100009"],
    accounting: {
      recordsProcessed: 10,
      recordsRejected: 1,
      recordsExcluded: 0,
      duplicateVehicles: 1,
    },
  });
  expect(requests).toHaveLength(12);
});

test("City Motors pause/serialize/resume retains exact prefixes and emits nothing early", async () => {
  const requests = mockInventory({ rejected: 1 });
  let cursor: CitymotorsCursor = CitymotorsCursor.initial;
  let callbacks = 0;
  let total = 0;
  for (let chunk = 0; chunk < 20; chunk++) {
    const result = await run(cursor, 2, (vehicles) =>
      Effect.sync(() => {
        callbacks++;
        total += vehicles.length;
      }),
    );
    cursor = CitymotorsCursor.parse(CitymotorsCursor.serialize(result.cursor));
    if (result.status === "complete") break;
    expect(result.count).toBe(0);
    expect(result.accounting.recordsProcessed).toBe(0);
    expect(result.observedVins).toEqual([]);
    expect(callbacks).toBe(0);
  }
  expect(cursor.phase).toBe("complete");
  expect(callbacks).toBe(1);
  expect(total).toBe(9);
  expect(requests).toHaveLength(12);
  expect((await run(cursor)).pagesProcessed).toBe(0);
  expect(requests).toHaveLength(12);
});

test("City Motors durable chunks fit worst-case native GETs inside the chunk deadline", () => {
  expect(
    DURABLE_SOURCE_DEFINITIONS.citymotors.maxPagesPerChunk *
      CITYMOTORS_WORST_CASE_REQUEST_MS +
      CITYMOTORS_COMPLETION_RESERVE_MS,
  ).toBeLessThanOrEqual(CITYMOTORS_CHUNK_DEADLINE_MS);
});

test("City Motors starts a GET only when it and the completion reserve fit the chunk deadline", async () => {
  mockInventory();
  let now = 0;
  const starts: number[] = [];
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const result = await Effect.runPromise(
      streamCitymotorsInventoryWithRequestGate(
        { maxPages: 32, onBatch: () => Effect.void },
        (request) =>
          Effect.sync(() => {
            starts.push(now);
          }).pipe(
            Effect.zipRight(request),
            Effect.ensuring(
              Effect.sync(() => {
                now += 42_000;
              }),
            ),
          ),
      ),
    );
    expect(result.status).toBe("paused");
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts)
      expect(
        start +
          CITYMOTORS_WORST_CASE_REQUEST_MS +
          CITYMOTORS_COMPLETION_RESERVE_MS,
      ).toBeLessThanOrEqual(CITYMOTORS_CHUNK_DEADLINE_MS);
  } finally {
    clock.mockRestore();
  }
});

test("City Motors pauses before a GET that could outlast the chunk deadline", async () => {
  const requests = mockInventory();
  let now = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const result = await Effect.runPromise(
      streamCitymotorsInventoryWithRequestGate(
        { maxPages: 32, onBatch: () => Effect.void },
        (request) =>
          request.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                now += CITYMOTORS_WORST_CASE_REQUEST_MS;
              }),
            ),
          ),
      ),
    );
    const fitting = Math.floor(
      (CITYMOTORS_CHUNK_DEADLINE_MS - CITYMOTORS_COMPLETION_RESERVE_MS) /
        CITYMOTORS_WORST_CASE_REQUEST_MS,
    );
    expect(result.status).toBe("paused");
    expect(result.pagesProcessed).toBe(fitting);
    expect(requests).toHaveLength(fitting);
  } finally {
    clock.mockRestore();
  }
});

test.each(["timeout", "server"] as const)(
  "City Motors sends a GET that failed transiently (%s) once more and continues",
  async (kind) => {
    const requests = mockInventory({ transientFailures: { at: [2], kind } });
    const result = await run();
    expect(result).toMatchObject({ status: "complete", pagesProcessed: 12 });
    expect(requests).toHaveLength(13);
    expect(requests[2]).toBe(requests[1]);
  },
);

test("City Motors returns the last validated checkpoint when a GET fails twice after progress", async () => {
  const requests = mockInventory({
    transientFailures: { at: [2, 3], kind: "timeout" },
  });
  const logs: string[] = [];
  const paused = await Effect.runPromise(
    streamCitymotorsInventoryWithRequestGate(
      { maxPages: 3, onBatch: () => Effect.void },
      gate,
    ).pipe(
      Effect.provide(
        Logger.replace(
          Logger.defaultLogger,
          Logger.make(({ logLevel, message }) => {
            logs.push(`${logLevel.label} ${String(message)}`);
          }),
        ),
      ),
    ),
  );
  expect(paused).toMatchObject({ status: "paused", pagesProcessed: 1 });
  expect(logs).toEqual([
    expect.stringMatching(
      new RegExp(
        `^WARN City Motors ${requests[1]} failed after one resend \\(.*timed out.*\\); returning the last validated checkpoint`,
      ),
    ),
  ]);
  expect(paused.cursor.phase).toBe("details");
  if (paused.cursor.phase !== "details")
    throw new Error("Expected native detail checkpoint");
  expect(paused.cursor.records).toHaveLength(0);
  expect(requests).toHaveLength(3);
  const resumed = await run(paused.cursor);
  expect(resumed).toMatchObject({ status: "complete", pagesProcessed: 11 });
  expect(requests[3]).toBe(requests[1]);
});

test("City Motors fails a chunk whose first GET fails twice without advancing", async () => {
  const requests = mockInventory({
    transientFailures: { at: [1, 2], kind: "server" },
  });
  await expect(run()).rejects.toThrow(
    /after one resend: .*answered HTTP 503\..*prior inventory is preserved/,
  );
  expect(requests).toHaveLength(2);
});

test("City Motors resends a GET whose body stalls until the body deadline", async () => {
  const deadlines: AbortController[] = [];
  const requests = mockInventory({
    transientFailures: { at: [2], kind: "stalledBody" },
    onStalledBody: () => {
      setTimeout(() => {
        for (const deadline of deadlines)
          deadline.abort(
            new DOMException("The operation timed out.", "TimeoutError"),
          );
      }, 10);
    },
  });
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(() => {
    const deadline = new AbortController();
    deadlines.push(deadline);
    return deadline.signal;
  });
  try {
    const result = await run();
    expect(result).toMatchObject({ status: "complete", pagesProcessed: 12 });
    expect(requests).toHaveLength(13);
    expect(requests[2]).toBe(requests[1]);
  } finally {
    timeout.mockRestore();
  }
});

test("City Motors treats the combined request deadline as transient", async () => {
  const requests = mockInventory({
    transientFailures: { at: [1], kind: "hang" },
  });
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          Effect.either(fetchCitymotorsPage(CITYMOTORS_CATALOG, gate)),
        );
        yield* TestClock.adjust(CITYMOTORS_REQUEST_BUDGET_MS);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    if (Either.isRight(result)) throw new Error("Expected a timed-out GET");
    expect(result.left).toBeInstanceOf(CitymotorsTransientFailure);
    expect(requests).toHaveLength(1);
  } finally {
    timeout.mockRestore();
  }
});

test("City Motors resends a failed GET only when it still fits the chunk deadline", async () => {
  const requests = mockInventory({
    transientFailures: { at: [3], kind: "timeout" },
  });
  let now = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const result = await Effect.runPromise(
      streamCitymotorsInventoryWithRequestGate(
        { maxPages: 32, onBatch: () => Effect.void },
        (request) =>
          request.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                now += CITYMOTORS_WORST_CASE_REQUEST_MS;
              }),
            ),
          ),
      ),
    );
    expect(result).toMatchObject({ status: "paused", pagesProcessed: 2 });
    expect(requests).toHaveLength(3);
  } finally {
    clock.mockRestore();
  }
});

test("City Motors rejects late catalog drift and excessive required loss before callbacks", async () => {
  let callbacks = 0;
  for (const options of [
    { changedClosing: true },
    { rejected: 2 },
    { duplicates: 3 },
  ]) {
    mockInventory(options);
    await expect(
      run(undefined, 32, () =>
        Effect.sync(() => {
          callbacks++;
        }),
      ),
    ).rejects.toThrow();
    expect(callbacks).toBe(0);
  }
});

test("City Motors optional closing photo drift becomes null", async () => {
  mockInventory({ changedPhoto: true });
  const emitted: CitymotorsCanonicalVehicle[] = [];
  const result = await run(undefined, 32, (vehicles) =>
    Effect.sync(() => {
      emitted.push(...vehicles);
    }),
  );
  expect(result.count).toBe(10);
  expect(emitted.every((vehicle) => vehicle.imageUrl === null)).toBe(true);
});

test.each<ResponseInit>([
  { status: 403, headers: { "content-type": "text/html" } },
  { status: 206, headers: { "content-type": "text/html" } },
  { headers: { "content-type": "application/json" } },
  {
    headers: { "content-type": "text/html", "content-range": "bytes 0-1/100" },
  },
  { headers: { "content-type": "text/html", "content-length": "1" } },
])(
  "City Motors stops partial or non-HTML transport without retry (%#)",
  async (response) => {
    const requests = mockInventory({ response });
    await expect(run()).rejects.toThrow("prior inventory is preserved");
    expect(requests).toHaveLength(1);
  },
);

test("City Motors rejects redirects, network failures and foreign destinations without fallback", async () => {
  for (const options of [{ redirected: true }, { networkFailure: true }]) {
    const requests = mockInventory(options);
    await expect(run()).rejects.toThrow("prior inventory is preserved");
    expect(requests).toHaveLength(1);
  }
  const requests = mockInventory();
  await expect(
    Effect.runPromise(
      fetchCitymotorsPage("https://example.com/cars/vehicle/", gate),
    ),
  ).rejects.toThrow("outside");
  expect(requests).toHaveLength(0);
});

test("City Motors validates checkpoint integrity, native order and request budgets before HTTP", async () => {
  const requests = mockInventory();
  for (const budget of [0, 33, 1.5])
    await expect(run(undefined, budget)).rejects.toThrow("request budget");
  expect(requests).toHaveLength(0);
  const partial = await run(undefined, 2);
  expect(partial.cursor.phase).toBe("details");
  if (partial.cursor.phase !== "details")
    throw new Error("Expected native detail checkpoint");
  const cursor = partial.cursor;
  expect(() =>
    CitymotorsCursor.checkpoint({
      ...cursor,
      records: cursor.records.map((record) => ({
        ...record,
        status: "Sold whole",
      })),
    }),
  ).toThrow();
  expect(() =>
    CitymotorsCursor.checkpoint({
      ...cursor,
      records: cursor.records.map((record) => ({
        ...record,
        description: "Not our vehicle. Foreign supplier.",
      })),
    }),
  ).toThrow();
  expect(
    CitymotorsCursorSchema.safeParse({ ...partial.cursor, pages: [] }).success,
  ).toBe(false);
  expect(
    CitymotorsCursorSchema.safeParse({ ...partial.cursor, records: [] })
      .success,
  ).toBe(false);
  expect(() =>
    CitymotorsCursor.checkpoint({
      ...cursor,
      records: [...cursor.records, ...cursor.records],
    }),
  ).toThrow();
  expect(() => CitymotorsCursor.parse(" ".repeat(1024 * 1024 + 1))).toThrow(
    "1 MiB",
  );
  const wire = CitymotorsCursor.serialize(partial.cursor);
  await expect(
    run(partial.cursor, 32, () => Effect.fail(new Error("Caller unavailable"))),
  ).rejects.toThrow("Caller unavailable");
  expect(CitymotorsCursor.serialize(partial.cursor)).toBe(wire);
});
