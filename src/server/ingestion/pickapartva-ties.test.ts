import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { Effect, Either, TestClock } from "effect";
import { z } from "zod";
import { connectorChunkMetrics } from "./connector-chunk";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  PICKAPARTVA_MAKE_CHUNK_SOFT_MS,
  PICKAPARTVA_MAKE_SPLIT_LIFETIME_MS,
  streamPickapartvaInventoryWithRequestGate,
} from "./pickapartva-connector";
import {
  PickapartvaCursorSchema,
  type PickapartvaCursor,
} from "./pickapartva-cursor";
import { pickapartvaDivs } from "./pickapartva-html";
import {
  parsePickapartvaPage,
  parsePickapartvaSearch,
  type PickapartvaRecord,
} from "./pickapartva-parser";
import { buildPickapartvaSnapshot } from "./pickapartva-snapshot";
import { validationRejectionKind } from "./ingestion-validation";
import {
  pickapartvaTestCard,
  pickapartvaTestRecord,
} from "./pickapartva-test-fixtures";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
import { ProviderTurnDeferred } from "./provider-chunk-clock";
import { runWithQueuedHost } from "./provider-host-test-support";
import {
  pickapartvaSearchTarget,
  pickapartvaSearchUrl,
  type PickapartvaSearchScope,
  type PickapartvaYardCode,
} from "./pickapartva-yard-metadata";

// The November 12, 2026 census (15 catalog pages, then closing reads of pages
// 1, 2 and 15) and the live November 19 native search for 2026-10-16. See
// pickapartva-test-fixtures/README.md.
const saved = z
  .array(z.object({ url: z.string(), body: z.string() }).strict())
  .length(19)
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./pickapartva-test-fixtures/census-2026-11-12.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
const catalog = saved.slice(0, 15);
const closings = new Map(
  saved.slice(15, 18).map((response) => [response.url, response.body]),
);
const captured = saved[18]?.body ?? "";
const searchUrl = (date: string, id: PickapartvaSearchScope = "ANY") =>
  `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=${id}&search=${date}`;

// The live November 21 searches for 2026-11-18: the unfiltered search capped
// at 500 cards, then the Fredericksburg and Stafford searches.
const live = z
  .array(z.object({ url: z.string(), body: z.string() }).strict())
  .length(3)
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./pickapartva-test-fixtures/searches-2026-11-18.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
const liveSearch = (raw: string, id?: PickapartvaYardCode) => {
  const result = parsePickapartvaSearch(raw, "2026-11-18", id);
  if (result.status !== "complete")
    throw new Error("Expected a complete native search");
  return result.page;
};

/** Each catalog card wrapper, with the donor parsed from it. */
const wrapped = (html: string) =>
  pickapartvaDivs(html, "iis-uPull-col-sm-4").map(
    (wrapper) => wrapper.tag + wrapper.body + "</div>",
  );
const censusCards = catalog.flatMap((response, index) => {
  const records = parsePickapartvaPage(response.body, index + 1).records;
  const cards = wrapped(response.body);
  if (cards.length !== records.length)
    throw new Error("Saved catalog card wrappers changed");
  return records.map((record, card) => ({ record, html: cards[card] ?? "" }));
});

/** The captured search page around other donor cards for another date. */
function searchPage(date: string, cards: string[]) {
  const deck = wrapped(captured);
  const first = deck[0] ?? "";
  const last = deck.at(-1) ?? "";
  const start = captured.indexOf(first);
  const end = captured.lastIndexOf(last) + last.length;
  const form = (html: string) =>
    html.replaceAll('value="2026-10-16"', `value="${date}"`);
  return (
    form(captured.slice(0, start)) +
    cards.join("\n") +
    form(captured.slice(end))
  );
}
/** The captured 2026-10-16 search narrowed to one yard the way the live
 * 2026-11-18 yard searches are: only that yard's cards, `id` in the form and
 * that yard selected. */
function yardPage(
  cards: string[],
  id: PickapartvaYardCode,
  date = "2026-10-16",
) {
  const location = id === "TT87" ? "Fredericksburg" : "Stafford";
  return searchPage(
    date,
    cards.filter((card) => card.includes(`<b>Location: </b> ${location}<`)),
  )
    .replaceAll('name="id" value="ANY"', `name="id" value="${id}"`)
    .replaceAll(
      'name="yardID" value="ANY" selected',
      'name="yardID" value="ANY"',
    )
    .replaceAll(
      `name="yardID" id="" value="${id}"`,
      `name="yardID" id="" value="${id}" selected`,
    );
}
/** The captured 2026-10-16 search padded with synthetic donors to the cap. */
const capped = (cards: string[], record = synthetic("2026-10-16", 0)) =>
  searchPage("2026-10-16", [
    ...cards,
    ...Array.from({ length: 500 - cards.length }, (_, index) =>
      hiddenCard({
        ...record,
        cardId: `PAP98${String(index).padStart(4, "0")}`,
        stock: `PAP98${String(index).padStart(4, "0")}`,
        vin: `1FAHP3FN0AW98${String(index).padStart(4, "0")}`,
      }),
    ),
  ]);
const hiddenCard = (record: PickapartvaRecord) =>
  `<div class="iis-uPull-col-sm-4 iis-uPull-col-xs-12 col-equal mb-1">${pickapartvaTestCard(record)}</div>`;
const synthetic = (date: string, index: number): PickapartvaRecord => ({
  ...pickapartvaTestRecord,
  cardId: `PAP99000${index}`,
  stock: `PAP99000${index}`,
  vin: `1FAHP3FN0AW99000${index}`,
  yardCode: index % 2 === 0 ? "TT87" : "UU81",
  setDate: date,
});
// Live November 19 catalog page 8 shows this donor, still set on 2026-10-20,
// although no November 12 page showed it.
const liveTieDonor: PickapartvaRecord = {
  cardId: "PAP174600",
  stock: "PAP174600",
  year: "2005",
  make: "CHEVROLET",
  model: "EQUINOX",
  vin: "2CNDL73F556139813",
  yardCode: "TT87",
  row: "632",
  setDate: "2026-10-20",
  imageUrl: null,
};
/**
 * Only 2026-10-16 has a captured native search. The other repeated dates use
 * the captured page around that census's own cards for the date, plus one
 * donor per repeated card the catalog hid: the real donor above for
 * 2026-10-20 and synthetic PAP99000N donors otherwise.
 */
const hidden: Record<string, PickapartvaRecord[]> = {
  "2026-11-07": [synthetic("2026-11-07", 0)],
  "2026-11-04": [synthetic("2026-11-04", 1)],
  "2026-10-28": [2, 3, 4, 5, 6].map((index) => synthetic("2026-10-28", index)),
  "2026-10-24": [synthetic("2026-10-24", 7)],
  "2026-10-20": [liveTieDonor, synthetic("2026-10-20", 8)],
};
const searches = new Map<string, string>([
  ...Object.entries(hidden).map(([date, records]): [string, string] => {
    const shown = new Map(
      censusCards
        .filter((card) => card.record.setDate === date)
        .map((card) => [card.record.stock, card.html]),
    );
    return [
      searchUrl(date),
      searchPage(date, [...shown.values(), ...records.map(hiddenCard)]),
    ];
  }),
  [searchUrl("2026-10-16"), captured],
  [searchUrl("2026-10-16", "TT87"), yardPage(wrapped(captured), "TT87")],
  [searchUrl("2026-10-16", "UU81"), yardPage(wrapped(captured), "UU81")],
]);
// Absent from every November 12 page, listed by the 2026-10-16 search.
const recoveredOnTie = [
  "4JGBB75E67A214569",
  "4JGBF71E57A196107",
  "3N1BC13E57L420446",
  "2FMDK49C77BB37988",
  "1GKFK13057R222291",
  "1FMEU51KX7UA66223",
  "1GNFK13007J143046",
  "1J8FF48W27D324040",
];
const tieDates = [
  "2026-11-07",
  "2026-11-04",
  "2026-10-28",
  "2026-10-24",
  "2026-10-20",
  "2026-10-16",
];

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function serve(
  rewrite: (url: string, body: string) => string = (_, body) => body,
  extra = new Map<string, string>(),
) {
  const calls: string[] = [];
  const reads = new Map<string, number>();
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(init?.redirect).toBe("manual");
      calls.push(url);
      const read = (reads.get(url) ?? 0) + 1;
      reads.set(url, read);
      const body =
        read > 1
          ? closings.get(url)
          : (catalog.find((response) => response.url === url)?.body ??
            extra.get(url) ??
            searches.get(url));
      if (body === undefined)
        throw new Error("Unexpected unsaved request " + url);
      return new Response(rewrite(url, body), {
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return calls;
}
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const run = (
  onBatch: (batch: PickapartvaCanonicalVehicle[]) => Effect.Effect<void>,
  startCursor?: PickapartvaCursor,
  maxPages = 15,
) =>
  Effect.runPromise(
    streamPickapartvaInventoryWithRequestGate(
      { onBatch, startCursor, maxPages },
      gate,
    ),
  );

test("Pick-A-Part VA recovers donors hidden by catalog Set Date ties before accepting the census", async () => {
  const calls = serve();
  const emitted: PickapartvaCanonicalVehicle[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      emitted.push(...batch);
    }),
  );
  expect(calls).toEqual([
    ...catalog.map((response) => response.url),
    ...tieDates.map((date) => searchUrl(date)),
    ...[1, 2, 15].map(
      (page) =>
        `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=${page}`,
    ),
  ]);
  const vins = new Set(emitted.map((vehicle) => vehicle.vin));
  expect(vins.size).toBe(emitted.length);
  for (const vin of [...recoveredOnTie, liveTieDonor.vin])
    expect(vins.has(vin)).toBe(true);
  expect(
    emitted.find((vehicle) => vehicle.vin === "1GNFK13007J143046"),
  ).toMatchObject({
    stockNumber: "STK126182",
    locationCode: "UU81",
    availableDate: "2026-10-16T00:00:00.000Z",
    detailsUrl:
      "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&search=2026-10-16#STK126182",
  });
  // 7,449 catalog slots: 7,422 donors shown once, 7 invalid VINs and 20
  // repeats. 18 repeats stood in for hidden donors; 2 are distinct cards of
  // VINs the catalog lists twice.
  expect(result).toMatchObject({
    status: "complete",
    count: 7440,
    pagesProcessed: 15,
    accounting: {
      recordsProcessed: 7449,
      recordsRejected: 7,
      duplicateVehicles: 2,
    },
  });
  expect(connectorChunkMetrics(result, emitted.length)).toEqual({
    vehiclesProcessed: 7449,
    uniqueVehicles: 7440,
    duplicateVehicles: 2,
    rejectedVehicles: 7,
  });
}, 60_000);

test("Pick-A-Part VA resumes a tie-recovered census only against the same searches", async () => {
  serve();
  const emitted: string[] = [];
  const onBatch = (batch: PickapartvaCanonicalVehicle[]) =>
    Effect.sync(() => {
      emitted.push(...batch.map((vehicle) => vehicle.vin));
    });
  const first = await run(onBatch, undefined, 8);
  expect(first.status).toBe("paused");
  if (first.cursor.phase !== "pages")
    throw new Error("Expected a paused checkpoint");
  expect(first.cursor.searches.map((search) => search.date)).toEqual(tieDates);
  const cursor = parseDurableSourceCursor(
    "pickapartva",
    serializeDurableSourceCursor(first.cursor),
  );
  serve();
  const second = await run(onBatch, cursor);
  expect(second.status).toBe("complete");
  expect(emitted).toHaveLength(7440);
  expect(new Set(emitted).size).toBe(7440);
  // A checkpoint whose searches differ from its fingerprint is refused.
  expect(
    PickapartvaCursorSchema.safeParse({
      ...first.cursor,
      searches: first.cursor.searches.slice(1),
    }).success,
  ).toBe(false);
  // A resumed chunk whose rebuilt search lists different card details stops
  // before any callback.
  serve((url, body) =>
    url === searchUrl("2026-10-16")
      ? body.replace("<b>Row: </b> 418<br/>", "<b>Row: </b> 419<br/>")
      : body,
  );
  let callbacks = 0;
  await expect(
    run(
      () =>
        Effect.sync(() => {
          callbacks++;
        }),
      cursor,
    ),
  ).rejects.toThrow("resume snapshot");
  expect(callbacks).toBe(0);
}, 60_000);

const firstCard = /<b>Set Date: <\/b> 2026-10-16<br\/>/;
test.each<[string, (body: string) => string, string]>([
  [
    "another Set Date",
    (body) => body.replace(firstCard, "<b>Set Date: </b> 2026-10-15<br/>"),
    "set on another date",
  ],
  [
    "a continuation",
    (body) =>
      body.replace(
        /(iis-upull-toolbar-pagination[^>]*>)/,
        '$1<ul class="pagination"><li class="page-item active"><a class="page-link" href="/inventory/ANY/ANY/?k=1&amp;id=ANY&amp;pagenum=1">1</a></li></ul>',
      ),
    "continuation",
  ],
  [
    "another search term",
    (body) => body.replaceAll('value="2026-10-16"', 'value="2026-10"'),
    "inventory form is filtered",
  ],
  [
    "a hidden donor missing",
    (body) =>
      searchPage(
        "2026-10-16",
        wrapped(body).filter((card) => !card.includes("1GNFK13007J143046")),
      ),
    "adds 7 donors, but the catalog repeated 8",
  ],
  [
    "an extra unseen donor",
    (body) =>
      searchPage("2026-10-16", [
        ...wrapped(body),
        hiddenCard(synthetic("2026-10-16", 9)),
      ]),
    "adds 9 donors, but the catalog repeated 8",
  ],
])(
  "Pick-A-Part VA fails closed when a set-date search has %s",
  async (kind, change, message) => {
    serve((url, body) =>
      url === searchUrl("2026-10-16") ? change(body) : body,
    );
    let callbacks = 0;
    const rejection: unknown = await run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ).catch((error: unknown) => error);
    expect(() => {
      throw rejection;
    }).toThrow(message);
    expect(callbacks).toBe(0);
    // Donors that differ between the catalog and its search mean the
    // inventory changed while it was read, so a crawl later today can pass.
    expect(validationRejectionKind(rejection)).toBe(
      kind === "a hidden donor missing" || kind === "an extra unseen donor"
        ? "transient"
        : "deterministic",
    );
  },
  60_000,
);

test("Pick-A-Part VA splits a capped set-date search by physical yard", async () => {
  const calls = serve((url, body) =>
    url === searchUrl("2026-10-16") ? capped(wrapped(body)) : body,
  );
  const emitted: PickapartvaCanonicalVehicle[] = [];
  const onBatch = (batch: PickapartvaCanonicalVehicle[]) =>
    Effect.sync(() => {
      emitted.push(...batch);
    });
  const first = await run(onBatch, undefined, 8);
  expect(calls).toEqual([
    ...catalog.map((response) => response.url),
    ...tieDates.map((date) => searchUrl(date)),
    searchUrl("2026-10-16", "TT87"),
    searchUrl("2026-10-16", "UU81"),
    ...[1, 2, 15].map(
      (page) =>
        `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=${page}`,
    ),
  ]);
  if (first.cursor.phase !== "pages")
    throw new Error("Expected a paused checkpoint");
  expect(first.cursor.searches.map((search) => search.url)).toEqual([
    ...tieDates.slice(0, -1).map((date) => searchUrl(date)),
    searchUrl("2026-10-16", "TT87"),
    searchUrl("2026-10-16", "UU81"),
  ]);
  // A checkpoint that keeps only one yard of a split date is refused.
  expect(
    PickapartvaCursorSchema.safeParse({
      ...first.cursor,
      searches: first.cursor.searches.slice(0, -1),
    }).success,
  ).toBe(false);
  serve((url, body) =>
    url === searchUrl("2026-10-16") ? capped(wrapped(body)) : body,
  );
  const second = await run(
    onBatch,
    parseDurableSourceCursor(
      "pickapartva",
      serializeDurableSourceCursor(first.cursor),
    ),
  );
  expect(second.status).toBe("complete");
  const vins = new Set(emitted.map((vehicle) => vehicle.vin));
  expect(emitted).toHaveLength(7440);
  expect(vins.size).toBe(7440);
  for (const vin of [...recoveredOnTie, liveTieDonor.vin])
    expect(vins.has(vin)).toBe(true);
  // A donor recovered by a yard search links to that yard's search.
  expect(
    emitted.find((vehicle) => vehicle.vin === "1GNFK13007J143046"),
  ).toMatchObject({
    locationCode: "UU81",
    detailsUrl:
      "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=UU81&search=2026-10-16#STK126182",
  });
}, 60_000);

test("Pick-A-Part VA searches by yard without the unfiltered search when the catalog already shows a full search page of a date", async () => {
  // Page 1 recast so every card is set on 2026-11-07, as the live catalog
  // showed 578 donors set on 2026-11-18 across pages 1 and 2. The 2026-11-09
  // donors move to Stafford so each yard stays under one search page.
  const recast = (card: string) =>
    (card.includes("<b>Set Date: </b> 2026-11-09<")
      ? card.replace(
          "<b>Location: </b> Fredericksburg<",
          "<b>Location: </b> Stafford<",
        )
      : card
    ).replace(
      /<b>Set Date: <\/b> 2026-11-(?:08|09|10|11)<br\/>/,
      "<b>Set Date: </b> 2026-11-07<br/>",
    );
  const bulk = (url: string, body: string) =>
    url === catalog[0]?.url
      ? wrapped(body).reduce(
          (html, card) => html.replace(card, recast(card)),
          body,
        )
      : body;
  const shown = [
    ...new Set(
      catalog
        .slice(0, 2)
        .flatMap((response) => wrapped(bulk(response.url, response.body)))
        .filter((card) => card.includes("<b>Set Date: </b> 2026-11-07<")),
    ),
  ];
  expect(shown.length).toBeGreaterThanOrEqual(500);
  const cards = [...shown, ...(hidden["2026-11-07"] ?? []).map(hiddenCard)];
  const calls = serve(
    bulk,
    new Map([
      [searchUrl("2026-11-07"), searchPage("2026-11-07", cards.slice(0, 500))],
      [searchUrl("2026-11-07", "TT87"), yardPage(cards, "TT87", "2026-11-07")],
      [searchUrl("2026-11-07", "UU81"), yardPage(cards, "UU81", "2026-11-07")],
    ]),
  );
  const emitted: string[] = [];
  const result = await run((batch) =>
    Effect.sync(() => {
      emitted.push(...batch.map((vehicle) => vehicle.vin));
    }),
  );
  // The unfiltered search would be capped, so the census spends one extra
  // search on this date instead of two.
  expect(calls).toEqual([
    ...catalog.map((response) => response.url),
    searchUrl("2026-11-07", "TT87"),
    searchUrl("2026-11-07", "UU81"),
    ...tieDates.slice(1).map((date) => searchUrl(date)),
    ...[1, 2, 15].map(
      (page) =>
        `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=${page}`,
    ),
  ]);
  expect(result.status).toBe("complete");
  expect(new Set(emitted).size).toBe(7440);
}, 60_000);

// The live November 22 searches for 2026-11-16 in Fredericksburg: the yard
// search capped at 500 cards, then the FORD, LAND ROVER and empty DE SOTO
// make searches.
const makeLive = z
  .array(z.object({ url: z.string(), body: z.string() }).strict())
  .length(4)
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL(
            "./pickapartva-test-fixtures/make-searches-2026-11-16.json.br",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
const emptyMakeSearch = makeLive[3]?.body ?? "";
const nativeMakes = parsePickapartvaPage(catalog[0]?.body ?? "", 1).makes;
type Card = { html: string; record: PickapartvaRecord };
const cardsOf = (html: string, date = "2026-10-16"): Card[] => {
  const result = parsePickapartvaSearch(html, date);
  if (result.status !== "complete")
    throw new Error("Expected a complete native search");
  return wrapped(html).map((card, index) => {
    const record = result.page.records[index];
    if (!record) throw new Error("Saved search card wrappers changed");
    return { html: card, record };
  });
};
/**
 * Fredericksburg's 2026-10-16 donors: the captured search's, plus the ones
 * the November 12 catalog shows that were gone by the November 19 capture,
 * so the make searches answer for the same inventory as the catalog.
 */
const fredericksburg: Card[] = (() => {
  const listed = cardsOf(captured).filter(
    (card) => card.record.yardCode === "TT87",
  );
  const stocks = new Set(listed.map((card) => card.record.stock));
  for (const card of censusCards)
    if (
      card.record.setDate === "2026-10-16" &&
      card.record.yardCode === "TT87" &&
      !stocks.has(card.record.stock)
    ) {
      stocks.add(card.record.stock);
      listed.push(card);
    }
  return listed;
})();
const makeUrl = (make: string, date = "2026-10-16") =>
  `https://pickapartva.com/inventory/${make.replaceAll(" ", "_")}/ANY/?k=1&id=TT87&search=${date}`;
/** The captured Fredericksburg search narrowed to one make the way the live
 * 2026-11-16 make searches are, or the live empty answer for that make. Like
 * the live 2026-11-21 DATSUN search, DATSUN answers with the NISSAN donors. */
function makePage(make: string, cards = fredericksburg) {
  const path = make.replaceAll(" ", "_");
  const listed = cards
    .filter(
      (card) => card.record.make === (make === "DATSUN" ? "NISSAN" : make),
    )
    .map((card) => card.html);
  return listed.length
    ? yardPage(listed, "TT87")
        .replaceAll(
          'action="/inventory/ANY/ANY/"',
          `action="/inventory/${path}/ANY/"`,
        )
        .replace('var setMake = "ANY"', `var setMake = "${path}"`)
        .replaceAll('var urgID = "ANY"', 'var urgID = "TT87"')
    : emptyMakeSearch.replace(
        'var setMake = "DE_SOTO"',
        `var setMake = "${path}"`,
      );
}
const makePages = new Map(
  nativeMakes.map((make) => [makeUrl(make), makePage(make)]),
);
/** Both the unfiltered and the Fredericksburg 2026-10-16 searches capped. */
const cappedYard = (url: string, body: string) =>
  url === searchUrl("2026-10-16")
    ? capped(wrapped(body))
    : url === searchUrl("2026-10-16", "TT87")
      ? yardPage(
          wrapped(capped(fredericksburg.map((card) => card.html))),
          "TT87",
        )
      : body;
/** Fredericksburg FORD FOCUS donors set on 2026-10-16 that no catalog page
 * shows. */
const padding = (count: number): Card[] =>
  Array.from({ length: count }, (_, index) => {
    const id = `PAP97${String(index).padStart(4, "0")}`;
    const record = {
      ...synthetic("2026-10-16", 0),
      cardId: id,
      stock: id,
      vin: `1FAHP3FN0AW97${String(index).padStart(4, "0")}`,
    };
    return { html: hiddenCard(record), record };
  });

test("Pick-A-Part VA splits a still-capped yard search by make across checkpointed chunks", async () => {
  const emitted: PickapartvaCanonicalVehicle[] = [];
  const onBatch = (batch: PickapartvaCanonicalVehicle[]) =>
    Effect.sync(() => {
      emitted.push(...batch);
    });
  // The census stops at the capped yard search and checkpoints the split.
  const calls = serve(cappedYard, makePages);
  const first = await run(onBatch);
  expect(calls).toEqual([
    ...catalog.map((response) => response.url),
    ...tieDates.map((date) => searchUrl(date)),
    searchUrl("2026-10-16", "TT87"),
  ]);
  expect(emitted).toHaveLength(0);
  expect(first).toMatchObject({ status: "paused", count: 0 });
  if (first.cursor.phase !== "makes") throw new Error("Expected a make split");
  expect(first.cursor.partitions).toEqual([
    {
      date: "2026-10-16",
      id: "TT87",
      makes: nativeMakes,
      searches: [],
      startedAt: expect.any(Number),
    },
  ]);
  expect(nativeMakes).toHaveLength(62);
  // The make searches resume from a checkpoint taken between them.
  const split = first.cursor.partitions[0];
  if (!split) throw new Error("Expected a make split");
  const makeCalls = serve(cappedYard, makePages);
  const searched = await run(
    onBatch,
    parseDurableSourceCursor(
      "pickapartva",
      serializeDurableSourceCursor(first.cursor),
    ),
  );
  expect(makeCalls).toEqual(nativeMakes.map((make) => makeUrl(make)));
  if (searched.cursor.phase !== "makes")
    throw new Error("Expected a make split");
  const partial: PickapartvaCursor = {
    ...searched.cursor,
    partitions: searched.cursor.partitions.map((entry) => ({
      ...entry,
      searches: entry.searches.slice(0, 20),
    })),
  };
  const resumedCalls = serve(cappedYard, makePages);
  const resumed = await run(
    onBatch,
    parseDurableSourceCursor(
      "pickapartva",
      serializeDurableSourceCursor(partial),
    ),
  );
  expect(resumedCalls).toEqual(
    nativeMakes.slice(20).map((make) => makeUrl(make)),
  );
  expect(resumed.cursor).toEqual(searched.cursor);
  expect(emitted).toHaveLength(0);
  // A checkpoint whose saved make donors changed is refused.
  expect(
    PickapartvaCursorSchema.safeParse({
      ...searched.cursor,
      partitions: searched.cursor.partitions.map((entry) => ({
        ...entry,
        searches: entry.searches.map((search) => ({
          ...search,
          records: search.records.map((record) => ({ ...record, row: "1" })),
        })),
      })),
    }).success,
  ).toBe(false);
  // The census reads again with the split instead of the capped searches.
  const censusCalls = serve(cappedYard, makePages);
  const census = await run(
    onBatch,
    parseDurableSourceCursor(
      "pickapartva",
      serializeDurableSourceCursor(searched.cursor),
    ),
    8,
  );
  expect(censusCalls).toEqual([
    ...catalog.map((response) => response.url),
    ...tieDates.slice(0, -1).map((date) => searchUrl(date)),
    searchUrl("2026-10-16", "UU81"),
    ...[1, 2, 15].map(
      (page) =>
        `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=${page}`,
    ),
  ]);
  if (census.cursor.phase !== "pages")
    throw new Error("Expected a paused checkpoint");
  expect(census.cursor.searches.map((search) => search.url)).toEqual([
    ...tieDates.slice(0, -1).map((date) => searchUrl(date)),
    ...nativeMakes.map((make) => makeUrl(make)),
    searchUrl("2026-10-16", "UU81"),
  ]);
  serve(cappedYard, makePages);
  const last = await run(
    onBatch,
    parseDurableSourceCursor(
      "pickapartva",
      serializeDurableSourceCursor(census.cursor),
    ),
  );
  expect(last.status).toBe("complete");
  const vins = new Set(emitted.map((vehicle) => vehicle.vin));
  expect(emitted).toHaveLength(7440);
  expect(vins.size).toBe(7440);
  for (const vin of [...recoveredOnTie, liveTieDonor.vin])
    expect(vins.has(vin)).toBe(true);
  // A Fredericksburg donor recovered by a make search links to that search.
  const recovered = emitted.filter(
    (vehicle) =>
      recoveredOnTie.includes(vehicle.vin) && vehicle.locationCode === "TT87",
  );
  expect(recovered.length).toBeGreaterThan(0);
  for (const vehicle of recovered)
    expect(vehicle.detailsUrl).toMatch(
      /^https:\/\/pickapartva\.com\/inventory\/(?!ANY\/)[A-Z0-9_-]+\/ANY\/\?k=1&id=TT87&search=2026-10-16#/,
    );
}, 60_000);

test.each<[string, (url: string, body: string) => string, string]>([
  [
    "is itself capped",
    (url, body) =>
      url === makeUrl("FORD")
        ? makePage(
            "FORD",
            [...fredericksburg, ...padding(500)]
              .filter((card) => card.record.make === "FORD")
              .slice(0, 500),
          )
        : body,
    "FORD search for 2026-10-16 in TT87 returned 500 cards; completeness is only known for 0 to 499 matched donor cards per make",
  ],
  [
    "lists another make",
    (url, body) =>
      url === makeUrl("FORD")
        ? body.replace("Make/Model :</b> FORD ", "Make/Model :</b> CHEVROLET ")
        : body,
    "ignored its selected make FORD",
  ],
  [
    "for DATSUN lists a make outside its NISSAN group",
    (url, body) =>
      url === makeUrl("DATSUN")
        ? body.replace(
            "Make/Model :</b> NISSAN ",
            "Make/Model :</b> CHEVROLET ",
          )
        : body,
    "ignored its selected make DATSUN",
  ],
  [
    "answers for another make",
    (url, body) =>
      url === makeUrl("FORD")
        ? body.replace('var setMake = "FORD"', 'var setMake = "ANY"')
        : body,
    "does not prove its selected make FORD and yard TT87",
  ],
  [
    "answers for another yard",
    (url, body) =>
      url === makeUrl("DE SOTO")
        ? body.replaceAll('var urgID = "TT87"', 'var urgID = "UU81"')
        : body,
    "does not prove its selected make DE SOTO and yard TT87",
  ],
])(
  "Pick-A-Part VA fails closed when a make search %s",
  async (_kind, change, message) => {
    serve(cappedYard, makePages);
    const first = await run(() => Effect.void);
    serve((url, body) => change(url, cappedYard(url, body)), makePages);
    let callbacks = 0;
    await expect(
      run(
        () =>
          Effect.sync(() => {
            callbacks++;
          }),
        first.cursor,
      ),
    ).rejects.toThrow(message);
    expect(callbacks).toBe(0);
  },
  60_000,
);

test("Pick-A-Part VA fails closed when the make searches omit a donor the catalog shows", async () => {
  // A Fredericksburg 2026-10-16 donor the catalog shows, absent from its
  // make search, so the make totals cannot reconcile.
  const shown = censusCards.find(
    (card) =>
      card.record.setDate === "2026-10-16" &&
      card.record.yardCode === "TT87" &&
      nativeMakes.includes(card.record.make),
  );
  if (!shown) throw new Error("Expected a shown Fredericksburg donor");
  const url = makeUrl(shown.record.make);
  const omitted = new Map(makePages).set(
    url,
    makePage(
      shown.record.make,
      fredericksburg.filter((card) => card.record.stock !== shown.record.stock),
    ),
  );
  serve(cappedYard, omitted);
  const first = await run(() => Effect.void);
  serve(cappedYard, omitted);
  const searched = await run(() => Effect.void, first.cursor);
  serve(cappedYard, omitted);
  let callbacks = 0;
  await expect(
    run(
      () =>
        Effect.sync(() => {
          callbacks++;
        }),
      searched.cursor,
    ),
  ).rejects.toThrow(
    `make searches for 2026-10-16 in TT87 omit 1 donors the catalog shows (first ${shown.record.stock} ${shown.record.make})`,
  );
  expect(callbacks).toBe(0);
}, 60_000);

/** The capped census's checkpoint: the Fredericksburg 2026-10-16 split with
 * no make searched yet. */
async function pendingSplit() {
  serve(cappedYard, makePages);
  const first = await run(() => Effect.void);
  if (first.cursor.phase !== "makes") throw new Error("Expected a make split");
  return first.cursor;
}
/** One chunk from `startCursor` on the test clock, set to when its split
 * started, with shared URG host turns that each wait `turnWaitMs(turn)`. */
const queuedChunk = (
  startCursor: PickapartvaCursor,
  turnWaitMs: (turn: number) => number,
) =>
  runWithQueuedHost(
    Effect.zipRight(
      TestClock.setTime(
        startCursor.phase === "makes"
          ? (startCursor.partitions[0]?.startedAt ?? 0)
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
  cursor.phase === "makes"
    ? cursor.partitions.flatMap((split) =>
        split.searches.map((search) => search.make),
      )
    : [];

test("Pick-A-Part VA starts no make search after the chunk's soft stop and resumes at the next make", async () => {
  const pending = await pendingSplit();
  // Each make search waits 10 s for its own shared URG turn.
  const calls = serve(cappedYard, makePages);
  const chunk = await queuedChunk(pending, () => 10_000);
  if (Either.isLeft(chunk.result)) throw chunk.result.left;
  expect(chunk.result.right).toMatchObject({ status: "paused", count: 0 });
  const done = searchedMakes(chunk.result.right.cursor);
  expect(done.length).toBeGreaterThan(1);
  expect(done.length).toBeLessThan(nativeMakes.length);
  expect(done).toEqual(nativeMakes.slice(0, done.length));
  expect(calls).toEqual(done.map((make) => makeUrl(make)));
  // The last make search was started before the soft stop and only waited
  // for its turn and the host gap, and the chunk ended long before its
  // 340-second turn horizon.
  expect(chunk.requests.at(-1)?.startedAt).toBeLessThan(
    PICKAPARTVA_MAKE_CHUNK_SOFT_MS + 15_000,
  );
  expect(chunk.elapsedMs).toBeLessThan(PICKAPARTVA_MAKE_CHUNK_SOFT_MS + 30_000);
  const resumedCalls = serve(cappedYard, makePages);
  const resumed = await queuedChunk(chunk.result.right.cursor, () => 10_000);
  if (Either.isLeft(resumed.result)) throw resumed.result.left;
  expect(resumedCalls[0]).toBe(makeUrl(nativeMakes[done.length] ?? ""));
  expect(searchedMakes(resumed.result.right.cursor)).toEqual(
    nativeMakes.slice(0, done.length + resumedCalls.length),
  );
}, 60_000);

test("Pick-A-Part VA checkpoints the make searches done before a deferred shared host turn", async () => {
  const pending = await pendingSplit();
  // The fourth turn cannot arrive before the chunk's turn horizon.
  const calls = serve(cappedYard, makePages);
  const late = await queuedChunk(pending, (turn) =>
    turn < 3 ? 1_000 : 400_000,
  );
  if (Either.isLeft(late.result)) throw late.result.left;
  expect(late.result.right.status).toBe("paused");
  expect(searchedMakes(late.result.right.cursor)).toEqual(
    nativeMakes.slice(0, 3),
  );
  expect(calls).toEqual(nativeMakes.slice(0, 3).map((make) => makeUrl(make)));
  // Before any make search the deferral defers the whole chunk.
  const none = serve(cappedYard, makePages);
  const deferred = await queuedChunk(pending, () => 400_000);
  expect(Either.isLeft(deferred.result) && deferred.result.left).toBeInstanceOf(
    ProviderTurnDeferred,
  );
  expect(none).toEqual([]);
}, 60_000);

test.each([
  ["older than its lifetime", -PICKAPARTVA_MAKE_SPLIT_LIFETIME_MS - 60_000],
  ["dated in the future", 60_000],
])(
  "Pick-A-Part VA refuses a make split checkpoint %s",
  async (_kind, offset) => {
    const pending = await pendingSplit();
    const stale: PickapartvaCursor = {
      ...pending,
      partitions: pending.partitions.map((split) => ({
        ...split,
        startedAt: Date.now() + offset,
      })),
    };
    const calls = serve(cappedYard, makePages);
    await expect(run(() => Effect.void, stale)).rejects.toThrow(
      "make split for 2026-10-16 in TT87 started",
    );
    expect(calls).toEqual([]);
  },
  60_000,
);

test("Pick-A-Part VA refuses a census whose make split no longer covers the native makes, went stale or needs another split", async () => {
  const pending = await pendingSplit();
  serve(cappedYard, makePages);
  const searched = await run(() => Effect.void, pending);
  if (searched.cursor.phase !== "makes")
    throw new Error("Expected a make split");
  let callbacks = 0;
  const count = () =>
    Effect.sync(() => {
      callbacks++;
    });
  // A split without the catalog's last native make proves no donor of it.
  const narrowed: PickapartvaCursor = {
    ...searched.cursor,
    partitions: searched.cursor.partitions.map((split) => ({
      ...split,
      makes: split.makes.slice(0, -1),
      searches: split.searches.slice(0, -1),
    })),
  };
  serve(cappedYard, makePages);
  await expect(run(count, narrowed)).rejects.toThrow(
    "make searches for 2026-10-16 in TT87 do not cover the native make selector's 62 makes",
  );
  serve(cappedYard, makePages);
  const census = await run(() => Effect.void, searched.cursor, 8);
  if (census.cursor.phase !== "pages")
    throw new Error("Expected a paused checkpoint");
  // The make split outlived its lifetime during emission.
  const stale: PickapartvaCursor = {
    ...census.cursor,
    partitions: census.cursor.partitions.map((split) => ({
      ...split,
      startedAt: Date.now() - PICKAPARTVA_MAKE_SPLIT_LIFETIME_MS - 60_000,
    })),
  };
  const staleCalls = serve(cappedYard, makePages);
  await expect(run(count, stale)).rejects.toThrow(
    "make split for 2026-10-16 in TT87 started",
  );
  expect(staleCalls).toEqual([]);
  // Stafford's 2026-10-16 search, complete when the checkpoint was taken,
  // now reaches the cap.
  const stafford = wrapped(captured).filter((card) =>
    card.includes("<b>Location: </b> Stafford<"),
  );
  serve(
    (url, body) =>
      url === searchUrl("2026-10-16", "UU81")
        ? yardPage(
            wrapped(capped(stafford, synthetic("2026-10-16", 1))),
            "UU81",
          )
        : cappedYard(url, body),
    makePages,
  );
  await expect(run(count, census.cursor)).rejects.toThrow(
    "A set-date search the checkpointed census completed is now capped",
  );
  expect(callbacks).toBe(0);
}, 60_000);

test("Pick-A-Part VA reads the live 2026-11-16 Fredericksburg make searches", () => {
  const [yard, ford, landRover, deSoto] = makeLive.map(
    (response) => response.body,
  );
  expect(makeLive.map((response) => response.url)).toEqual([
    searchUrl("2026-11-16", "TT87"),
    makeUrl("FORD", "2026-11-16"),
    makeUrl("LAND ROVER", "2026-11-16"),
    makeUrl("DE SOTO", "2026-11-16"),
  ]);
  const cappedSearch = parsePickapartvaSearch(yard ?? "", "2026-11-16", "TT87");
  expect(cappedSearch).toMatchObject({ status: "capped", cards: 500 });
  if (cappedSearch.status !== "capped") throw new Error("Expected capped");
  expect(cappedSearch.makes).toEqual(nativeMakes);
  const make = (raw: string, name: string) => {
    const result = parsePickapartvaSearch(raw, "2026-11-16", "TT87", name);
    if (result.status !== "complete")
      throw new Error("Expected a complete native search");
    return result.page.records;
  };
  const fords = make(ford ?? "", "FORD");
  expect(fords).toHaveLength(83);
  expect(fords.every((record) => record.make === "FORD")).toBe(true);
  expect(
    make(landRover ?? "", "LAND ROVER").map((record) => record.model),
  ).toEqual(["RANGE ROVER", "RANGE ROVER", "RANGE ROVER SPORT"]);
  expect(make(deSoto ?? "", "DE SOTO")).toEqual([]);
  // A make search never stands in for another make, yard or the whole yard.
  expect(() => make(ford ?? "", "LAND ROVER")).toThrow(
    "does not prove its selected make LAND ROVER",
  );
  expect(() => make(deSoto ?? "", "FORD")).toThrow(
    "does not prove its selected make FORD",
  );
  expect(() =>
    parsePickapartvaSearch(ford ?? "", "2026-11-16", "UU81", "FORD"),
  ).toThrow("narrowed physical scope");
  expect(() =>
    parsePickapartvaSearch(ford ?? "", "2026-11-16", "TT87"),
  ).toThrow("inventory form is filtered");
  expect(() =>
    parsePickapartvaSearch(deSoto ?? "", "2026-11-16", "TT87"),
  ).toThrow("search controls are missing");
});

test("Pick-A-Part VA reads the live 2026-11-21 DATSUN search, which answers with the NISSAN donors, as no DATSUN donors", () => {
  const aliased = z
    .array(z.object({ url: z.string(), body: z.string() }).strict())
    .length(2)
    .parse(
      JSON.parse(
        brotliDecompressSync(
          readFileSync(
            new URL(
              "./pickapartva-test-fixtures/make-alias-2026-11-21.json.br",
              import.meta.url,
            ),
          ),
        ).toString(),
      ),
    );
  expect(aliased.map((response) => response.url)).toEqual([
    makeUrl("DATSUN", "2026-11-21"),
    makeUrl("NISSAN", "2026-11-21"),
  ]);
  const [datsun = "", nissan = ""] = aliased.map((response) => response.body);
  const make = (raw: string, name: string) => {
    const result = parsePickapartvaSearch(raw, "2026-11-21", "TT87", name);
    if (result.status !== "complete")
      throw new Error("Expected a complete native search");
    return result.page.records;
  };
  const nissans = make(nissan, "NISSAN");
  expect(nissans).toHaveLength(47);
  expect(nissans.every((record) => record.make === "NISSAN")).toBe(true);
  expect(make(datsun, "DATSUN")).toEqual([]);
  // A DATSUN search never lists a make outside its NISSAN group, and the
  // NISSAN search still lists only NISSAN donors.
  expect(() =>
    make(
      datsun.replace("Make/Model :</b> NISSAN ", "Make/Model :</b> TOYOTA "),
      "DATSUN",
    ),
  ).toThrow("ignored its selected make DATSUN");
  expect(() =>
    make(
      nissan.replace("Make/Model :</b> NISSAN ", "Make/Model :</b> DATSUN "),
      "NISSAN",
    ),
  ).toThrow("ignored its selected make NISSAN");
  expect(() => make(datsun, "NISSAN")).toThrow(
    "does not prove its selected make NISSAN",
  );
});

test("Pick-A-Part VA reads the live 2026-11-18 searches: the unfiltered search is capped and each yard search is complete", () => {
  const [all, fredericksburg, stafford] = live.map((response) => response.body);
  expect(live.map((response) => response.url)).toEqual([
    searchUrl("2026-11-18"),
    searchUrl("2026-11-18", "TT87"),
    searchUrl("2026-11-18", "UU81"),
  ]);
  expect(parsePickapartvaSearch(all ?? "", "2026-11-18")).toMatchObject({
    status: "capped",
    cards: 500,
  });
  const tt87 = liveSearch(fredericksburg ?? "", "TT87");
  const uu81 = liveSearch(stafford ?? "", "UU81");
  expect(tt87.records).toHaveLength(412);
  expect(uu81.records).toHaveLength(169);
  expect(tt87.records.every((record) => record.yardCode === "TT87")).toBe(true);
  expect(uu81.records.every((record) => record.yardCode === "UU81")).toBe(true);
  // A yard search never stands in for another physical scope.
  expect(() => liveSearch(fredericksburg ?? "")).toThrow(
    "narrowed physical scope",
  );
  expect(() => liveSearch(fredericksburg ?? "", "UU81")).toThrow(
    "narrowed physical scope",
  );
  expect(() =>
    liveSearch(
      (fredericksburg ?? "").replace(
        "<b>Location: </b> Fredericksburg<",
        "<b>Location: </b> Stafford<",
      ),
      "TT87",
    ),
  ).toThrow("outside TT87");
});

test("Pick-A-Part VA fails closed when donors repeat but the catalog is not ordered by Set Date", async () => {
  // The terminal page's first card claims a newer Set Date than the pages
  // before it, so the repeated slots no longer locate the hidden donors.
  const terminal = catalog.at(-1)?.url;
  const calls = serve((url, body) =>
    url === terminal
      ? body.replace(
          /<b>Set Date: <\/b> \d{4}-\d{2}-\d{2}<br\/>/,
          "<b>Set Date: </b> 2026-11-18<br/>",
        )
      : body,
  );
  let callbacks = 0;
  await expect(
    run(() =>
      Effect.sync(() => {
        callbacks++;
      }),
    ),
  ).rejects.toThrow("no longer ordered by Set Date");
  expect(callbacks).toBe(0);
  expect(calls).toEqual(catalog.map((response) => response.url));
}, 60_000);

test("Pick-A-Part VA snapshots refuse searches that do not match the repeated Set Dates", () => {
  const pages = catalog.map((response, index) => ({
    url: response.url,
    page: parsePickapartvaPage(response.body, index + 1),
  }));
  const parsed = (url: string, id?: PickapartvaYardCode) => {
    const body = searches.get(url) ?? "";
    const result = parsePickapartvaSearch(body, "2026-10-16", id);
    if (result.status !== "complete")
      throw new Error("Expected a complete native search");
    return { url, page: result.page };
  };
  const search = parsed(searchUrl("2026-10-16"));
  const tt87 = parsed(searchUrl("2026-10-16", "TT87"), "TT87");
  const uu81 = parsed(searchUrl("2026-10-16", "UU81"), "UU81");
  const others = tieDates.slice(0, -1).map((date) => {
    const result = parsePickapartvaSearch(
      searches.get(searchUrl(date)) ?? "",
      date,
    );
    if (result.status !== "complete")
      throw new Error("Expected a complete native search");
    return { url: searchUrl(date), page: result.page };
  });
  for (const changed of [
    [],
    [search],
    [search, search],
    [...others, tt87],
    [...others, uu81, tt87],
    [...others, search, tt87, uu81],
  ])
    expect(() => buildPickapartvaSnapshot(pages, changed)).toThrow(
      "do not match the catalog's repeated Set Dates (2026-11-07, 2026-11-04, 2026-10-28, 2026-10-24, 2026-10-20, 2026-10-16)",
    );
  expect(buildPickapartvaSnapshot(pages, [...others, tt87, uu81]).hash).toMatch(
    /^[a-f0-9]{64}$/,
  );
});

test("Pick-A-Part VA set-date search destinations are as narrow as catalog pages", () => {
  expect(pickapartvaSearchUrl(searchUrl("2026-10-16"), "2026-10-16")).toBe(
    searchUrl("2026-10-16"),
  );
  for (const url of [
    searchUrl("2026-10-16") + "&pagenum=2",
    searchUrl("2026-02-30"),
    searchUrl("2026-10"),
    searchUrl("PAP156479"),
    searchUrl("2026-10-16").replace("k=1", "k=2"),
    searchUrl("2026-10-16").replace("pickapartva.com", "pickapartva.net"),
    searchUrl("2026-10-16") + "#card",
    searchUrl("2026-10-16").replace("id=ANY", "id=UU82"),
    searchUrl("2026-10-16").replace("id=ANY", "id=tt87"),
    searchUrl("2026-10-16", "TT87").replace("/ANY/ANY/", "/TT87/ANY/"),
    "https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=1",
  ])
    expect(pickapartvaSearchUrl(url)).toBeNull();
  expect(
    pickapartvaSearchUrl(searchUrl("2026-10-16"), "2026-10-17"),
  ).toBeNull();
  // The yard split narrows only through the native `id` parameter.
  expect(
    pickapartvaSearchUrl(searchUrl("2026-10-16", "TT87"), "2026-10-16", "TT87"),
  ).toBe(searchUrl("2026-10-16", "TT87"));
  expect(
    pickapartvaSearchUrl(searchUrl("2026-10-16", "TT87"), "2026-10-16", "ANY"),
  ).toBeNull();
  expect(
    pickapartvaSearchUrl(searchUrl("2026-10-16"), "2026-10-16", "UU81"),
  ).toBeNull();
  // A make split narrows one yard's search through the native make path.
  expect(
    pickapartvaSearchUrl(
      makeUrl("LAND ROVER"),
      "2026-10-16",
      "TT87",
      "LAND ROVER",
    ),
  ).toBe(makeUrl("LAND ROVER"));
  expect(pickapartvaSearchTarget(makeUrl("MERCEDES-BENZ"))).toEqual({
    date: "2026-10-16",
    id: "TT87",
    make: "MERCEDES-BENZ",
  });
  for (const url of [
    makeUrl("FORD").replace("id=TT87", "id=ANY"),
    makeUrl("FORD").replace("/FORD/", "/ford/"),
    makeUrl("FORD").replace("/FORD/", "/FORD%2FANY/"),
    makeUrl("LAND ROVER").replace("LAND_ROVER", "LAND%20ROVER"),
  ])
    expect(pickapartvaSearchTarget(url)).toBeNull();
  expect(
    pickapartvaSearchUrl(makeUrl("FORD"), "2026-10-16", "TT87"),
  ).toBeNull();
});
