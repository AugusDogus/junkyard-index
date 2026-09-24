import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import {
  fetchUpullitwaPage,
  parseUpullitwaPage,
  upullitwaPageUrl,
} from "./upullitwa-client";
import { streamUpullitwaInventoryWithRequestGate } from "./upullitwa-connector";
import { UpullitwaCursor, UpullitwaCursorSchema } from "./upullitwa-cursor";
import {
  transformUpullitwaVehicle,
  type UpullitwaCanonicalVehicle,
} from "./upullitwa-transform";
import { upullitwaYard } from "./upullitwa-yard-metadata";
import type { ProviderRequestGate } from "./provider-http-client";

const fixture = readFileSync(
  new URL("./fixtures/upullitwa-page.html", import.meta.url),
  "utf8",
);
const vin = "1G1PC5SB9F7289888";
const secondVin = "2A4GP54L26R836154";
const thirdVin = "2G1WB58K081236664";
const row = /<tbody>([\s\S]*?)<\/tbody>/.exec(fixture)?.[1]?.trim();
if (!row) throw new Error("Test fixture missing inventory row");
const fixtureRow = row;
const originalFetch = globalThis.fetch;
const noRateLimit: ProviderRequestGate = (request) => request;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function pageHtml(
  yardId: string,
  page: number,
  lastPage: number,
  vins: string[],
  extraYards: string[] = [],
) {
  const ids = ["JJ65", "UU44", "UU43", ...extraYards];
  const selector = `<select class="upullsimpleLocation">${["ANY", ...ids].map((id) => `<option value="${id}"${id === yardId ? " selected" : ""}>${id}</option>`).join("")}</select>`;
  const link = (number: number, label: string, active = false) =>
    `<li class="page-item${active ? " active" : ""}"><a href="${upullitwaPageUrl(yardId, number).replaceAll("&", "&#038;")}">${label}</a></li>`;
  const links =
    Array.from({ length: lastPage }, (_, index) =>
      link(index + 1, String(index + 1), index + 1 === page),
    ).join("") + (page < lastPage ? link(page + 1, "Next &raquo;") : "");
  return fixture
    .replace(/<select[\s\S]*?<\/select>/, selector)
    .replace(
      /<nav[\s\S]*?<\/nav>/,
      `<nav class="iis-upull-pagination-wrapper"><ul>${links}</ul></nav>`,
    )
    .replace(
      /<tbody>[\s\S]*?<\/tbody>/,
      `<tbody>${vins.map((value) => fixtureRow.replace(vin, value)).join("")}</tbody>`,
    );
}

function mockPages(respond: (yard: string, page: number) => string | Response) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const yard = url.searchParams.get("id") ?? "";
      const page = Number(url.searchParams.get("pagenum"));
      requests.push(`${yard}:${page}`);
      const result = respond(yard, page);
      return typeof result === "string"
        ? new Response(result, { headers: { "content-type": "text/html" } })
        : result;
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

test("parses only VIN cells, ignores commented columns/scripts, decodes text and pagination entities", () => {
  const page = parseUpullitwaPage(
    fixture.replace("CRUZE", "TOWN &amp; COUNTR&#89;&nbsp;"),
    "JJ65",
    1,
  );
  expect(page.records).toHaveLength(1);
  expect(page.records[0]).toMatchObject({
    vin,
    model: "TOWN & COUNTRY",
    row: "2Y-20",
    stockNumber: "2L2258",
  });
  expect(page.nextUrl).toBe(upullitwaPageUrl("JJ65", 2));
  expect(page.yardIds).toEqual(["JJ65", "UU43", "UU44"]);
});

test("accepts the live ellipsis pagination while following the immediate Next link", () => {
  const html = pageHtml("ANY", 1, 6, [vin]).replace(
    /<li class="page-item"><a[^>]*>4<\/a><\/li><li class="page-item"><a[^>]*>5<\/a><\/li>/,
    '<li class="page-item disabled"><span class="page-link">&hellip;</span></li>',
  );
  expect(html).toContain("&hellip;");
  expect(parseUpullitwaPage(html, "ANY", 1)).toMatchObject({
    lastPage: 6,
    nextUrl: upullitwaPageUrl("ANY", 2),
  });
});

test.each([
  ["unclosed comment", `<!--${fixture}`],
  ["unclosed script", `<script>${fixture}`],
  [
    "second body",
    fixture.replace("</tbody>", `</tbody><tbody>${fixtureRow}</tbody>`),
  ],
  ["orphan row", fixture.replace("</tbody>", `</tbody>${fixtureRow}`)],
  ["nested row", fixture.replace("<tbody>", "<tbody><tr>")],
  ["false value attribute", fixture.replaceAll("value=", "data-value=")],
  ["false class attribute", fixture.replaceAll("class=", "data-class=")],
  ["missing table", fixture.replace("IISUpullTable", "OtherTable")],
  ["truncated table", fixture.replace("</table>", "")],
  ["missing column", fixture.replace("<th>Vin</th>", "")],
  ["missing cell", fixture.replace(`<td>${vin}</td>`, "")],
  ["empty table", fixture.replace(fixtureRow, "")],
  ["truncated row", fixture.replace("</td><td>2L2258", "<td>2L2258")],
  ["missing pagination", fixture.replace(/<nav[\s\S]*?<\/nav>/, "")],
  ["missing next", fixture.replace("Next &raquo;", "Previous")],
  [
    "cross origin",
    fixture.replace('href="/inventory', 'href="https://evil.example/inventory'),
  ],
  ["changed yard", fixture.replace("id=JJ65", "id=UU44")],
  [
    "additional filter",
    fixture.replace("k=1&#038;", "search=FORD&#038;k=1&#038;"),
  ],
  ["duplicate query key", fixture.replace("k=1&#038;", "k=1&#038;k=1&#038;")],
  ["ignored filter", fixture.replace('value="JJ65" selected', 'value="JJ65"')],
  [
    "wrong current page",
    fixture.replace('class="page-item active"', 'class="page-item"'),
  ],
  ["row cap", fixture.replace(fixtureRow, fixtureRow.repeat(1001))],
  ["page cap", pageHtml("JJ65", 1, 100, [vin])],
])("fails closed on %s", (_name, html) => {
  expect(() => parseUpullitwaPage(html, "JJ65", 1)).toThrow();
});

test("preserves independently valid VINs when descriptive metadata is rejected", async () => {
  mockPages((yard, page) =>
    pageHtml(yard, page, 1, [vin, secondVin]).replace(
      `<td>CRUZE</td>`,
      `<td></td>`,
    ),
  );
  const result = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch: () => Effect.void, maxPages: 8 },
      noRateLimit,
    ),
  );
  expect(result.observedVins).toEqual([vin]);
  expect(result.accounting.recordsRejected).toBe(3);
});

test.each([206, 403])(
  "rejects HTTP %s rather than completing",
  async (status) => {
    mockPages(
      () =>
        new Response(fixture, {
          status,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      Effect.runPromise(fetchUpullitwaPage("JJ65", 1, noRateLimit)),
    ).rejects.toThrow();
  },
);

test("reports the inventory parser failure with yard and page context", async () => {
  mockPages(() => fixture.replace("IISUpullTable", "OtherTable"));

  await expect(
    Effect.runPromise(fetchUpullitwaPage("JJ65", 1, noRateLimit)),
  ).rejects.toThrow(
    "Washington U-Pull-It yard JJ65 page 1: Missing or ambiguous IISUpullTable inventory table; inspect the provider page markup before resuming",
  );
});

test("rejects partial headers, non-HTML and unsafe request URLs", async () => {
  const cases: HeadersInit[] = [
    {
      link: '</inventory/?page=2>; rel="alternate next"',
      "content-type": "text/html",
    },
    { "content-range": "bytes 0-10/20", "content-type": "text/html" },
    { "content-type": "application/json" },
  ];
  for (const headers of cases) {
    mockPages(() => new Response(fixture, { headers }));
    await expect(
      Effect.runPromise(fetchUpullitwaPage("JJ65", 1, noRateLimit)),
    ).rejects.toThrow();
  }
  const calls = mockPages(() => fixture);
  await expect(
    Effect.runPromise(
      fetchUpullitwaPage("JJ65", 1, noRateLimit, "https://evil.example/"),
    ),
  ).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("accepts WordPress API discovery headers but rejects HTTP pagination", async () => {
  mockPages(
    () =>
      new Response(fixture, {
        headers: {
          "content-type": "text/html",
          link: '<https://go2upullit.com/wp-json/>; rel="https://api.w.org/"',
        },
      }),
  );
  expect(
    (await Effect.runPromise(fetchUpullitwaPage("JJ65", 1, noRateLimit)))
      .records,
  ).toHaveLength(1);
  mockPages(
    () =>
      new Response(fixture, {
        headers: {
          "content-type": "text/html",
          link: '<https://go2upullit.com/other-page>; rel="next"',
        },
      }),
  );
  await expect(
    Effect.runPromise(fetchUpullitwaPage("JJ65", 1, noRateLimit)),
  ).rejects.toThrow("Partial/linked");
});

test("normalizes known yard identity without inferring city from row prefix", () => {
  const record = parseUpullitwaPage(fixture, "JJ65", 1).records[0];
  const yard = upullitwaYard("UU43");
  if (!record || !yard) throw new Error("Missing test record/yard");
  const result = transformUpullitwaVehicle({ ...record, row: "3Y-15" }, yard);
  expect(result).toMatchObject({
    source: "upullitwa",
    vin,
    make: "Chevrolet",
    model: "CRUZE",
    locationCode: "UU43",
    locationCity: "Yakima",
    state: "Washington",
    stateAbbr: "WA",
    lat: 46.5700594,
    lng: -120.4894576,
    row: "3Y-15",
    imageUrl: null,
    availableDate: "2026-09-12T00:00:00.000Z",
  });
  for (const invalid of [
    { vin: "N/A" },
    { vin: "1G1PC5SB9F72898I8" },
    { make: " " },
    { model: "" },
    { year: "2015junk" },
    { year: "0" },
  ]) {
    expect(
      transformUpullitwaVehicle({ ...record, ...invalid }, yard),
    ).toBeNull();
  }
  expect(
    transformUpullitwaVehicle(
      { ...record, year: "1970", vin: "CE140S123456" },
      yard,
    )?.vin,
  ).toBe("CE140S123456");
  expect(
    transformUpullitwaVehicle(
      { ...record, date: "2026-02-30", imageUrl: "javascript:alert(1)" },
      yard,
    ),
  ).toMatchObject({ availableDate: null, imageUrl: null });
});

test("follows short pages and deduplicates within chunks while leaving run-wide uniqueness to snapshots", async () => {
  const calls = mockPages((yard, page) =>
    pageHtml(
      yard,
      page,
      yard === "JJ65" ? 2 : 1,
      yard === "JJ65" && page === 1
        ? [vin]
        : yard === "JJ65"
          ? [vin, secondVin, "INVALID"]
          : [thirdVin],
    ),
  );
  const vehicles: UpullitwaCanonicalVehicle[] = [];
  const onBatch = (batch: UpullitwaCanonicalVehicle[]) =>
    Effect.sync(() => {
      vehicles.push(...batch);
    });
  const first = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch, maxPages: 1 },
      noRateLimit,
    ),
  );
  expect(first).toMatchObject({
    status: "paused",
    count: 1,
    pagesProcessed: 1,
    cursor: { yardId: "JJ65", page: 2 },
  });
  const second = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch, maxPages: 1, startCursor: first.cursor },
      noRateLimit,
    ),
  );
  expect(second).toMatchObject({
    status: "paused",
    count: 2,
    accounting: {
      recordsProcessed: 3,
      recordsRejected: 1,
      duplicateVehicles: 0,
    },
    cursor: { yardId: "UU43", page: 1 },
  });
  const last = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch, maxPages: 2, startCursor: second.cursor },
      noRateLimit,
    ),
  );
  expect(last).toMatchObject({
    status: "complete",
    count: 1,
    accounting: { recordsProcessed: 2, duplicateVehicles: 1 },
  });
  expect(calls).toEqual(["ANY:1", "JJ65:1", "JJ65:2", "UU43:1", "UU44:1"]);
  expect(vehicles.map((vehicle) => vehicle.vin)).toEqual([
    vin,
    vin,
    secondVin,
    thirdVin,
  ]);
  expect(UpullitwaCursorSchema.safeParse(second.cursor).success).toBe(true);
  expect(JSON.stringify(second.cursor)).not.toContain(vin);
  const terminal = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch, startCursor: last.cursor },
      noRateLimit,
    ),
  );
  expect(terminal).toMatchObject({
    status: "complete",
    count: 0,
    pagesProcessed: 0,
  });
  expect(calls).toHaveLength(5);
});

test("fails repeated pages across resume before emitting the repeated batch", async () => {
  mockPages((yard, page) => pageHtml(yard, page, 2, [vin]));
  const first = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch: () => Effect.void, maxPages: 1 },
      noRateLimit,
    ),
  );
  await expect(
    Effect.runPromise(
      streamUpullitwaInventoryWithRequestGate(
        {
          startCursor: first.cursor,
          onBatch: () => Effect.die("Must not emit"),
        },
        noRateLimit,
      ),
    ),
  ).rejects.toThrow("page repeated");
});

test("fails changing page counts and missing known yards", async () => {
  mockPages((yard, page) => pageHtml(yard, page, 3, [vin]));
  const first = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch: () => Effect.void, maxPages: 1 },
      noRateLimit,
    ),
  );
  mockPages((yard, page) => pageHtml(yard, page, 2, [secondVin]));
  await expect(
    Effect.runPromise(
      streamUpullitwaInventoryWithRequestGate(
        { startCursor: first.cursor, onBatch: () => Effect.void },
        noRateLimit,
      ),
    ),
  ).rejects.toThrow("pagination changed");
  mockPages((yard, page) =>
    pageHtml(yard, page, 1, [vin]).replace(
      /<option value="UU44"[^>]*>UU44<\/option>/,
      "",
    ),
  );
  await expect(
    Effect.runPromise(
      streamUpullitwaInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        noRateLimit,
      ),
    ),
  ).rejects.toThrow("lost known yards UU44");
});

test("unknown yards preserve all observed VINs and exclusions without blocking known yards", async () => {
  mockPages((yard, page) =>
    pageHtml(yard, page, 1, [yard === "ZZ99" ? secondVin : vin], ["ZZ99"]),
  );
  const result = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch: () => Effect.void, maxPages: 8 },
      noRateLimit,
    ),
  );
  expect(result).toMatchObject({
    status: "complete",
    count: 1,
    observedVins: [secondVin],
    accounting: {
      recordsProcessed: 4,
      recordsExcluded: 1,
      recordsRejected: 0,
      duplicateVehicles: 2,
    },
  });
  expect(result.warnings[0]).toContain("ZZ99: excluded 1 rows");
});

test("resumed traversal discovers a new stable yard ID even before completed IDs", async () => {
  mockPages((yard, page) => pageHtml(yard, page, 1, [vin]));
  const first = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch: () => Effect.void, maxPages: 1 },
      noRateLimit,
    ),
  );
  const calls = mockPages((yard, page) =>
    pageHtml(yard, page, 1, [yard === "AA11" ? secondVin : thirdVin], ["AA11"]),
  );
  const resumed = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { startCursor: first.cursor, onBatch: () => Effect.void, maxPages: 8 },
      noRateLimit,
    ),
  );
  expect(calls).toEqual(["UU43:1", "AA11:1", "UU44:1"]);
  expect(resumed).toMatchObject({
    status: "complete",
    observedVins: [secondVin],
    accounting: { recordsExcluded: 1 },
  });
});

test("resumed known-yard completeness includes usable rows from earlier chunks", async () => {
  mockPages((yard, page) =>
    pageHtml(
      yard,
      page,
      yard === "JJ65" ? 2 : 1,
      page === 1 ? [vin] : ["INVALID"],
    ),
  );
  const first = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { onBatch: () => Effect.void, maxPages: 1 },
      noRateLimit,
    ),
  );
  const resumed = await Effect.runPromise(
    streamUpullitwaInventoryWithRequestGate(
      { startCursor: first.cursor, onBatch: () => Effect.void, maxPages: 1 },
      noRateLimit,
    ),
  );
  expect(resumed).toMatchObject({
    status: "paused",
    count: 0,
    cursor: { yardId: "UU43", page: 1 },
    accounting: { recordsRejected: 1 },
  });
});

test("rejects known yards with no usable inventory", async () => {
  mockPages((yard, page) => pageHtml(yard, page, 1, ["INVALID"]));
  await expect(
    Effect.runPromise(
      streamUpullitwaInventoryWithRequestGate(
        { onBatch: () => Effect.void },
        noRateLimit,
      ),
    ),
  ).rejects.toThrow("no usable vehicles");
});

test("callback failure cannot return an advanced checkpoint", async () => {
  const calls = mockPages((yard, page) => pageHtml(yard, page, 2, [vin]));
  await expect(
    Effect.runPromise(
      streamUpullitwaInventoryWithRequestGate(
        { onBatch: () => Effect.fail(new Error("write failed")), maxPages: 8 },
        noRateLimit,
      ),
    ),
  ).rejects.toThrow("write failed");
  expect(calls).toEqual(["ANY:1", "JJ65:1"]);
});

test("validates bounded cursor and chunk inputs before requests", async () => {
  const calls = mockPages(() => fixture);
  for (const maxPages of [0, -1, 1.5, Infinity, 3201]) {
    await expect(
      Effect.runPromise(
        streamUpullitwaInventoryWithRequestGate(
          { maxPages, onBatch: () => Effect.void },
          noRateLimit,
        ),
      ),
    ).rejects.toThrow("Invalid");
  }
  expect(
    UpullitwaCursorSchema.safeParse({
      source: "upullitwa",
      phase: "page",
      page: -1,
    }).success,
  ).toBe(false);
  expect(UpullitwaCursorSchema.safeParse(UpullitwaCursor.initial).success).toBe(
    true,
  );
  expect(calls).toEqual([]);
});
