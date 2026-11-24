import { afterEach, expect, test } from "bun:test";
import { Effect, Either, TestClock } from "effect";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { validationRejectionKind } from "./ingestion-validation";
import {
  PICKAPARTVA_SEARCH_CHUNK_SOFT_MS,
  streamPickapartvaInventoryWithRequestGate,
  type PickapartvaStreamResult,
} from "./pickapartva-connector";
import type { PickapartvaCursor } from "./pickapartva-cursor";
import {
  parsePickapartvaPage,
  parsePickapartvaSearch,
  pickapartvaCardKey,
  type PickapartvaRecord,
} from "./pickapartva-parser";
import {
  PICKAPARTVA_RECOVERY_LIFETIME_MS,
  PickapartvaRecovery,
} from "./pickapartva-recovery";
import { pickapartvaTies } from "./pickapartva-snapshot";
import {
  pickapartvaTestPage,
  pickapartvaTestRecord,
  pickapartvaTestSearch,
} from "./pickapartva-test-fixtures";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
import { ProviderTurnDeferred } from "./provider-chunk-clock";
import { runWithQueuedHost } from "./provider-host-test-support";
import {
  pickapartvaSearchHref,
  type PickapartvaSearchScope,
} from "./pickapartva-yard-metadata";

const date = "2026-11-21";
const donor = (
  index: number,
  overrides: Partial<PickapartvaRecord> = {},
): PickapartvaRecord => ({
  ...pickapartvaTestRecord,
  cardId: `PAP${100000 + index}`,
  stock: `PAP${100000 + index}`,
  vin: `1FAHP3FN0AW${100000 + index}`,
  setDate: date,
  ...overrides,
});
const href = (id: PickapartvaSearchScope = "ANY", make = "ANY") =>
  pickapartvaSearchHref(date, id, make) ?? "";
const search = (
  records: readonly PickapartvaRecord[],
  id: PickapartvaSearchScope = "ANY",
  make = "ANY",
  makes?: readonly string[],
) =>
  parsePickapartvaSearch(
    pickapartvaTestSearch(records, date, id, make, makes),
    date,
    id,
    make,
  );

// Synthetic records: shown donors 0-9 and hidden donors 10 and 11.
const shown = Array.from({ length: 10 }, (_, index) => donor(index));
const tie = { date, slots: 2, shown: shown.map(pickapartvaCardKey).sort() };
const hiddenA = donor(10);
const hiddenB = donor(11, { yardCode: "UU81" });

test("Pick-A-Part VA plans every yard at once unless the catalog already shows a full search page", () => {
  expect(PickapartvaRecovery.plan(tie, 1).pending).toEqual([
    { id: "ANY", make: "ANY" },
  ]);
  const bulk = Array.from({ length: 500 }, (_, index) => donor(index));
  expect(
    PickapartvaRecovery.plan(
      { date, slots: 1, shown: bulk.map(pickapartvaCardKey).sort() },
      1,
    ).pending,
  ).toEqual([
    { id: "TT87", make: "ANY" },
    { id: "UU81", make: "ANY" },
  ]);
  // 499 shown donors and one hidden one fill a search page too.
  expect(
    PickapartvaRecovery.plan(
      {
        date,
        slots: 1,
        shown: bulk.slice(1).map(pickapartvaCardKey).sort(),
      },
      1,
    ).pending,
  ).toEqual([
    { id: "TT87", make: "ANY" },
    { id: "UU81", make: "ANY" },
  ]);
});

test("Pick-A-Part VA keeps a saved recovery only for a tie the catalog shows the same way within its lifetime", () => {
  const saved = PickapartvaRecovery.plan(tie, 1_000);
  const other = { date: "2026-11-20", slots: 1, shown: [] };
  const kept = PickapartvaRecovery.reconcile([saved], [tie], 2_000);
  expect(kept).toEqual({ recoveries: [saved], replans: [] });
  expect(
    PickapartvaRecovery.reconcile([saved], [{ ...tie, slots: 3 }, other], 2_000)
      .replans,
  ).toEqual([
    { date, reason: "changed" },
    { date: "2026-11-20", reason: "new" },
  ]);
  const stale = PickapartvaRecovery.reconcile(
    [saved],
    [tie],
    1_001 + PICKAPARTVA_RECOVERY_LIFETIME_MS,
  );
  expect(stale.replans).toEqual([{ date, reason: "stale" }]);
  expect(stale.recoveries[0]?.startedAt).toBe(
    1_001 + PICKAPARTVA_RECOVERY_LIFETIME_MS,
  );
});

test("Pick-A-Part VA fails a catalog page that lists one donor card twice", () => {
  const legacy = donor(0, { cardId: null, stock: "LEGACY1" });
  const page = parsePickapartvaPage(
    pickapartvaTestPage([legacy, donor(1), legacy], 1, 1),
    1,
  );
  expect(() => pickapartvaTies([{ url: catalogUrl(1), page }])).toThrow(
    "lists one donor card twice on page 1",
  );
});

test("Pick-A-Part VA recovers a date once its searches list every hidden donor", () => {
  const planned = PickapartvaRecovery.plan(tie, 1);
  const done = PickapartvaRecovery.record(
    planned,
    href(),
    search([...shown, hiddenA, hiddenB]),
  );
  expect(PickapartvaRecovery.resolved(done)).toBe(true);
  expect(done.hidden).toEqual([
    { id: "ANY", make: "ANY", record: hiddenA },
    { id: "ANY", make: "ANY", record: hiddenB },
  ]);
  expect(done.searches).toEqual([
    {
      id: "ANY",
      make: "ANY",
      url: href(),
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      capped: false,
    },
  ]);
});

/** A capped answer: these donors padded with shown donors to 500 cards. */
const cappedListing = (records: PickapartvaRecord[]) => [
  ...records,
  ...Array.from({ length: 500 - records.length }, (_, index) =>
    donor(1000 + index),
  ),
];
const bulkTie = (slots: number) => ({
  date,
  slots,
  shown: [
    ...shown,
    ...Array.from({ length: 500 }, (_, index) => donor(1000 + index)),
  ]
    .map(pickapartvaCardKey)
    .sort(),
});

test("Pick-A-Part VA counts the donors a capped search lists and stops once they are enough", () => {
  const planned = PickapartvaRecovery.plan(bulkTie(1), 1);
  const done = PickapartvaRecovery.record(
    planned,
    href("TT87"),
    search(cappedListing([hiddenA]), "TT87"),
  );
  expect(done.searches[0]?.capped).toBe(true);
  // Stafford is never searched: the one hidden donor is already found.
  expect(done.pending).toEqual([]);
  expect(done.hidden.map((entry) => entry.record)).toEqual([hiddenA]);
});

test("Pick-A-Part VA splits a capped yard search by make, most listed makes first", () => {
  const makes = ["CHEVROLET", "FORD", "LAND ROVER", "TOYOTA"];
  const chevrolets = Array.from({ length: 3 }, (_, index) =>
    donor(2000 + index, { make: "CHEVROLET", model: "MALIBU" }),
  );
  const listing = [...chevrolets, ...cappedListing([]).slice(3)];
  const planned = PickapartvaRecovery.plan(
    {
      date,
      slots: 1,
      shown: listing.map(pickapartvaCardKey).sort(),
    },
    1,
  );
  const capped = PickapartvaRecovery.record(
    planned,
    href("TT87"),
    search(listing, "TT87", "ANY", makes),
  );
  // Stafford first, then FORD (497 listed), CHEVROLET (3), then the makes
  // it listed none of in native order.
  expect(capped.pending).toEqual([
    { id: "UU81", make: "ANY" },
    { id: "TT87", make: "FORD" },
    { id: "TT87", make: "CHEVROLET" },
    { id: "TT87", make: "LAND ROVER" },
    { id: "TT87", make: "TOYOTA" },
  ]);
  const stafford = PickapartvaRecovery.record(
    capped,
    href("UU81"),
    search([], "UU81"),
  );
  const ford = PickapartvaRecovery.record(
    stafford,
    href("TT87", "FORD"),
    search(listing.slice(3, 100), "TT87", "FORD"),
  );
  expect(ford.hidden).toEqual([]);
  const rover = donor(3000, { make: "LAND ROVER", model: "RANGE ROVER" });
  const chevrolet = PickapartvaRecovery.record(
    ford,
    href("TT87", "CHEVROLET"),
    search(chevrolets, "TT87", "CHEVROLET"),
  );
  const found = PickapartvaRecovery.record(
    chevrolet,
    href("TT87", "LAND ROVER"),
    search([rover], "TT87", "LAND ROVER"),
  );
  // TOYOTA is never searched.
  expect(found.pending).toEqual([]);
  expect(found.hidden).toEqual([
    { id: "TT87", make: "LAND ROVER", record: rover },
  ]);
});

test("Pick-A-Part VA names a make missing from the native selector when a make split runs out short", () => {
  const listing = cappedListing([]);
  const planned = PickapartvaRecovery.plan(
    { date, slots: 1, shown: listing.map(pickapartvaCardKey).sort() },
    1,
  );
  const capped = PickapartvaRecovery.record(
    planned,
    href("TT87"),
    search(listing, "TT87", "ANY", ["FORD"]),
  );
  const stafford = PickapartvaRecovery.record(
    capped,
    href("UU81"),
    search([], "UU81"),
  );
  let caught: unknown;
  try {
    PickapartvaRecovery.record(
      stafford,
      href("TT87", "FORD"),
      search(listing.slice(0, 100), "TT87", "FORD"),
    );
  } catch (error) {
    caught = error;
  }
  expect(String(caught)).toContain("add 0 donors, but the catalog repeated 1");
  expect(String(caught)).toContain(
    "a hidden donor's make is missing from the native make selector (TT87: FORD)",
  );
  expect(validationRejectionKind(caught)).toBe("transient");
});

test.each<[string, () => unknown, string, "transient" | "deterministic"]>([
  [
    "lists more unseen donors than the catalog hid",
    () =>
      PickapartvaRecovery.record(
        PickapartvaRecovery.plan(tie, 1),
        href(),
        search([...shown, hiddenA, hiddenB, donor(12)]),
      ),
    "add 3 donors, but the catalog repeated 2",
    "transient",
  ],
  [
    "runs out of searches short of the hidden donors",
    () =>
      PickapartvaRecovery.record(
        PickapartvaRecovery.plan(tie, 1),
        href(),
        search([...shown, hiddenA]),
      ),
    "add 1 donors, but the catalog repeated 2",
    "transient",
  ],
  [
    "is a capped make search",
    () =>
      PickapartvaRecovery.record(
        {
          ...PickapartvaRecovery.plan(bulkTie(1), 1),
          pending: [{ id: "TT87", make: "FORD" }],
        },
        href("TT87", "FORD"),
        search(cappedListing([]), "TT87", "FORD"),
      ),
    "FORD search for 2026-11-21 in TT87 returned 500 cards",
    "deterministic",
  ],
  [
    "is not the pending search",
    () =>
      PickapartvaRecovery.record(
        PickapartvaRecovery.plan(tie, 1),
        href("TT87"),
        search(shown, "TT87"),
      ),
    "is not the next pending search",
    "deterministic",
  ],
])(
  "Pick-A-Part VA refuses a set-date search that %s",
  (_kind, record, message, kind) => {
    let caught: unknown;
    try {
      record();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain(message);
    expect(validationRejectionKind(caught)).toBe(
      kind === "transient" ? "transient" : null,
    );
  },
);

test("Pick-A-Part VA trusts a recovery only for its lifetime", () => {
  const planned = PickapartvaRecovery.plan(tie, 1_000_000);
  expect(PickapartvaRecovery.fresh(planned, 1_000_000)).toBe(true);
  expect(
    PickapartvaRecovery.fresh(
      planned,
      1_000_000 + PICKAPARTVA_RECOVERY_LIFETIME_MS,
    ),
  ).toBe(true);
  expect(
    PickapartvaRecovery.fresh(
      planned,
      1_000_001 + PICKAPARTVA_RECOVERY_LIFETIME_MS,
    ),
  ).toBe(false);
  expect(PickapartvaRecovery.fresh(planned, 999_999)).toBe(false);
  expect(PickapartvaRecovery.matches(planned, tie)).toBe(true);
  expect(PickapartvaRecovery.matches(planned, { ...tie, slots: 3 })).toBe(
    false,
  );
  expect(
    PickapartvaRecovery.matches(planned, { ...tie, shown: tie.shown.slice(1) }),
  ).toBe(false);
});

// A three-page catalog in which Fredericksburg set 600 shown donors and one
// hidden LAND ROVER on 2026-11-21, more than one search page holds. Page 2
// repeats page 1's last donor. Stafford set none that day.
const fords = Array.from({ length: 450 }, (_, index) => donor(index));
const chevrolets = Array.from({ length: 150 }, (_, index) =>
  donor(450 + index, { make: "CHEVROLET", model: "MALIBU" }),
);
const sameDay = [...fords, ...chevrolets];
const rover = donor(900, { make: "LAND ROVER", model: "RANGE ROVER" });
const older = Array.from({ length: 409 }, (_, index) =>
  donor(1000 + index, {
    setDate: "2026-11-20",
    yardCode: index % 2 === 0 ? "TT87" : "UU81",
  }),
);
const catalog = [
  pickapartvaTestPage(sameDay.slice(0, 500), 1, 3),
  pickapartvaTestPage(
    [sameDay[499] ?? donor(0), ...sameDay.slice(500), ...older.slice(0, 399)],
    2,
    3,
  ),
  pickapartvaTestPage(older.slice(399), 3, 3),
];
const nativeMakes = ["CHEVROLET", "FORD", "LAND ROVER", "TOYOTA"];
const answers = new Map<string, string>([
  [
    href("TT87"),
    pickapartvaTestSearch(
      sameDay.slice(0, 500),
      date,
      "TT87",
      "ANY",
      nativeMakes,
    ),
  ],
  [href("UU81"), pickapartvaTestSearch([], date, "UU81", "ANY", nativeMakes)],
  [href("TT87", "FORD"), pickapartvaTestSearch(fords, date, "TT87", "FORD")],
  [
    href("TT87", "CHEVROLET"),
    pickapartvaTestSearch(chevrolets, date, "TT87", "CHEVROLET"),
  ],
  [
    href("TT87", "LAND ROVER"),
    pickapartvaTestSearch([rover], date, "TT87", "LAND ROVER"),
  ],
  [href("TT87", "TOYOTA"), pickapartvaTestSearch([], date, "TT87", "TOYOTA")],
]);
const catalogUrl = (page: number) =>
  `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=${page}`;

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function serve(rewrite: (url: string, body: string) => string = (_, b) => b) {
  const calls: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      const page = Number(new URL(url).searchParams.get("pagenum"));
      const body = catalog[page - 1] ?? answers.get(url);
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(rewrite(url, body), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return calls;
}
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const emitted: PickapartvaCanonicalVehicle[] = [];
afterEach(() => {
  emitted.splice(0);
});
const chunk = (startCursor?: PickapartvaCursor, maxPages = 15) =>
  Effect.runPromise(
    streamPickapartvaInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            emitted.push(...batch);
          }),
        startCursor,
        maxPages,
      },
      gate,
    ),
  );
const durable = (result: PickapartvaStreamResult) =>
  parseDurableSourceCursor(
    "pickapartva",
    serializeDurableSourceCursor(result.cursor),
  );

test("Pick-A-Part VA plans, searches and publishes a date set past the search cap in separate chunks, from the capped yard search, an empty yard and make searches", async () => {
  // The census plans the searches and stops before its closing reads.
  const planCalls = serve();
  const planned = await chunk();
  expect(planCalls).toEqual([1, 2, 3].map(catalogUrl));
  expect(planned).toMatchObject({ status: "paused", count: 0 });
  if (planned.cursor.phase !== "searches")
    throw new Error("Expected a search checkpoint");
  expect(planned.cursor.recoveries).toMatchObject([
    {
      date,
      slots: 1,
      pending: [
        { id: "TT87", make: "ANY" },
        { id: "UU81", make: "ANY" },
      ],
    },
  ]);
  // The searches stop at the make that lists the hidden donor.
  const searchCalls = serve();
  const searched = await chunk(durable(planned));
  expect(searchCalls).toEqual([
    href("TT87"),
    href("UU81"),
    href("TT87", "FORD"),
    href("TT87", "CHEVROLET"),
    href("TT87", "LAND ROVER"),
  ]);
  expect(searched).toMatchObject({ status: "paused", count: 0 });
  // The next census reads the catalog again and publishes.
  const censusCalls = serve();
  const result = await chunk(durable(searched));
  expect(censusCalls).toEqual([1, 2, 3, 1, 2, 3].map(catalogUrl));
  expect(result).toMatchObject({
    status: "complete",
    count: 1010,
    accounting: { recordsProcessed: 1010, duplicateVehicles: 0 },
  });
  expect(emitted).toHaveLength(1010);
  expect(emitted.find((vehicle) => vehicle.vin === rover.vin)).toMatchObject({
    make: "Land Rover",
    locationCode: "TT87",
    detailsUrl: `${href("TT87", "LAND ROVER")}#${rover.stock}`,
  });
}, 60_000);

test("Pick-A-Part VA plans a recovery again from a fresh catalog read once it outlived its lifetime", async () => {
  serve();
  const planned = await chunk();
  serve();
  const searched = await chunk(durable(planned));
  if (searched.cursor.phase !== "searches")
    throw new Error("Expected a search checkpoint");
  // The searches outlived their lifetime before the census read again.
  const stale: PickapartvaCursor = {
    ...searched.cursor,
    recoveries: searched.cursor.recoveries.map((recovery) => ({
      ...recovery,
      startedAt: Date.now() - PICKAPARTVA_RECOVERY_LIFETIME_MS - 60_000,
    })),
  };
  const staleCalls = serve();
  const replanned = await chunk(stale);
  expect(staleCalls).toEqual([1, 2, 3].map(catalogUrl));
  expect(replanned.status).toBe("paused");
  if (replanned.cursor.phase !== "searches")
    throw new Error("Expected a search checkpoint");
  expect(replanned.cursor).toMatchObject({ replans: 1 });
  expect(replanned.cursor.recoveries[0]).toMatchObject({
    searches: [],
    hidden: [],
  });
  expect(emitted).toHaveLength(0);
}, 60_000);

test("Pick-A-Part VA reads the catalog again instead of searching for a recovery that outlived its lifetime", async () => {
  serve();
  const planned = await chunk();
  if (planned.cursor.phase !== "searches")
    throw new Error("Expected a search checkpoint");
  const stale: PickapartvaCursor = {
    ...planned.cursor,
    recoveries: planned.cursor.recoveries.map((recovery) => ({
      ...recovery,
      startedAt: Date.now() - PICKAPARTVA_RECOVERY_LIFETIME_MS - 60_000,
    })),
  };
  const calls = serve();
  const replanned = await chunk(stale);
  expect(calls).toEqual([1, 2, 3].map(catalogUrl));
  expect(replanned.cursor).toMatchObject({ phase: "searches", replans: 1 });
}, 60_000);

test("Pick-A-Part VA stops planning set-date searches again when every catalog read orders a tie date differently", async () => {
  // Every second read shows the hidden LAND ROVER in page 1's last slot and
  // hides the donor that held it.
  const swapped = [
    pickapartvaTestPage([...sameDay.slice(0, 499), rover], 1, 3),
    pickapartvaTestPage(
      [rover, ...sameDay.slice(500), ...older.slice(0, 399)],
      2,
      3,
    ),
  ];
  let reads = 0;
  serve((url, body) => {
    const page = Number(new URL(url).searchParams.get("pagenum"));
    if (page === 1) reads++;
    return reads % 2 === 0 ? (swapped[page - 1] ?? body) : body;
  });
  let cursor: PickapartvaCursor | undefined;
  let refused: unknown = null;
  let chunks = 0;
  while (refused === null && chunks < 20) {
    chunks++;
    const result = await chunk(cursor).then(
      (value) => value,
      (error: unknown) => {
        refused = error;
        return null;
      },
    );
    if (result) cursor = durable(result);
  }
  // Four censuses, each but the last followed by one search chunk.
  expect(chunks).toBe(7);
  expect(reads).toBe(4);
  expect(String(refused)).toContain(
    `planned its set-date searches again 3 times and the catalog still does not match them: ${date} (shown donors or repeated slots changed)`,
  );
  expect(validationRejectionKind(refused)).toBe("transient");
  expect(emitted).toHaveLength(0);
}, 60_000);

test("Pick-A-Part VA fails a recovered donor whose VIN the catalog already showed for that date under another stock", async () => {
  const [first, ...rest] = fords;
  if (!first) throw new Error("Expected a FORD donor");
  const restocked = { ...first, cardId: "PAP999999", stock: "PAP999999" };
  serve((url, body) =>
    url === href("TT87", "FORD")
      ? pickapartvaTestSearch([restocked, ...rest], date, "TT87", "FORD")
      : body,
  );
  const planned = await chunk();
  const searched = await chunk(durable(planned));
  const refused = await chunk(durable(searched)).then(
    () => null,
    (error: unknown) => error,
  );
  expect(String(refused)).toContain(
    `recovered donor PAP999999 for ${date} has the VIN or stock of a donor the catalog showed for that date`,
  );
  expect(validationRejectionKind(refused)).toBe("deterministic");
  expect(emitted).toHaveLength(0);
}, 60_000);

test("Pick-A-Part VA refuses to resume an emission whose recoveries outlived their lifetime", async () => {
  serve();
  const planned = await chunk();
  serve();
  const searched = await chunk(durable(planned));
  serve();
  const partial = await chunk(durable(searched), 1);
  if (partial.cursor.phase !== "pages")
    throw new Error("Expected an emission checkpoint");
  const stale: PickapartvaCursor = {
    ...partial.cursor,
    recoveries: partial.cursor.recoveries.map((recovery) => ({
      ...recovery,
      startedAt: Date.now() - PICKAPARTVA_RECOVERY_LIFETIME_MS - 60_000,
    })),
  };
  const before = emitted.length;
  serve();
  const refused = await chunk(stale).then(
    () => null,
    (error: unknown) => error,
  );
  expect(String(refused)).toContain(
    `resume snapshot: The checkpointed census's set-date searches no longer answer for the catalog: ${date} (searches older than 60 minutes)`,
  );
  // A fresh crawl from the start cursor can pass, so the day's attempts
  // continue.
  expect(validationRejectionKind(refused)).toBe("transient");
  expect(emitted).toHaveLength(before);
  serve();
  const resumed = await chunk(durable(partial));
  expect(resumed.status).toBe("complete");
  expect(new Set(emitted.map((vehicle) => vehicle.vin)).size).toBe(1010);
}, 60_000);

/** A recovery whose hidden donor is listed by the last of many makes. */
const manyMakes = Array.from(
  { length: 40 },
  (_, index) => `M${String(index).padStart(2, "0")}`,
);
async function pendingMakes() {
  const last = donor(900, { make: "M39", model: "SEDAN" });
  const answer = (make: string) =>
    pickapartvaTestSearch(make === "M39" ? [last] : [], date, "TT87", make);
  for (const make of manyMakes) answers.set(href("TT87", make), answer(make));
  serve((url, body) =>
    url === href("TT87")
      ? pickapartvaTestSearch(
          sameDay.slice(0, 500),
          date,
          "TT87",
          "ANY",
          manyMakes,
        )
      : body,
  );
  const planned = await chunk();
  const searched = await chunk(durable(planned));
  // Keep the capped yard and empty Stafford searches, with every make
  // pending.
  if (searched.cursor.phase !== "searches")
    throw new Error("Expected a search checkpoint");
  const [recovery] = searched.cursor.recoveries;
  if (!recovery) throw new Error("Expected a recovery");
  return {
    ...searched.cursor,
    recoveries: [
      {
        ...recovery,
        searches: recovery.searches.slice(0, 2),
        pending: manyMakes.map((make) => ({ id: "TT87" as const, make })),
        hidden: [],
      },
    ],
  } satisfies PickapartvaCursor;
}
const queuedChunk = (
  startCursor: PickapartvaCursor,
  turnWaitMs: (turn: number) => number,
) =>
  runWithQueuedHost(
    Effect.zipRight(
      TestClock.setTime(
        startCursor.phase === "searches"
          ? (startCursor.recoveries[0]?.startedAt ?? 0)
          : 0,
      ),
      Effect.suspend(() =>
        streamPickapartvaInventoryWithRequestGate(
          { onBatch: () => Effect.void, startCursor },
          gate,
        ),
      ),
    ),
    { turnWaitMs },
  );
const searchedMakes = (cursor: PickapartvaCursor) =>
  cursor.phase === "searches"
    ? cursor.recoveries.flatMap((recovery) =>
        recovery.searches
          .map((entry) => entry.make)
          .filter((make) => make !== "ANY"),
      )
    : [];

test("Pick-A-Part VA starts no set-date search after the chunk's soft stop and resumes at the next one", async () => {
  const pending = await pendingMakes();
  // Each search waits 10 s for its own shared URG turn.
  const calls = serve();
  const first = await queuedChunk(pending, () => 10_000);
  if (Either.isLeft(first.result)) throw first.result.left;
  expect(first.result.right).toMatchObject({ status: "paused", count: 0 });
  const done = searchedMakes(first.result.right.cursor);
  expect(done.length).toBeGreaterThan(1);
  expect(done.length).toBeLessThan(manyMakes.length);
  expect(done).toEqual(manyMakes.slice(0, done.length));
  expect(calls).toEqual(done.map((make) => href("TT87", make)));
  expect(first.requests.at(-1)?.startedAt).toBeLessThan(
    PICKAPARTVA_SEARCH_CHUNK_SOFT_MS + 15_000,
  );
  expect(first.elapsedMs).toBeLessThan(
    PICKAPARTVA_SEARCH_CHUNK_SOFT_MS + 30_000,
  );
  const resumedCalls = serve();
  const resumed = await queuedChunk(first.result.right.cursor, () => 10_000);
  if (Either.isLeft(resumed.result)) throw resumed.result.left;
  expect(resumedCalls[0]).toBe(href("TT87", manyMakes[done.length] ?? ""));
  expect(searchedMakes(resumed.result.right.cursor)).toEqual(
    manyMakes.slice(0, done.length + resumedCalls.length),
  );
}, 60_000);

test("Pick-A-Part VA checkpoints the set-date searches done before a deferred shared host turn", async () => {
  const pending = await pendingMakes();
  // The fourth turn cannot arrive before the chunk's turn horizon.
  const calls = serve();
  const late = await queuedChunk(pending, (turn) =>
    turn < 3 ? 1_000 : 400_000,
  );
  if (Either.isLeft(late.result)) throw late.result.left;
  expect(late.result.right.status).toBe("paused");
  expect(searchedMakes(late.result.right.cursor)).toEqual(
    manyMakes.slice(0, 3),
  );
  expect(calls).toEqual(
    manyMakes.slice(0, 3).map((make) => href("TT87", make)),
  );
  // Before any search the deferral defers the whole chunk.
  const none = serve();
  const deferred = await queuedChunk(pending, () => 400_000);
  expect(Either.isLeft(deferred.result) && deferred.result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(none).toEqual([]);
}, 60_000);
