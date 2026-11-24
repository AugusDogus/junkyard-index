import { createHash } from "node:crypto";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { afterEach, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { soakAlln1Inventory } from "../../../scripts/soak-alln1";
import { streamAlln1InventoryWithRequestGate } from "./alln1-connector";
import { Alln1Cursor, Alln1CursorSchema } from "./alln1-cursor";
import {
  alln1TestOwner,
  alln1TestPage,
  alln1TestRecords,
  alln1TestReflect,
  alln1TestRequest,
} from "./alln1-test-fixtures";
import type { Alln1Record } from "./alln1-parser";
import type { Alln1CanonicalVehicle } from "./alln1-transform";
import { runWithQueuedHost } from "./provider-host-test-support";
import { ALLN1_ORIGIN, alln1PageNumber } from "./alln1-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function mock(
  rewrite?: (body: string, page: number, ordinal: number) => string,
  response?: (body: string) => Response,
) {
  const records = alln1TestRecords(600);
  const requests: number[] = [];
  const nonces = new Set<string>();
  let ordinal = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      // Every inventory request carries its own cache-busting nonce; owner
      // pages are read as published.
      const { url, nonce } = alln1TestRequest(
        input instanceof Request ? input.url : String(input),
      );
      if (nonce !== null && nonces.has(nonce))
        throw new Error("Reused All-N-1 nonce");
      if (nonce !== null) nonces.add(nonce);
      const page = url === ALLN1_ORIGIN + "/" ? 0 : alln1PageNumber(url);
      if (page === null) throw new Error("Unexpected All-N-1 request");
      requests.push(page);
      ordinal++;
      const body =
        nonce === null
          ? alln1TestOwner
          : alln1TestReflect(
              alln1TestPage(
                records.slice((page - 1) * 500, page * 500),
                page,
                2,
              ),
              nonce,
            );
      const rewritten = rewrite?.(body, page, ordinal) ?? body;
      return (
        response?.(rewritten) ??
        new Response(rewritten, { headers: { "content-type": "text/html" } })
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}
const run = (
  cursor: Alln1Cursor = Alln1Cursor.initial,
  maxPages = 3,
  onBatch: (
    batch: Alln1CanonicalVehicle[],
  ) => Effect.Effect<void, Error> = () => Effect.void,
) =>
  Effect.runPromise(
    streamAlln1InventoryWithRequestGate(
      { startCursor: cursor, maxPages, onBatch },
      gate,
    ),
  );
test("All-N-1 resumes a serialized first page with above-cap interim quarantine", async () => {
  mock((body, page) => {
    let count = 0;
    return page === 1
      ? body.replaceAll("<td>MM-22</td>", () =>
          count++ < 60 ? "<td>HOLD</td>" : "<td>MM-22</td>",
        )
      : body;
  });
  const first = await run(undefined, 1);
  expect(first).toMatchObject({
    status: "paused",
    count: 440,
    pagesProcessed: 1,
    accounting: { recordsRejected: 60 },
  });
  expect(first.observedVins).toHaveLength(60);
  const second = await run(
    Alln1CursorSchema.parse(JSON.parse(JSON.stringify(first.cursor))),
    1,
  );
  expect(second).toMatchObject({
    status: "complete",
    count: 100,
    pagesProcessed: 1,
    accounting: {
      recordsProcessed: 100,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
});

test("All-N-1 applies cumulative quarantine rejection cap before callbacks", async () => {
  mock((body, page) => {
    let count = 0;
    return page === 1
      ? body.replaceAll("<td>MM-22</td>", () =>
          count++ < 61 ? "<td>YARD VAN</td>" : "<td>MM-22</td>",
        )
      : body;
  });
  let callbacks = 0;
  await expect(
    run(undefined, 3, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("10% rejection limit");
  expect(callbacks).toBe(0);
});
test.each([0, 33, 1.5, Number.NaN])(
  "All-N-1 rejects invalid budgets before requests (%#)",
  async (budget) => {
    const requests = mock();
    await expect(run(undefined, budget)).rejects.toThrow("page budget");
    expect(requests).toEqual([]);
  },
);
test("All-N-1 rejects prior ledger corruption before requests and preserves callback checkpoint", async () => {
  mock();
  const first = await run(undefined, 1);
  if (first.cursor.phase !== "pages")
    throw new Error("Expected pages checkpoint");
  const corrupted = {
    ...first.cursor,
    seen: first.cursor.seen.map((entry, index) =>
      index === 0
        ? { ...entry, vin: "11111111111111111", hash: "f".repeat(64) }
        : entry,
    ),
  };
  const requests = mock();
  expect(Alln1CursorSchema.safeParse(corrupted).success).toBe(false);
  await expect(run(corrupted)).rejects.toThrow("validated All-N-1 cursor");
  expect(requests).toEqual([]);
  const original = JSON.stringify(first.cursor);
  await expect(
    run(first.cursor, 1, () => Effect.fail(new Error("staging failed"))),
  ).rejects.toThrow("staging failed");
  expect(JSON.stringify(first.cursor)).toBe(original);
});
test.each([
  [
    "owner",
    (body: string, page: number) =>
      page === 0
        ? body.replaceAll("2408 Blue Ridge Blvd", "2409 Blue Ridge Blvd")
        : body,
  ],
  [
    "foreign source",
    (body: string, page: number) =>
      page === 2 ? body.replace("'MO42'", "'MO09'") : body,
  ],
  [
    "duplicate source VIN",
    (body: string, page: number) =>
      page === 2
        ? body.replace("2GNALCEK8F6000500", "2GNALCEK8F6000000")
        : body,
  ],
  [
    "duplicate native stock",
    (body: string, page: number) =>
      page === 2 ? body.replace("260500", "260000") : body,
  ],
  [
    "terminal anchor drift",
    (body: string, page: number, ordinal: number) =>
      page === 1 && ordinal > 3
        ? body.replace("<td>MM-22</td>", "<td>MM-23</td>")
        : body,
  ],
] as const)("All-N-1 blocks %s before callbacks", async (_name, rewrite) => {
  mock(rewrite);
  let callbacks = 0;
  await expect(
    run(undefined, 3, () =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("previous inventory is preserved");
  expect(callbacks).toBe(0);
});
const boundaries: ResponseInit[] = [
  { status: 206, headers: { "content-type": "text/html" } },
  { status: 200, headers: { "content-type": "application/json" } },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-range": "bytes 0-10/500" },
  },
  {
    status: 200,
    headers: { "content-type": "text/html", "content-length": "1" },
  },
  { status: 429, headers: { "content-type": "text/html" } },
];
test.each(boundaries)(
  "All-N-1 fails HTTP/body boundaries without retries (%#)",
  async (init) => {
    const requests = mock(undefined, (body) => new Response(body, init));
    await expect(run()).rejects.toThrow("previous inventory is preserved");
    expect(requests).toEqual([0]);
  },
);
test("All-N-1 complete cursors are idempotent and yard callback failure returns no checkpoint", async () => {
  const requests = mock();
  let callbacks = 0;
  expect(
    (
      await run({ source: "alln1", phase: "complete" }, 3, () =>
        Effect.sync(() => {
          callbacks++;
        }),
      )
    ).pagesProcessed,
  ).toBe(0);
  expect(requests).toEqual([]);
  expect(callbacks).toBe(0);
  await expect(
    Effect.runPromise(
      streamAlln1InventoryWithRequestGate(
        {
          onBatch: () => Effect.void,
          onYards: () => Effect.fail(new Error("yard staging failed")),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("yard staging failed");
});

test("All-N-1 soak preserves partial cursors and aggregates complete page accounting", async () => {
  mock();
  expect(
    await soakAlln1Inventory((cursor, budget) => run(cursor, budget), 1),
  ).toMatchObject({
    status: "paused",
    count: 500,
    pagesProcessed: 1,
    cursor: { phase: "pages", nextPage: 2 },
  });
  mock();
  expect(
    await soakAlln1Inventory((cursor, budget) => run(cursor, budget)),
  ).toMatchObject({
    status: "complete",
    count: 600,
    pagesProcessed: 2,
    accounting: {
      recordsProcessed: 600,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
  await expect(
    soakAlln1Inventory((cursor, budget) => run(cursor, budget), 0),
  ).rejects.toThrow("total page budget");
});
test("All-N-1 rejects redirected responses and network failures without retries", async () => {
  const redirected = mock(undefined, (body) => {
    const response = new Response(body, {
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(response, "url", { value: "https://example.com/" });
    return response;
  });
  await expect(run()).rejects.toThrow("verified endpoint");
  expect(redirected).toEqual([0]);
  let calls = 0;
  globalThis.fetch = Object.assign(
    async () => {
      calls++;
      throw new Error("network unavailable");
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(run()).rejects.toThrow("previous inventory is preserved");
  expect(calls).toBe(1);
});

test.each([
  [
    "a redirect",
    (body: string) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "redirected", { value: true });
      Object.defineProperty(response, "url", {
        value: "https://allnone.example/challenge",
      });
      return response;
    },
    "but it was redirected to https://allnone.example/challenge",
  ],
  [
    "another content type",
    (body: string) =>
      new Response(body, {
        headers: { "content-type": "application/json; charset=UTF-8" },
      }),
    "but its content type was application/json",
  ],
  [
    "a missing content type",
    (body: string) => {
      const response = new Response(body);
      response.headers.delete("content-type");
      return response;
    },
    "but its content type was absent",
  ],
  [
    "a partial body",
    (body: string) =>
      new Response(body, {
        headers: {
          "content-type": "text/html",
          "content-range": "bytes 0-99/5000",
        },
      }),
    "but it was partial (Content-Range bytes 0-99/5000)",
  ],
  [
    "another status",
    (body: string) =>
      new Response(body, {
        status: 203,
        headers: { "content-type": "text/html" },
      }),
    "but its status was HTTP 203",
  ],
] as const)(
  "All-N-1 names the failed endpoint check for %s",
  async (_case, response, failure) => {
    mock(undefined, response);
    const error = await run().then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain(
      "Expected complete unredirected HTTP 200 text/html from the verified endpoint, " +
        failure,
    );
    expect(message).not.toContain("received 200");
  },
);

test("All-N-1 does not follow redirects and names each failed response check", async () => {
  const redirects: (RequestRedirect | undefined)[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      redirects.push(init?.redirect);
      return new Response(null, {
        status: 302,
        headers: { location: "https://example.com/blocked" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  await expect(run()).rejects.toThrow(
    "but its status was HTTP 302 with Location https://example.com/blocked",
  );
  expect(redirects).toEqual(["manual"]);
  mock(
    undefined,
    (body) =>
      new Response(body, {
        headers: {
          "content-type": "application/json",
          "content-range": "bytes 0-1/9",
        },
      }),
  );
  await expect(run()).rejects.toThrow(
    "but its content type was application/json, and it was partial (Content-Range bytes 0-1/9)",
  );
});

test.each([1, 2, 3, 32])(
  "All-N-1 canonical bytes match the pre-generalization fixture at budget %i",
  async (budget) => {
    mock();
    let cursor: Alln1Cursor = Alln1Cursor.initial;
    const vehicles: Alln1CanonicalVehicle[] = [];
    while (cursor.phase !== "complete") {
      const result = await run(cursor, budget, (batch) =>
        Effect.sync(() => {
          vehicles.push(...batch);
        }),
      );
      cursor = parseDurableSourceCursor(
        "alln1",
        serializeDurableSourceCursor(result.cursor),
      );
    }
    expect(
      createHash("sha256").update(JSON.stringify(vehicles)).digest("hex"),
    ).toBe("1ca9f680d8502ed80b686a0a144fcd0264d86540ccb7af0f76c5dfceb4b05a71");
  },
);

test("All-N-1 completes a crawl when every shared host turn waits minutes", async () => {
  // About 20 URG sources share one lease at 07:00, so each turn waits about
  // 2.5 minutes. A resumed terminal chunk used to need five turns (owner,
  // anchor, last page, closing owner, closing anchor) and hit the wall limit.
  const requests = mock();
  let cursor: Alln1Cursor = Alln1Cursor.initial;
  let vehicles: Alln1CanonicalVehicle[] = [];
  const chunks: { status: string; elapsedMs: number }[] = [];
  while (cursor.phase !== "complete" && chunks.length < 6) {
    const chunk = await runWithQueuedHost(
      streamAlln1InventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 3,
          onBatch: (batch) =>
            Effect.sync(() => {
              vehicles = [...vehicles, ...batch];
            }),
        },
        gate,
      ),
      { turnWaitMs: 150_000 },
    );
    if (Either.isLeft(chunk.result)) throw chunk.result.left;
    chunks.push({
      status: chunk.result.right.status,
      elapsedMs: chunk.elapsedMs,
    });
    expect(chunk.turns.every((turn) => turn.releasedAt !== null)).toBe(true);
    cursor = Alln1CursorSchema.parse(
      JSON.parse(JSON.stringify(chunk.result.right.cursor)),
    );
  }
  expect(cursor.phase).toBe("complete");
  expect(vehicles).toHaveLength(600);
  // Every chunk returns well inside an 800 s function started inline late.
  expect(chunks.every((chunk) => chunk.elapsedMs <= 6 * 60_000)).toBe(true);
  // Closing reads still re-check the owner and the first page.
  expect(requests.slice(-2)).toEqual([0, 1]);
}, 120_000);

test("All-N-1 fails closed before searching more Set Date ties than one finishing turn fits", async () => {
  // Five pages, each boundary splitting a Set Date tie: page n+1 opens by
  // repeating page n's last donor, so four tie searches would be needed.
  const dates = [
    "2026-10-19",
    "2026-10-18",
    "2026-10-17",
    "2026-10-16",
    "2026-10-15",
  ];
  const unique = alln1TestRecords(500 + 4 * 499 + 1);
  const pages: Alln1Record[][] = [];
  let next = 0;
  dates.forEach((date, index) => {
    const size = index === 0 ? 500 : index === dates.length - 1 ? 1 : 499;
    const own = unique
      .slice(next, next + size)
      .map((record) => ({ ...record, setDate: date }));
    next += size;
    const previous = pages.at(-1)?.at(-1);
    pages.push(previous ? [previous, ...own] : own);
  });
  const served: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const { url, nonce } = alln1TestRequest(
        input instanceof Request ? input.url : String(input),
      );
      served.push(url);
      if (nonce === null)
        return new Response(alln1TestOwner, {
          headers: { "content-type": "text/html" },
        });
      const page = alln1PageNumber(url);
      const records = page === null ? undefined : pages[page - 1];
      if (page === null || records === undefined)
        throw new Error("Unexpected All-N-1 request " + url);
      return new Response(
        alln1TestReflect(alln1TestPage(records, page, pages.length), nonce),
        { headers: { "content-type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  let callbacks = 0;
  const run = Effect.runPromise(
    streamAlln1InventoryWithRequestGate(
      {
        maxPages: 32,
        onBatch: () =>
          Effect.sync(() => {
            callbacks++;
          }),
      },
      gate,
    ),
  );
  await expect(run).rejects.toThrow(
    "4 page boundaries split Set Date ties (2026-10-19, 2026-10-18, 2026-10-17, 2026-10-16), but one finishing turn fits at most 3 searches",
  );
  await expect(run).rejects.toThrow("previous inventory is preserved");
  expect(callbacks).toBe(0);
  expect(served.some((url) => url.includes("search="))).toBe(false);
});
