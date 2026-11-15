import { expect, test } from "bun:test";
import { Effect } from "effect";
import { z } from "zod";
import { cstruckFixture } from "./cstruck-test-fixtures";
import {
  parseCstruckPage,
  parseCstruckStore,
  type CstruckPage,
} from "./cstruck-parser";
import {
  CstruckCursor,
  cstruckAdvance,
  cstruckFrontier,
  cstruckNextUrl,
  cstruckRoster,
} from "./cstruck-cursor";
import { streamCstruckInventory } from "./cstruck-connector";
import { cstruckChecksum, cstruckSnapshot } from "./cstruck-snapshot";
import {
  CSTRUCK_RANGES,
  CSTRUCK_STORE,
  CSTRUCK_YARD,
  cstruckRangeUrl,
} from "./cstruck-yard-metadata";
import { IngestionSourceFlags } from "./ingestion-source-flags";
import { VehicleDestination } from "~/lib/vehicle-destination";
import { resolveYardWebsite } from "~/lib/yard-website";

const opening = () =>
  CSTRUCK_RANGES.map((range) =>
    parseCstruckPage(cstruckFixture(`opening-${range[0]}-${range[1]}`), range),
  );
const records = () => cstruckRoster(opening(), 64);
const controls = [
  { key: "store-opening", url: CSTRUCK_STORE },
  ...["opening", "closing"].flatMap((phase) =>
    CSTRUCK_RANGES.map((range) => ({
      key: `${phase}-${range[0]}-${range[1]}`,
      url: cstruckRangeUrl(range),
    })),
  ),
  { key: "store-closing", url: CSTRUCK_STORE },
];
function replay(change: (raw: string, index: number) => string = (raw) => raw) {
  let calls = 0,
    emitted = 0,
    yards = 0;
  return {
    get calls() {
      return calls;
    },
    get emitted() {
      return emitted;
    },
    get yards() {
      return yards;
    },
    async run() {
      let cursor = CstruckCursor.initial();
      for (let index = 0; index < controls.length; index++) {
        const result = await Effect.runPromise(
          streamCstruckInventory({
            startCursor: cursor,
            previousAcceptedCount: null,
            maxPages: 1,
            readPage: (url) =>
              Effect.sync(() => {
                const control = controls[calls];
                if (!control) throw new Error("Unexpected extra request");
                expect(url).toBe(control.url);
                return change(cstruckFixture(control.key), calls++);
              }),
            onBatch: (vehicles) =>
              Effect.sync(() => {
                expect(calls).toBe(10);
                emitted += vehicles.length;
              }),
            onYards: (values) =>
              Effect.sync(() => {
                yards += values.length;
              }),
          }),
        );
        cursor = CstruckCursor.fromWire(CstruckCursor.serialize(result.cursor));
        if (result.status === "complete") return result;
        expect(result.count).toBe(0);
        expect(result.observedVins).toEqual([]);
        expect(
          Object.values(result.accounting).every((value) => value === 0),
        ).toBe(true);
        expect(emitted).toBe(0);
      }
      throw new Error("C&S replay did not finish");
    },
  };
}

test("complete offline census reconciles 64 native items, 59 SD donors, five rejects and no duplicates", async () => {
  expect(parseCstruckStore(cstruckFixture("store-opening"))).toBe(64);
  expect(opening().map((page) => page.records.length)).toEqual([
    10, 22, 13, 19,
  ]);
  const saved = replay(),
    result = await saved.run();
  expect(result.status).toBe("complete");
  expect(saved.calls).toBe(10);
  expect(saved.emitted).toBe(59);
  expect(saved.yards).toBe(1);
  expect(result.cursor.requests).toBe(10);
  expect(result.count).toBe(59);
  expect(result.accounting).toEqual({
    recordsProcessed: 64,
    recordsRejected: 5,
    recordsExcluded: 0,
    duplicateVehicles: 0,
  });
  expect(new Set(result.observedVins)).toEqual(
    new Set(["1HSHXAHR8SJ049429", "3C63RRGL9LG210160", "1TTE5320641074484"]),
  );
  const terminal = await Effect.runPromise(
    streamCstruckInventory({
      startCursor: result.cursor,
      previousAcceptedCount: null,
      readPage: () => Effect.die("Terminal checkpoint requested HTTP"),
      onBatch: () => Effect.die("Terminal checkpoint emitted twice"),
    }),
  );
  expect(terminal.count).toBe(0);
  expect(terminal.pagesProcessed).toBe(0);
  expect(terminal.observedVins).toEqual([]);
});

test("five actual rejects remain in the denominator, with no VIN-based descriptive repairs", () => {
  const snapshot = cstruckSnapshot(records(), null);
  expect(snapshot.rejects.map((row) => row.id).sort()).toEqual([
    "4763",
    "6130",
    "6692",
    "6899",
    "8249",
  ]);
  expect(
    snapshot.vehicles.every(
      (v) =>
        v.source === "cstruck" && v.stateAbbr === "SD" && v.imageUrl === null,
    ),
  ).toBe(true);
  expect(
    snapshot.vehicles.find((v) => v.vin === "1XP5DB9X37D663649"),
  ).toMatchObject({
    engine: "C15 CAT",
    transmission: "10 SPEED",
    stockNumber: null,
  });
  expect(snapshot.vehicles.some((v) => v.vin === "1FUPUXZB51PG05636")).toBe(
    true,
  );
  expect(cstruckChecksum("1HSHXAHR8SJ049429")).toBe(false);
  expect(cstruckChecksum("1XP5DB9X37D663649")).toBe(true);
  expect(snapshot.accounting.recordsRejected / 64).toBeLessThan(0.1);
});

test("floor, rejection, duplicate, conflicting VIN and previous-count drift guards fail closed", () => {
  const rows = records(),
    first = rows[0];
  if (!first) throw new Error("Missing actual donor");
  expect(() => cstruckSnapshot(rows.slice(0, 10), null)).toThrow("minimum");
  expect(() =>
    cstruckSnapshot(
      rows.map((r, i) => (i < 3 ? { ...r, vin: "" } : r)),
      null,
    ),
  ).toThrow("rejection");
  expect(() => cstruckSnapshot(rows, 120)).toThrow("drift");
  expect(cstruckSnapshot(rows, 119).vehicles).toHaveLength(59);
  const repeated = Array.from({ length: 30 }, (_, i) => ({
    ...first,
    id: String(90000 + i),
  }));
  expect(() => cstruckSnapshot([...rows, ...repeated], null)).toThrow(
    "duplicate",
  );
  expect(() =>
    cstruckSnapshot(
      [...rows, { ...first, id: "90000", model: "CONFLICT" }],
      null,
    ),
  ).toThrow("conflict");
  expect(() =>
    cstruckSnapshot(
      [...rows, { ...first, id: "90000", make: "UNKNOWN" }],
      null,
    ),
  ).toThrow("rejected identity");
});

test.each([
  [5, "2HSFMAHR9SC048056", "2HSFMAHR9SC048057"],
  [8, "C15 CAT", "C13 CAT"],
  [9, "Complete Vehicle - 64", "Complete Vehicle - 63"],
] as const)(
  "closing mutation at control %i emits no partial vehicles",
  async (index, from, to) => {
    const input = replay((body, i) =>
      i === index ? body.replaceAll(from, to) : body,
    );
    await expect(input.run()).rejects.toThrow();
    expect(input.emitted).toBe(0);
    expect(input.yards).toBe(0);
  },
);

test("exact owner, native destination, price and complete-document controls are mandatory", () => {
  const raw = cstruckFixture("opening-1970-1998"),
    range = CSTRUCK_RANGES[0];
  for (const changed of [
    raw.replaceAll("Pukwana SD", "Other SD"),
    raw.replaceAll("/7131988/1/", "/7131988/2/"),
    raw.replace("</html>", ""),
    raw.replace("Please Call", "$25,000"),
    raw.replace("CAB & CHASSIS", "RUNS AND DRIVES"),
  ])
    expect(() => parseCstruckPage(changed, range)).toThrow();
  expect(() =>
    parseCstruckStore(
      cstruckFixture("store-opening").replaceAll(
        "24988 350th Ave",
        "123 Other St",
      ),
    ),
  ).toThrow("address");
  expect(() => cstruckRoster(opening(), 63)).toThrow("store count");
});

test("25-row cap bisects ranges without following page links; saturated single years stop", () => {
  const page = opening()[0];
  if (!page) throw new Error("Missing native page");
  const capped = {
    ...page,
    capped: true,
    records: Array.from({ length: 25 }, (_, index) => {
      const record = page.records[index % page.records.length];
      if (!record) throw new Error("Missing native donor");
      return {
        ...record,
        id: String(90000 + index),
        url: record.url.replace(/\d+$/, String(90000 + index)),
      };
    }),
  };
  expect(cstruckFrontier([capped])).toEqual([
    [1970, 1984],
    [1985, 1998],
    [1999, 2003],
    [2004, 2006],
    [2007, 2027],
  ]);
  expect(() => cstruckFrontier([{ ...capped, range: [1971, 1998] }])).toThrow(
    "frontier",
  );
  expect(() => cstruckRoster([capped], 25)).toThrow("unvisited");
  // Follow the left branches to a single year, keeping every synthetic record
  // in range. This tests the same fail-closed bound without making requests.
  const history: CstruckPage[] = [];
  for (;;) {
    const range = cstruckFrontier(history)[0];
    if (!range) throw new Error("Missing synthetic frontier");
    const parsed: CstruckPage = {
      ...capped,
      range: [range[0], range[1]],
      records: capped.records.map((r) => ({ ...r, year: String(range[0]) })),
    };
    if (range[0] === range[1]) {
      expect(() => cstruckFrontier([...history, parsed])).toThrow(
        "single year",
      );
      break;
    }
    history.push(parsed);
  }
});

test("checked cursor binds native traversal, requests, checksum and prior accepted count", () => {
  const start = CstruckCursor.initial(),
    next = cstruckAdvance(start, cstruckFixture("store-opening"));
  expect(cstruckNextUrl(next)).toBe(cstruckRangeUrl(CSTRUCK_RANGES[0]));
  expect(() =>
    CstruckCursor.parse({ ...next, checksum: "0".repeat(64) }),
  ).toThrow("checksum");
  expect(() => CstruckCursor.parse(next, 59)).toThrow("prior-count");
  const { checksum: _checksum, ...state } = next;
  void _checksum;
  expect(() => CstruckCursor.checkpoint({ ...state, requests: 2 })).toThrow(
    "accounting",
  );
  expect(() =>
    CstruckCursor.checkpoint({ ...state, phase: "complete" }),
  ).toThrow("unvisited");
});

test("C&S ships disabled with native vehicle destinations and yard website fallback", () => {
  expect(IngestionSourceFlags.resolve({})).not.toContain("cstruck");
  const first = cstruckSnapshot(records(), null).vehicles[0];
  if (!first) throw new Error("Missing donor");
  expect(VehicleDestination.resolve(first)).toMatchObject({
    kind: "inventory",
    href: first.detailsUrl,
  });
  expect(resolveYardWebsite({ ...CSTRUCK_YARD, websiteUrl: null })).toEqual({
    kind: "provider",
    href: CSTRUCK_YARD.websiteUrl,
  });
});

test("saved Census exact-address interpolation grounds the SD yard", () => {
  const census = z
    .object({
      result: z.object({
        addressMatches: z.array(
          z.object({
            matchedAddress: z.string(),
            coordinates: z.object({ x: z.number(), y: z.number() }),
          }),
        ),
      }),
    })
    .parse(JSON.parse(cstruckFixture("census")));
  expect(census.result.addressMatches).toHaveLength(1);
  expect(census.result.addressMatches[0]).toEqual({
    matchedAddress: "24988 350TH AVE, PUKWANA, SD, 57370",
    coordinates: { x: CSTRUCK_YARD.lng, y: CSTRUCK_YARD.lat },
  });
  expect(cstruckFixture("owner")).toContain("auto salvage yard in Pukwana");
});

test("native 25-card responses require splitting even without Next, and foreign Next links stop", async () => {
  const { heavyTruckPartsDocument, heavyTruckPartsDivs } =
    await import("./heavytruckparts-html");
  const cards = heavyTruckPartsDivs(
    heavyTruckPartsDocument(cstruckFixture("ascending")),
    "product",
  );
  expect(cards).toHaveLength(25);
  const document = (next: string) =>
    `<html><body><div class="search_result_div">${cards.join("")}${next}</div></body></html>`;
  expect(parseCstruckPage(document(""), [1970, 2027]).capped).toBe(true);
  const next = cstruckRangeUrl([1970, 2027]) + "&page=2";
  expect(
    parseCstruckPage(document(`<a href="${next}">Next</a>`), [1970, 2027])
      .capped,
  ).toBe(true);
  expect(() =>
    parseCstruckPage(
      document(`<a href="${next.replace("7131988", "3987345")}">Next</a>`),
      [1970, 2027],
    ),
  ).toThrow("pagination");
});

test("actual empty child range is complete only with the native no-matches heading", () => {
  const raw = cstruckFixture("empty-1970-1984");
  expect(parseCstruckPage(raw, [1970, 1984])).toEqual({
    range: [1970, 1984],
    records: [],
    capped: false,
    hasMore: false,
  });
  expect(() =>
    parseCstruckPage(
      raw.replace("Sorry, no matches were found for: .", "Service unavailable"),
      [1970, 1984],
    ),
  ).toThrow("no-matches");
});
