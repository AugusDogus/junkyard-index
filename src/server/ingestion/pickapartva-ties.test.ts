import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { connectorChunkMetrics } from "./connector-chunk";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import {
  streamPickapartvaInventoryWithRequestGate,
  type PickapartvaStreamResult,
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
import { PickapartvaRecovery } from "./pickapartva-recovery";
import {
  buildPickapartvaSnapshot,
  pickapartvaTies,
} from "./pickapartva-snapshot";
import { validationRejectionKind } from "./ingestion-validation";
import {
  pickapartvaTestCard,
  pickapartvaTestRecord,
} from "./pickapartva-test-fixtures";
import type { PickapartvaCanonicalVehicle } from "./pickapartva-transform";
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
 * 2026-11-18 yard searches are: only that yard's cards, `id` in the form,
 * that yard selected and named in the native scripts. */
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
    )
    .replaceAll('var urgID = "ANY"', `var urgID = "${id}"`);
}
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
      // A census after the one that planned the searches reads the catalog
      // pages again; the saved closing reads answer for pages 1, 2 and 15.
      const body =
        (read > 1 ? closings.get(url) : undefined) ??
        catalog.find((response) => response.url === url)?.body ??
        extra.get(url) ??
        searches.get(url);
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
const durable = (cursor: PickapartvaCursor) =>
  parseDurableSourceCursor("pickapartva", serializeDurableSourceCursor(cursor));
/** Runs chunks through the durable codec until one emits pages or completes:
 * the census that plans the tie searches, the searches, then the census that
 * publishes. Returns each chunk's requests and the last result. */
async function crawl(
  onBatch: (batch: PickapartvaCanonicalVehicle[]) => Effect.Effect<void>,
  calls: string[],
  startCursor?: PickapartvaCursor,
  maxPages = 15,
) {
  const chunks: string[][] = [];
  let cursor = startCursor;
  for (let index = 0; index < 10; index++) {
    const before = calls.length;
    const result: PickapartvaStreamResult = await run(
      onBatch,
      cursor,
      maxPages,
    );
    chunks.push(calls.slice(before));
    if (result.pagesProcessed > 0 || result.status === "complete")
      return { result, chunks };
    cursor = durable(result.cursor);
  }
  throw new Error("Expected the crawl to publish within ten chunks");
}
const pageUrls = (pages: number[]) =>
  pages.map(
    (page) =>
      `https://pickapartva.com/inventory/ANY/ANY/?k=1&id=ANY&pagenum=${page}`,
  );

test("Pick-A-Part VA recovers donors hidden by catalog Set Date ties before accepting the census", async () => {
  const calls = serve();
  const emitted: PickapartvaCanonicalVehicle[] = [];
  const { result, chunks } = await crawl(
    (batch) =>
      Effect.sync(() => {
        emitted.push(...batch);
      }),
    calls,
  );
  // The census plans one search per repeated date, the searches run in
  // their own chunk, and the next census reads the catalog again.
  expect(chunks).toEqual([
    catalog.map((response) => response.url),
    tieDates.map((date) => searchUrl(date)),
    [...catalog.map((response) => response.url), ...pageUrls([1, 2, 15])],
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

test("Pick-A-Part VA resumes a tie-recovered census only against the same recoveries", async () => {
  const calls = serve();
  const emitted: string[] = [];
  const onBatch = (batch: PickapartvaCanonicalVehicle[]) =>
    Effect.sync(() => {
      emitted.push(...batch.map((vehicle) => vehicle.vin));
    });
  const { result: first } = await crawl(onBatch, calls, undefined, 8);
  expect(first.status).toBe("paused");
  if (first.cursor.phase !== "pages")
    throw new Error("Expected a paused checkpoint");
  expect(first.cursor.searches.map((search) => search.date)).toEqual(tieDates);
  const cursor = durable(first.cursor);
  // The resumed census reads the catalog again but reuses the searches.
  const resumedCalls = serve();
  const second = await run(onBatch, cursor);
  expect(resumedCalls).toEqual([
    ...catalog.map((response) => response.url),
    ...pageUrls([1, 2, 15]),
  ]);
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
  // A resumed chunk whose rebuilt catalog lists different card details
  // stops before any callback.
  serve((url, body) =>
    url === catalog[0]?.url
      ? body.replace(/<b>Row: <\/b> [^<]*<br\/>/, "<b>Row: </b> 999<br/>")
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
    "add 7 donors, but the catalog repeated 8",
  ],
  [
    "an extra unseen donor",
    (body) =>
      searchPage("2026-10-16", [
        ...wrapped(body),
        hiddenCard(synthetic("2026-10-16", 9)),
      ]),
    "add 9 donors, but the catalog repeated 8",
  ],
])(
  "Pick-A-Part VA fails closed when a set-date search has %s",
  async (kind, change, message) => {
    const calls = serve((url, body) =>
      url === searchUrl("2026-10-16") ? change(body) : body,
    );
    let callbacks = 0;
    const rejection: unknown = await crawl(
      () =>
        Effect.sync(() => {
          callbacks++;
        }),
      calls,
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

test("Pick-A-Part VA searches by yard without the unfiltered search when the catalog already shows a full search page of a date, and stops once the hidden donor is found", async () => {
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
      [searchUrl("2026-11-07", "TT87"), yardPage(cards, "TT87", "2026-11-07")],
      [searchUrl("2026-11-07", "UU81"), yardPage(cards, "UU81", "2026-11-07")],
    ]),
  );
  const emitted: string[] = [];
  const { result, chunks } = await crawl(
    (batch) =>
      Effect.sync(() => {
        emitted.push(...batch.map((vehicle) => vehicle.vin));
      }),
    calls,
  );
  // The unfiltered search would be capped, so it is skipped. Fredericksburg
  // lists the date's one hidden donor, so Stafford is never searched.
  expect(chunks[1]).toEqual([
    searchUrl("2026-11-07", "TT87"),
    ...tieDates.slice(1).map((date) => searchUrl(date)),
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
const nativeMakes = parsePickapartvaPage(catalog[0]?.body ?? "", 1).makes;
const makeUrl = (make: string, date = "2026-10-16") =>
  `https://pickapartva.com/inventory/${make.replaceAll(" ", "_")}/ANY/?k=1&id=TT87&search=${date}`;

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
  if (cappedSearch.status !== "capped") throw new Error("Expected capped");
  expect(cappedSearch.page.records).toHaveLength(500);
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
  ).toThrow("yard search does not prove its selected make ANY and yard TT87");
  expect(() =>
    parsePickapartvaSearch(deSoto ?? "", "2026-11-16", "TT87"),
  ).toThrow("yard search does not prove its selected make ANY and yard TT87");
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
  const capped = parsePickapartvaSearch(all ?? "", "2026-11-18");
  expect(capped.status).toBe("capped");
  expect(capped.page.records).toHaveLength(500);
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

test("Pick-A-Part VA snapshots refuse recoveries that do not match the repeated Set Dates", () => {
  const pages = catalog.map((response, index) => ({
    url: response.url,
    page: parsePickapartvaPage(response.body, index + 1),
  }));
  const ties = pickapartvaTies(pages);
  expect(ties.map((tie) => [tie.date, tie.slots])).toEqual([
    ["2026-11-07", 1],
    ["2026-11-04", 1],
    ["2026-10-28", 5],
    ["2026-10-24", 1],
    ["2026-10-20", 2],
    ["2026-10-16", 8],
  ]);
  const recoveries = ties.map((tie) =>
    PickapartvaRecovery.record(
      PickapartvaRecovery.plan(tie, 1),
      searchUrl(tie.date),
      parsePickapartvaSearch(searches.get(searchUrl(tie.date)) ?? "", tie.date),
    ),
  );
  expect(buildPickapartvaSnapshot(pages, recoveries).hash).toMatch(
    /^[a-f0-9]{64}$/,
  );
  const [first, ...rest] = recoveries;
  if (!first) throw new Error("Expected a recovery");
  for (const changed of [
    [],
    rest,
    [...rest, first],
    [first, first, ...rest.slice(1)],
    [{ ...first, slots: 2 }, ...rest],
    [{ ...first, shown: first.shown.slice(1) }, ...rest],
    [PickapartvaRecovery.plan(ties[0] ?? first, 1), ...rest],
  ])
    expect(() => buildPickapartvaSnapshot(pages, changed)).toThrow(
      "do not match the catalog's repeated Set Dates (2026-11-07, 2026-11-04, 2026-10-28, 2026-10-24, 2026-10-20, 2026-10-16)",
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
