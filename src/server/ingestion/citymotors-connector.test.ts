import { afterEach, expect, spyOn, test } from "bun:test";
import {
  Chunk,
  Effect,
  Either,
  Fiber,
  Logger,
  TestClock,
  TestContext,
} from "effect";
import { validationRejectionKind } from "./ingestion-validation";
import {
  CITYMOTORS_BROWSER_REQUEST_TIMEOUT_MS,
  CITYMOTORS_REQUEST_BUDGET_MS,
  CitymotorsTransientFailure,
  fetchCitymotorsPage,
} from "./citymotors-client";
import {
  CITYMOTORS_BROWSER_LANDING,
  CITYMOTORS_CHUNK_DEADLINE_MS,
  CITYMOTORS_COMPLETION_RESERVE_MS,
  CITYMOTORS_RATE_LIMIT_BACKOFF_MS,
  CITYMOTORS_WORST_CASE_REQUEST_MS,
  streamCitymotorsInventoryWithRequestGate,
} from "./citymotors-connector";
import {
  CitymotorsCursor,
  CitymotorsCursorSchema,
  citymotorsCensusKey,
} from "./citymotors-cursor";
import {
  MODEL_CENSUS_DAY_MS,
  MODEL_CENSUS_SWEEP_DAYS,
  ModelCensus,
} from "./model-census";
import type { CitymotorsCanonicalVehicle } from "./citymotors-transform";
import { CITYMOTORS_CATALOG } from "./citymotors-yard-metadata";
import {
  DocumentTransport,
  type BrowserDocumentPage,
  type LazyDocumentTransport,
} from "./document-transport";
import { DURABLE_SOURCE_DEFINITIONS } from "./durable-source";
import {
  ProviderCapacityDeferred,
  ProviderChunkClock,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
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
      kind: "timeout" | "server" | "stalledBody" | "hang" | "rateLimited";
      /** Retry-After seconds sent with a rateLimited HTTP 429. */
      retryAfterSeconds?: number;
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
        if (options.transientFailures.kind === "rateLimited")
          return new Response("Too Many Requests", {
            status: 429,
            headers: {
              "content-type": "text/html",
              ...(options.transientFailures.retryAfterSeconds === undefined
                ? {}
                : {
                    "retry-after": String(
                      options.transientFailures.retryAfterSeconds,
                    ),
                  }),
            },
          });
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

/** A browser transport that records its lease, opens and GETs, reading each
 * document from the mocked native fetch. `leaseWaitMs` is added to the
 * spied clock while the lease is taken, as a busy session lease would. */
function recordingBrowser(
  events: string[],
  options: { leaseWaitMs?: number; advance?: (ms: number) => void } = {},
): LazyDocumentTransport {
  const documents: DocumentTransport = (url, init) => {
    events.push("get " + url);
    return DocumentTransport.native(url, init);
  };
  return {
    // The real lease reports its wait to the chunk clock as queue time.
    lease: ProviderChunkClock.queued(
      Effect.sync(() => {
        events.push("lease");
        options.advance?.(options.leaseWaitMs ?? 0);
      }),
    ),
    open: Effect.sync(() => {
      events.push("open");
      return documents;
    }),
  };
}

test("City Motors reads every document through its browser transport after taking the session lease", async () => {
  const requests = mockInventory();
  const events: string[] = [];
  const result = await Effect.runPromise(
    streamCitymotorsInventoryWithRequestGate(
      { maxPages: 32, onBatch: () => Effect.void },
      gate,
      recordingBrowser(events),
    ),
  );
  expect(result).toMatchObject({ status: "complete", pagesProcessed: 12 });
  expect(events[0]).toBe("lease");
  expect(events.filter((event) => event === "lease")).toHaveLength(1);
  expect(
    events.filter((event) => event.startsWith("get ")).map((e) => e.slice(4)),
  ).toEqual(requests);
  expect(requests).toHaveLength(12);
});

test("City Motors takes no browser session lease for a complete cursor", async () => {
  const events: string[] = [];
  const result = await Effect.runPromise(
    streamCitymotorsInventoryWithRequestGate(
      {
        startCursor: { source: "citymotors", version: 1, phase: "complete" },
        onBatch: () => Effect.void,
      },
      gate,
      recordingBrowser(events),
    ),
  );
  expect(result.status).toBe("complete");
  expect(events).toEqual([]);
});

test("City Motors does not count waiting for the browser session lease against its GET budget", async () => {
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
        recordingBrowser([], {
          leaseWaitMs: CITYMOTORS_CHUNK_DEADLINE_MS,
          advance: (ms) => {
            now += ms;
          },
        }),
      ),
    );
    const fitting = Math.floor(
      (CITYMOTORS_CHUNK_DEADLINE_MS - CITYMOTORS_COMPLETION_RESERVE_MS) /
        CITYMOTORS_WORST_CASE_REQUEST_MS,
    );
    expect(result).toMatchObject({ status: "paused", pagesProcessed: fitting });
    expect(requests).toHaveLength(fitting);
  } finally {
    clock.mockRestore();
  }
});

test.each([
  new ProviderCapacityDeferred({
    provider: "The Kernel spend guard",
    detail: "City Motors has spent its daily Kernel cap.",
  }),
  new ProviderTurnDeferred({
    host: "Kernel session lease",
    stage: "wait",
    elapsedMs: 1,
    queuedMs: 1,
  }),
])(
  "City Motors passes a browser deferral through unwrapped so the source retries its cursor (%#)",
  async (deferral) => {
    const requests = mockInventory();
    const error = await Effect.runPromise(
      streamCitymotorsInventoryWithRequestGate(
        { maxPages: 32, onBatch: () => Effect.void },
        gate,
        { lease: Effect.fail(deferral), open: Effect.fail(deferral) },
      ),
    ).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(ProviderChunkClock.deferralOf(error)).toBe(deferral);
    expect(requests).toHaveLength(0);
  },
);

test("City Motors ends each GET before its browser's own request timeout, so a slow page stays a transient failure", () => {
  expect(CITYMOTORS_REQUEST_BUDGET_MS).toBeLessThan(
    CITYMOTORS_BROWSER_REQUEST_TIMEOUT_MS,
  );
});

test("City Motors names a Cloudflare challenge in its refusal", async () => {
  mockInventory({
    response: {
      status: 403,
      headers: { "content-type": "text/html", "cf-mitigated": "challenge" },
    },
  });
  await expect(run()).rejects.toThrow(
    /received 403 \(a Cloudflare challenge\).*prior inventory is preserved/,
  );
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

test.each([
  [null, 0, "without a Retry-After header"],
  ["40", 40_000, 'with Retry-After "40" (a 40 s wait)'],
  ["0", 0, 'with Retry-After "0" (zero, past or unreadable, so no wait)'],
  [
    "Wed, 21 Oct 2015 07:28:00 GMT",
    0,
    'with Retry-After "Wed, 21 Oct 2015 07:28:00 GMT" (zero, past or unreadable, so no wait)',
  ],
  [
    "99999999999999999",
    Infinity,
    'with Retry-After "99999999999999999" (longer than any finite wait)',
  ],
])(
  "City Motors quotes a 429 Retry-After of %p and the wait it asks for",
  async (retryAfter, retryAfterMs, wording) => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response("Too Many Requests", {
          status: 429,
          headers: {
            "content-type": "text/html",
            ...(retryAfter === null ? {} : { "retry-after": retryAfter }),
          },
        }),
      { preconnect: originalFetch.preconnect },
    );
    const result = await Effect.runPromise(
      Effect.either(fetchCitymotorsPage(CITYMOTORS_CATALOG, gate)),
    );
    if (
      Either.isRight(result) ||
      !(result.left instanceof CitymotorsTransientFailure)
    )
      throw new Error("Expected a rate-limited GET");
    expect(result.left.rateLimited).toEqual({ retryAfterMs });
    expect(String(result.left.cause)).toContain(
      "City Motors origin answered HTTP 429 " + wording,
    );
  },
);

test("City Motors resends a failed GET only when it still fits the chunk deadline", async () => {
  // The last GET that fits fails, leaving no time to send it once more.
  const fitting = Math.floor(
    (CITYMOTORS_CHUNK_DEADLINE_MS - CITYMOTORS_COMPLETION_RESERVE_MS) /
      CITYMOTORS_WORST_CASE_REQUEST_MS,
  );
  const requests = mockInventory({
    transientFailures: { at: [fitting], kind: "timeout" },
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
    expect(result).toMatchObject({
      status: "paused",
      pagesProcessed: fitting - 1,
    });
    expect(requests).toHaveLength(fitting);
  } finally {
    clock.mockRestore();
  }
});

/** Waits (in real time) until the test clock holds a sleep ending at `time`. */
const sleepingUntil = (time: number) =>
  Effect.gen(function* () {
    for (let polls = 0; polls < 2_000; polls++) {
      if (Chunk.toReadonlyArray(yield* TestClock.sleeps()).includes(time))
        return;
      yield* Effect.promise(() => new Promise((done) => setTimeout(done, 5)));
    }
    return yield* Effect.dieMessage(
      `No test-clock sleep ending at ${time} ms was registered`,
    );
  });

test("City Motors waits out a rate limit's Retry-After before sending the GET once more", async () => {
  const requests = mockInventory({
    transientFailures: { at: [2], kind: "rateLimited", retryAfterSeconds: 40 },
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamCitymotorsInventoryWithRequestGate(
          { maxPages: 32, onBatch: () => Effect.void },
          gate,
        ),
      );
      yield* sleepingUntil(40_000);
      const waited = requests.length;
      yield* TestClock.adjust(40_000);
      return { waited, result: yield* Fiber.join(fiber) };
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result.waited).toBe(2);
  expect(result.result).toMatchObject({
    status: "complete",
    pagesProcessed: 12,
  });
  expect(requests).toHaveLength(13);
  expect(requests[2]).toBe(requests[1]);
});

test("City Motors backs off a rate limit without Retry-After before sending the GET once more", async () => {
  const requests = mockInventory({
    transientFailures: { at: [1], kind: "rateLimited" },
  });
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        streamCitymotorsInventoryWithRequestGate(
          { maxPages: 1, onBatch: () => Effect.void },
          gate,
        ),
      );
      yield* sleepingUntil(CITYMOTORS_RATE_LIMIT_BACKOFF_MS);
      const waited = requests.length;
      yield* TestClock.adjust(CITYMOTORS_RATE_LIMIT_BACKOFF_MS);
      return { waited, result: yield* Fiber.join(fiber) };
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(result.waited).toBe(1);
  expect(result.result).toMatchObject({ status: "paused", pagesProcessed: 1 });
  expect(requests).toEqual([CITYMOTORS_CATALOG, CITYMOTORS_CATALOG]);
});

test.each([0, 1])(
  "City Motors defers a rate-limited GET whose Retry-After does not fit the chunk to a durable cooldown (%i pages first)",
  async (pagesFirst) => {
    const requests = mockInventory({
      transientFailures: {
        at: [pagesFirst + 1],
        kind: "rateLimited",
        retryAfterSeconds: 300,
      },
    });
    const before = Date.now();
    const paused = await run(undefined, 3);
    expect(paused).toMatchObject({
      status: "paused",
      pagesProcessed: pagesFirst,
    });
    if (paused.cursor.phase === "complete" || !paused.cursor.retryAt)
      throw new Error("Expected a rate-limit cooldown checkpoint");
    const retryAt = paused.cursor.retryAt;
    expect(retryAt).toBeGreaterThanOrEqual(before + 300_000);
    expect(requests).toHaveLength(pagesFirst + 1);
    // A wake too early to wait out within the chunk sends nothing and fails
    // as transient: returning the unchanged cursor would fail the Workflow
    // run as making no progress.
    const early = await run(paused.cursor).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(String(early)).toMatch(
      /rate-limit cooldown: woke 300 s before its retryAt .*so the refused GET was not sent.*prior inventory is preserved/,
    );
    expect(validationRejectionKind(early)).toBe("transient");
    expect(requests).toHaveLength(pagesFirst + 1);
    const clock = spyOn(Date, "now").mockImplementation(() => retryAt);
    try {
      const resumed = await run(paused.cursor);
      expect(resumed).toMatchObject({
        status: "complete",
        pagesProcessed: 12 - pagesFirst,
      });
    } finally {
      clock.mockRestore();
    }
    expect(requests[pagesFirst + 1]).toBe(requests[pagesFirst]);
  },
);

test("City Motors waits out the rest of a cooldown when the Workflow wakes within clock skew of retryAt", async () => {
  const requests = mockInventory({
    transientFailures: { at: [1], kind: "rateLimited", retryAfterSeconds: 300 },
  });
  const paused = await run();
  if (paused.cursor.phase === "complete" || !paused.cursor.retryAt)
    throw new Error("Expected a rate-limit cooldown checkpoint");
  const retryAt = paused.cursor.retryAt;
  const cursor = paused.cursor;
  const clock = spyOn(Date, "now").mockImplementation(() => retryAt - 5_000);
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          streamCitymotorsInventoryWithRequestGate(
            { startCursor: cursor, maxPages: 1, onBatch: () => Effect.void },
            gate,
          ),
        );
        yield* sleepingUntil(5_000);
        const waited = requests.length;
        yield* TestClock.adjust(5_000);
        return { waited, result: yield* Fiber.join(fiber) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result.waited).toBe(1);
    expect(result.result).toMatchObject({
      status: "paused",
      pagesProcessed: 1,
    });
    if (result.result.cursor.phase === "complete")
      throw new Error("Expected a resumable checkpoint");
    expect(result.result.cursor.retryAt).toBeUndefined();
  } finally {
    clock.mockRestore();
  }
  expect(requests).toEqual([CITYMOTORS_CATALOG, CITYMOTORS_CATALOG]);
});

test("City Motors waits out an early wake that fits the chunk and counts the wait against the chunk deadline", async () => {
  const requests = mockInventory({
    transientFailures: { at: [1], kind: "rateLimited", retryAfterSeconds: 300 },
  });
  const paused = await run();
  if (paused.cursor.phase === "complete" || !paused.cursor.retryAt)
    throw new Error("Expected a rate-limit cooldown checkpoint");
  const cursor = paused.cursor;
  const early = 40_000;
  const wake = paused.cursor.retryAt - early;
  let now = wake;
  const starts: number[] = [];
  const fitting = Math.floor(
    (CITYMOTORS_CHUNK_DEADLINE_MS - CITYMOTORS_COMPLETION_RESERVE_MS - early) /
      CITYMOTORS_WORST_CASE_REQUEST_MS,
  );
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          streamCitymotorsInventoryWithRequestGate(
            { startCursor: cursor, maxPages: 32, onBatch: () => Effect.void },
            (request) =>
              Effect.sync(() => {
                starts.push(now - wake);
              }).pipe(
                Effect.zipRight(request),
                Effect.ensuring(
                  Effect.sync(() => {
                    now += CITYMOTORS_WORST_CASE_REQUEST_MS;
                  }),
                ),
              ),
          ),
        );
        yield* sleepingUntil(early);
        const waited = requests.length;
        now += early;
        yield* TestClock.adjust(early);
        return { waited, result: yield* Fiber.join(fiber) };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result.waited).toBe(1);
    expect(result.result).toMatchObject({
      status: "paused",
      pagesProcessed: fitting,
    });
    for (const start of starts)
      expect(
        start +
          CITYMOTORS_WORST_CASE_REQUEST_MS +
          CITYMOTORS_COMPLETION_RESERVE_MS,
      ).toBeLessThanOrEqual(CITYMOTORS_CHUNK_DEADLINE_MS);
  } finally {
    clock.mockRestore();
  }
  expect(requests).toHaveLength(1 + fitting);
});

test("City Motors fails as transient when the host still rate-limits right after a cooldown", async () => {
  const requests = mockInventory({
    transientFailures: {
      at: [1, 2],
      kind: "rateLimited",
      retryAfterSeconds: 300,
    },
  });
  const paused = await run();
  if (paused.cursor.phase === "complete" || !paused.cursor.retryAt)
    throw new Error("Expected a rate-limit cooldown checkpoint");
  const retryAt = paused.cursor.retryAt;
  const clock = spyOn(Date, "now").mockImplementation(() => retryAt);
  try {
    const error = await run(paused.cursor).then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(String(error)).toMatch(
      /HTTP 429 with Retry-After "300" \(a 300 s wait\) again right after its cooldown.*prior inventory is preserved/,
    );
    expect(validationRejectionKind(error)).toBe("transient");
  } finally {
    clock.mockRestore();
  }
  expect(requests).toHaveLength(2);
});

test("City Motors fails as transient when a Retry-After exceeds the longest durable cooldown", async () => {
  const requests = mockInventory({
    transientFailures: {
      at: [1],
      kind: "rateLimited",
      retryAfterSeconds: 3_600,
    },
  });
  const error = await run().then(
    () => null,
    (cause: unknown) => cause,
  );
  expect(String(error)).toMatch(
    /with no time to resend: .*HTTP 429 with Retry-After "3600" \(a 3600 s wait\), longer than the 10-minute wait.*prior inventory is preserved/,
  );
  expect(validationRejectionKind(error)).toBe("transient");
  expect(requests).toHaveLength(1);
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
  expect(() => CitymotorsCursor.parse(" ".repeat(4 * 1024 * 1024 + 1))).toThrow(
    "4 MiB",
  );
  const wire = CitymotorsCursor.serialize(partial.cursor);
  await expect(
    run(partial.cursor, 32, () => Effect.fail(new Error("Caller unavailable"))),
  ).rejects.toThrow("Caller unavailable");
  expect(CitymotorsCursor.serialize(partial.cursor)).toBe(wire);
});

const DAY = 20_000;
const atDay = (day: number) => () => day * MODEL_CENSUS_DAY_MS + 7 * 3_600_000;
const donor = (index: number): typeof citymotorsFixturePost => ({
  ...citymotorsFixturePost,
  url: citymotorsFixturePost.url.replace(/\/$/, `-${index}/`),
});
const donorVin = (index: number, revision = 0) =>
  "5UXCW2C09L9" + String(100000 + revision * 1000 + index);

/** A yard whose catalog and donor pages a test can change between runs. */
function mockYard(listed: (typeof citymotorsFixturePost)[]) {
  const yard = {
    listed,
    vins: new Map(listed.map((post, index) => [post.url, donorVin(index)])),
    requests: [] as string[],
  };
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      yard.requests.push(url);
      const vin = yard.vins.get(url);
      if (url !== CITYMOTORS_CATALOG && vin === undefined)
        throw new Error("Unexpected native request " + url);
      return new Response(
        url === CITYMOTORS_CATALOG
          ? citymotorsFixtureCatalog(yard.listed)
          : citymotorsFixtureDetail({ url, vin }),
        { headers: { "content-type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return yard;
}
const detailReads = (requests: readonly string[]) =>
  requests.filter((url) => url !== CITYMOTORS_CATALOG);

/** Runs one whole City Motors census in chunks of `maxPages` GETs and
 * returns the emitted vehicles, the terminal cursor and the warnings. */
async function census(day: number, previousCursor: unknown, maxPages = 32) {
  const vehicles: CitymotorsCanonicalVehicle[] = [];
  const warnings: string[] = [];
  let cursor: CitymotorsCursor = CitymotorsCursor.initial;
  for (let chunk = 0; chunk < 64 && cursor.phase !== "complete"; chunk++) {
    const result = await Effect.runPromise(
      streamCitymotorsInventoryWithRequestGate(
        {
          startCursor: cursor,
          previousCursor,
          now: atDay(day),
          maxPages,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles.push(...batch);
            }),
        },
        gate,
      ),
    );
    warnings.push(...result.warnings);
    cursor = CitymotorsCursor.parse(CitymotorsCursor.serialize(result.cursor));
  }
  if (cursor.phase !== "complete") throw new Error("Census did not complete");
  // The durable store keeps the terminal cursor as wire text.
  return {
    vehicles,
    warnings,
    terminal: JSON.parse(CitymotorsCursor.serialize(cursor)),
  };
}

test("City Motors reads a new donor's detail and reuses every unchanged listed donor's last accepted record", async () => {
  const yard = mockYard(Array.from({ length: 10 }, (_, i) => donor(i)));
  const cold = await census(DAY, null);
  expect(detailReads(yard.requests)).toHaveLength(10);
  expect(cold.terminal.census.models).toHaveLength(10);

  yard.requests.length = 0;
  yard.listed = [...yard.listed, donor(10)];
  yard.vins.set(donor(10).url, donorVin(10));
  const warm = await census(DAY, cold.terminal);
  expect(detailReads(yard.requests)).toEqual([donor(10).url]);
  // Membership is still read live: every catalog page, then its closing.
  expect(
    yard.requests.filter((url) => url === CITYMOTORS_CATALOG),
  ).toHaveLength(2);
  expect(warm.vehicles.map((vehicle) => vehicle.vin).sort()).toEqual(
    Array.from({ length: 11 }, (_, i) => donorVin(i)).sort(),
  );
  expect(warm.warnings).toContain(
    "City Motors donor census: Read 1 of 11 model pages (new 1); carried 10.",
  );
});

test("City Motors drops a donor the catalog no longer lists, without reading any detail", async () => {
  const yard = mockYard(Array.from({ length: 10 }, (_, i) => donor(i)));
  const cold = await census(DAY, null);
  yard.requests.length = 0;
  yard.listed = yard.listed.filter((post) => post.url !== donor(3).url);
  const warm = await census(DAY, cold.terminal);
  expect(detailReads(yard.requests)).toEqual([]);
  expect(warm.vehicles).toHaveLength(9);
  expect(warm.vehicles.map((vehicle) => vehicle.vin)).not.toContain(
    donorVin(3),
  );
  expect(warm.terminal.census.models).toHaveLength(9);
});

test("City Motors reads a donor again when its catalog card changes, and publishes what it reads", async () => {
  const yard = mockYard(Array.from({ length: 10 }, (_, i) => donor(i)));
  const cold = await census(DAY, null);
  yard.requests.length = 0;
  const changed = {
    ...donor(4),
    imageUrl: donor(4).imageUrl.replace("IMG_9541", "IMG_9600"),
  };
  yard.listed = yard.listed.map((post) =>
    post.url === changed.url ? changed : post,
  );
  // The re-listed card belongs to another donor at the same address.
  yard.vins.set(changed.url, donorVin(4, 1));
  const warm = await census(DAY, cold.terminal);
  expect(detailReads(yard.requests)).toEqual([changed.url]);
  const vins = warm.vehicles.map((vehicle) => vehicle.vin);
  expect(vins).toContain(donorVin(4, 1));
  expect(vins).not.toContain(donorVin(4));
  expect(
    warm.vehicles.find((vehicle) => vehicle.vin === donorVin(4, 1))?.imageUrl,
  ).toBe(changed.imageUrl);
});

test("City Motors sweeps one sixth of its unchanged donors the next day and reads every donor after a missed day", async () => {
  const yard = mockYard(Array.from({ length: 30 }, (_, i) => donor(i)));
  const cold = await census(DAY, null);
  yard.requests.length = 0;
  const next = await census(DAY + 1, cold.terminal);
  const swept = yard.listed
    .filter(
      (post) =>
        ModelCensus.slice(citymotorsCensusKey(post)) ===
        (DAY + 1) % MODEL_CENSUS_SWEEP_DAYS,
    )
    .map((post) => post.url);
  expect(swept.length).toBeGreaterThan(0);
  expect(swept.length).toBeLessThan(30);
  expect(detailReads(yard.requests)).toEqual(swept);
  expect(next.vehicles).toHaveLength(30);

  yard.requests.length = 0;
  await census(DAY + 3, next.terminal);
  expect(detailReads(yard.requests)).toHaveLength(30);
});

test("City Motors carries donors across paused chunks and spends its GET budget only on reads", async () => {
  const yard = mockYard(Array.from({ length: 10 }, (_, i) => donor(i)));
  const cold = await census(DAY, null);
  yard.requests.length = 0;
  yard.listed = [donor(10), ...yard.listed, donor(11)];
  yard.vins.set(donor(10).url, donorVin(10));
  yard.vins.set(donor(11).url, donorVin(11));
  const warm = await census(DAY, cold.terminal, 1);
  expect(detailReads(yard.requests)).toEqual([donor(10).url, donor(11).url]);
  expect(warm.vehicles).toHaveLength(12);
});

test("City Motors reads a donor whose card photo changed by closing again on the next run", async () => {
  const yard = mockYard(Array.from({ length: 3 }, (_, i) => donor(i)));
  const drifted = {
    ...donor(1),
    imageUrl: donor(1).imageUrl.replace("IMG_9541", "IMG_9700"),
  };
  // The first catalog read lists the old photo, the closing read the new one.
  let listings = 0;
  const mocked = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === CITYMOTORS_CATALOG && ++listings === 2)
        yard.listed = yard.listed.map((post) =>
          post.url === drifted.url ? drifted : post,
        );
      return mocked(input);
    },
    { preconnect: originalFetch.preconnect },
  );
  const first = await census(DAY, null);
  expect(
    first.vehicles.find((vehicle) => vehicle.vin === donorVin(1))?.imageUrl,
  ).toBeNull();
  yard.requests.length = 0;
  const second = await census(DAY, first.terminal);
  expect(detailReads(yard.requests)).toEqual([drifted.url]);
  expect(
    second.vehicles.find((vehicle) => vehicle.vin === donorVin(1))?.imageUrl,
  ).toBe(drifted.imageUrl);
});

test("City Motors starts a cold census from a pre-incremental or unreadable previous cursor", async () => {
  const yard = mockYard(Array.from({ length: 3 }, (_, i) => donor(i)));
  const legacy = await census(DAY, {
    source: "citymotors",
    version: 1,
    phase: "complete",
  });
  expect(detailReads(yard.requests)).toHaveLength(3);
  expect(legacy.warnings.join("\n")).not.toContain("not a readable");
  yard.requests.length = 0;
  const unreadable = await census(DAY, {
    ...legacy.terminal,
    census: { ...legacy.terminal.census, models: "tampered" },
  });
  expect(detailReads(yard.requests)).toHaveLength(3);
  expect(unreadable.warnings).toContain(
    "Previous City Motors checkpoint is not a readable terminal census; reading every donor page.",
  );
});

test("City Motors refuses a checkpoint whose carried donor differs from its census evidence", async () => {
  const yard = mockYard(Array.from({ length: 10 }, (_, i) => donor(i)));
  const cold = await census(DAY, null);
  yard.listed = [donor(10), ...yard.listed];
  yard.vins.set(donor(10).url, donorVin(10));
  const paused = await Effect.runPromise(
    streamCitymotorsInventoryWithRequestGate(
      {
        previousCursor: cold.terminal,
        now: atDay(DAY),
        maxPages: 1,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  // The catalog GET left the new donor due first; read it, then tamper.
  const read = await Effect.runPromise(
    streamCitymotorsInventoryWithRequestGate(
      {
        startCursor: paused.cursor,
        now: atDay(DAY),
        maxPages: 1,
        onBatch: () => Effect.void,
      },
      gate,
    ),
  );
  const cursor = read.cursor;
  if (cursor.phase !== "closing")
    throw new Error("Expected every remaining donor to carry");
  expect(cursor.records).toHaveLength(11);
  expect(() =>
    CitymotorsCursor.checkpoint({
      ...cursor,
      records: cursor.records.map((record, index) =>
        index === 5
          ? {
              ...record,
              fields: record.fields.map(([label, value]) =>
                label === "VIN" ? [label, donorVin(5, 2)] : [label, value],
              ),
            }
          : record,
      ),
    }),
  ).toThrow("carried donor differs");
});

test("City Motors ends a timed-out GET's in-page fetch before it sends that GET again", async () => {
  // Only the client's combined deadline ends the hung read; the browser's own
  // longer timeout never fires in this test.
  const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
    () => new AbortController().signal,
  );
  const events: string[] = [];
  let active = 0;
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      events.push(`fetch starts with ${active} in flight`);
      if (events.length > 1)
        return new Response(citymotorsFixtureCatalog(), {
          headers: { "content-type": "text/html" },
        });
      active++;
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => {
          active--;
          events.push("first fetch aborted");
          reject(init.signal?.reason);
        }),
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  let current = "about:blank";
  const page: BrowserDocumentPage = {
    url: () => current,
    goto: async (url) => {
      current = url;
      return null;
    },
    // Both serialized in-page functions run against the mocked global fetch.
    evaluate: async (run, request) => run(request),
    cancel: async (run, key) => {
      events.push("cancel");
      run(key);
    },
  };
  const documents = DocumentTransport.browser(
    page,
    { fetchAfter: CITYMOTORS_BROWSER_LANDING },
    CITYMOTORS_BROWSER_REQUEST_TIMEOUT_MS,
  );
  try {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.fork(
          streamCitymotorsInventoryWithRequestGate(
            { maxPages: 1, onBatch: () => Effect.void },
            gate,
            { lease: Effect.void, open: Effect.succeed(documents) },
          ),
        );
        yield* TestClock.adjust(CITYMOTORS_REQUEST_BUDGET_MS);
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result.pagesProcessed).toBe(1);
    expect(events).toEqual([
      "fetch starts with 0 in flight",
      "cancel",
      "first fetch aborted",
      "fetch starts with 0 in flight",
    ]);
  } finally {
    timeout.mockRestore();
  }
});
