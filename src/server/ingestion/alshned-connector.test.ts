import { afterEach, expect, test } from "bun:test";
import {
  isDurableSourceCursorTerminal,
  serializeDurableSourceCursor,
} from "./durable-source";
import { Effect } from "effect";
import { AlshnedCursor } from "./alshned-cursor";
import { streamAlshnedInventoryWithRequestGate } from "./alshned-connector";
import {
  AlshnedCatalog,
  ALSHNED_CATALOG,
  ALSHNED_CONTACT,
  parseAlshnedOwner,
} from "./alshned-parser";
import {
  alshnedFixture,
  alshnedOpeningFixture,
  alshnedCompleteFixture,
} from "./alshned-test-fixtures";
import type { ProviderRequestGate } from "./provider-http-client";
const originalFetch = globalThis.fetch;
const direct: ProviderRequestGate = (request) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function replay(bodies: Map<string, string>) {
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input),
        body = bodies.get(url);
      calls.push(url);
      if (body === undefined)
        throw new Error("Unplanned offline Alshned destination: " + url);
      return new Response(body, { headers: { "content-type": "text/html" } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return calls;
}
function closingCursor() {
  const { pages, donors } = alshnedOpeningFixture();
  const start = AlshnedCursor.start(
    parseAlshnedOwner(alshnedFixture("contact")),
    Buffer.byteLength(alshnedFixture("contact")),
    null,
  );
  if (start.phase !== "catalog")
    throw new Error("Expected owner-validated catalog phase");
  return AlshnedCursor.checkpoint({
    ...start,
    phase: "closing",
    pages,
    donors,
    closing: [],
  });
}
test("serial bounded chunks resume catalog and primary prefix without restarting opening", async () => {
  const bodies = new Map([
    [ALSHNED_CONTACT, alshnedFixture("contact")],
    [ALSHNED_CATALOG, alshnedFixture("opening-collection")],
    [ALSHNED_CATALOG + "?page=2", alshnedFixture("opening-page2")],
  ]);
  const calls = replay(bodies);
  let emitted = 0;
  const onBatch = () =>
    Effect.sync(() => {
      emitted++;
    });
  const first = await Effect.runPromise(
    streamAlshnedInventoryWithRequestGate({ maxPages: 3, onBatch }, direct),
  );
  expect(first.status).toBe("paused");
  expect(first.cursor.phase).toBe("details");
  expect(emitted).toBe(0);
  const card = alshnedOpeningFixture().pages[0]?.cards[0];
  if (!card) throw new Error("Missing native card");
  bodies.set(card.url, alshnedFixture("detail-01"));
  const second = await Effect.runPromise(
    streamAlshnedInventoryWithRequestGate(
      {
        startCursor: AlshnedCursor.parse(
          JSON.parse(JSON.stringify(first.cursor)),
        ),
        maxPages: 1,
        onBatch,
      },
      direct,
    ),
  );
  expect(second.cursor.phase).toBe("details");
  if (second.cursor.phase !== "details")
    throw new Error("Expected primary prefix");
  expect(second.cursor.donors.length).toBe(1);
  expect(calls).toEqual([
    ALSHNED_CONTACT,
    ALSHNED_CATALOG,
    ALSHNED_CATALOG + "?page=2",
    card.url,
  ]);
  expect(emitted).toBe(0);
});
test("complete closing emits 41 actual donors and 43 presence VINs exactly once", async () => {
  const calls = replay(
    new Map([
      [ALSHNED_CATALOG, alshnedFixture("closing-collection")],
      [ALSHNED_CATALOG + "?page=2", alshnedFixture("closing-page2")],
    ]),
  );
  let emitted = 0,
    yards = 0;
  const first = await Effect.runPromise(
    streamAlshnedInventoryWithRequestGate(
      {
        startCursor: closingCursor(),
        maxPages: 1,
        onBatch: () =>
          Effect.sync(() => {
            emitted++;
          }),
      },
      direct,
    ),
  );
  expect(first.status).toBe("paused");
  expect(emitted).toBe(0);
  const last = await Effect.runPromise(
    streamAlshnedInventoryWithRequestGate(
      {
        startCursor: first.cursor,
        maxPages: 1,
        onBatch: (vehicles) =>
          Effect.sync(() => {
            emitted++;
            expect(vehicles.length).toBe(41);
          }),
        onYards: (value) =>
          Effect.sync(() => {
            yards++;
            expect(value[0]?.state).toBe("PA");
          }),
      },
      direct,
    ),
  );
  expect(last).toMatchObject({
    status: "complete",
    count: 41,
    accounting: {
      recordsProcessed: 43,
      recordsRejected: 2,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
  });
  expect(last.observedVins.length).toBe(43);
  expect(emitted).toBe(1);
  expect(yards).toBe(1);
  expect(calls).toEqual([ALSHNED_CATALOG, ALSHNED_CATALOG + "?page=2"]);
});
test("closing drift leaves prior checkpoint and callbacks untouched", async () => {
  replay(
    new Map([
      [
        ALSHNED_CATALOG,
        alshnedFixture("closing-collection").replaceAll(
          "Donor vehicle 2016 Nissan Murano Platinum Brown",
          "Donor vehicle 2017 Nissan Murano Platinum Brown",
        ),
      ],
    ]),
  );
  const cursor = closingCursor(),
    saved = JSON.stringify(cursor);
  let emitted = 0;
  const result = await Effect.runPromise(
    Effect.either(
      streamAlshnedInventoryWithRequestGate(
        {
          startCursor: cursor,
          maxPages: 1,
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
        },
        direct,
      ),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(JSON.stringify(cursor)).toBe(saved);
  expect(emitted).toBe(0);
});
test("expired run or contradictory resume settings stop before dispatch", async () => {
  const calls = replay(new Map());
  const start = AlshnedCursor.start(
    parseAlshnedOwner(alshnedFixture("contact")),
    1000,
    null,
  );
  if (start.phase !== "catalog") throw new Error("Expected catalog");
  const expired = AlshnedCursor.checkpoint({ ...start, startedAt: 0 });
  for (const options of [
    { startCursor: expired },
    { startCursor: start, previousAcceptedCount: 50 },
  ]) {
    const result = await Effect.runPromise(
      Effect.either(
        streamAlshnedInventoryWithRequestGate(
          { ...options, onBatch: () => Effect.void },
          direct,
        ),
      ),
    );
    expect(result._tag).toBe("Left");
  }
  expect(calls).toEqual([]);
});

test("an expired complete checkpoint remains a terminal no-op", async () => {
  const calls = replay(new Map());
  const state = closingCursor();
  if (state.phase !== "closing") throw new Error("Expected closing phase");
  const closing = state.pages.map((p, i) =>
    AlshnedCatalog.parse(
      alshnedFixture(i ? "closing-page2" : "closing-collection"),
      p.url,
    ),
  );
  const expired = AlshnedCursor.checkpoint({
    ...state,
    phase: "complete",
    closing,
    startedAt: 0,
  });
  let emitted = 0;
  const result = await Effect.runPromise(
    Effect.either(
      streamAlshnedInventoryWithRequestGate(
        {
          startCursor: expired,
          onBatch: () =>
            Effect.sync(() => {
              emitted++;
            }),
        },
        direct,
      ),
    ),
  );
  expect(result).toMatchObject({
    _tag: "Right",
    right: { status: "complete", count: 0, pagesProcessed: 0 },
  });
  expect(emitted).toBe(0);
  expect(calls).toEqual([]);
});

test("saved complete cursor resumes with no HTTP, callbacks, accounting or presence", async () => {
  const cursor = alshnedCompleteFixture();
  expect(cursor.phase).toBe("complete");
  expect(
    isDurableSourceCursorTerminal(
      "alshned",
      serializeDurableSourceCursor(cursor),
    ),
  ).toBe(true);
  const calls = replay(new Map());
  let batches = 0,
    yards = 0,
    gated = 0;
  const gate: ProviderRequestGate = (request) =>
    Effect.sync(() => {
      gated++;
    }).pipe(Effect.zipRight(request));
  const result = await Effect.runPromise(
    streamAlshnedInventoryWithRequestGate(
      {
        startCursor: AlshnedCursor.parse(JSON.parse(JSON.stringify(cursor))),
        onBatch: () =>
          Effect.sync(() => {
            batches++;
          }),
        onYards: () =>
          Effect.sync(() => {
            yards++;
          }),
      },
      gate,
    ),
  );
  expect(result).toEqual({
    source: "alshned",
    status: "complete",
    cursor,
    count: 0,
    pagesProcessed: 0,
    accounting: {
      recordsProcessed: 0,
      recordsRejected: 0,
      recordsExcluded: 0,
      duplicateVehicles: 0,
    },
    observedVins: [],
    warnings: [],
    errors: [],
  });
  expect(calls).toEqual([]);
  expect(gated).toBe(0);
  expect(batches).toBe(0);
  expect(yards).toBe(0);
});
