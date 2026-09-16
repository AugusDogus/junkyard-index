import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  IPULLUPULL_EXPORT_URL,
  parseIPullUPullCsv,
  type IPullUPullRecord,
} from "./ipullupull-client";
import {
  IPULLUPULL_BATCH_SIZE,
  streamIPullUPullInventoryWithRequestGate,
} from "./ipullupull-connector";
import {
  transformIPullUPullVehicle,
  type IPullUPullCanonicalVehicle,
} from "./ipullupull-transform";
import {
  ipullUPullDirectoryLinks,
  parseIPullUPullYard,
} from "./ipullupull-yard-metadata";

const fixture = await Bun.file(
  new URL("./fixtures/ipullupull-sample.csv", import.meta.url),
).text();
const records = await Effect.runPromise(parseIPullUPullCsv(fixture));
const first = records[0];
if (!first) throw new Error("iPull-uPull fixture is empty");
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const cities = ["Fresno", "Pomona", "Sacramento", "Stockton"];
const directoryHtml = (listedCities: string[]) =>
  `<html><body><div class="section breakout bg_black">${listedCities.map((city) => `<figure class="wp-block-image"><a href="/locations/${city.toLowerCase()}-ca/"><img alt="${city}" /></a></figure>`).join("")}</div></body></html>`;
const page = (city: string, lat = 36.68622) =>
  `<script type="application/ld+json">${JSON.stringify({
    "@type": "AutoDealer",
    address: {
      streetAddress: "2274 East Muscat Avenue",
      addressLocality: `${city}, CA`,
      postalCode: "93725",
      addressCountry: "USA",
    },
    geo: { latitude: lat, longitude: -119.7486323 },
  })}</script>`;

function csv(rows: readonly IPullUPullRecord[]) {
  const fields = Object.keys(first ?? {});
  const encode = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return (
    fields.map(encode).join(",") +
    "\n" +
    rows
      .map((row) =>
        fields
          .map((field) =>
            encode(
              Object.entries(row).find(([key]) => key === field)?.[1] ?? "",
            ),
          )
          .join(","),
      )
      .join("\n") +
    "\n"
  );
}

function mockCatalog(
  rows: readonly IPullUPullRecord[],
  extraCities: string[] = [],
  failCity?: string,
  listedCities = [...cities, ...extraCities],
) {
  const requests: string[] = [];
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url === IPULLUPULL_EXPORT_URL)
        return new Response(csv(rows), {
          headers: { "Content-Type": "text/csv" },
        });
      if (url.endsWith("/locations/"))
        return new Response(directoryHtml(listedCities));
      const city = [...cities, ...extraCities].find((city) =>
        url.endsWith(`/${city.toLowerCase()}-ca/`),
      );
      return city && city !== failCity
        ? new Response(page(city))
        : new Response("unavailable", { status: 403 });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

async function run() {
  const vehicles: IPullUPullCanonicalVehicle[] = [];
  const batches: number[] = [];
  const result = await Effect.runPromise(
    streamIPullUPullInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
            batches.push(batch.length);
          }),
      },
      (request) => request,
    ),
  );
  return { result, vehicles, batches };
}

test("preserves uncertain observations but allows sold and parts-only vehicles to retire", async () => {
  const variant = (
    number: number,
    changes: Partial<IPullUPullRecord>,
  ): IPullUPullRecord => ({
    ...first,
    Vin: `1FMCU49H37KA${String(number).padStart(5, "0")}`,
    ...changes,
  });
  const rows = [
    ...records,
    { ...first, "Stock Number": "OLDER", "Yard Date": "2020-01-01T00:00:00" },
    variant(1, { Status: "Sold (1 unsold part)" }),
    variant(2, { Status: "Sold (2 unsold parts)", "Vehicle Row": "300" }),
    variant(3, { Status: "Pending" }),
    variant(4, { "Vehicle Row": "300" }),
    variant(5, { "Yard City": "" }),
    variant(6, { "Yard City": "Unknown" }),
    variant(7, { Make: "" }),
    variant(8, { Year: "2007junk" }),
    variant(9, { Vin: "SHORT" }),
    variant(10, { "Vehicle Row": "999" }),
    { ...first, Vin: "", "Yard City": "" },
  ];
  const requests = mockCatalog(rows);
  const { result, vehicles } = await run();
  expect(result).toMatchObject({
    count: 5,
    status: "complete",
    cursor: 1,
    pagesProcessed: 1,
    errors: [],
    accounting: {
      recordsProcessed: 16,
      recordsExcluded: 7,
      recordsRejected: 3,
      duplicateVehicles: 1,
    },
  });
  expect(result.observedVins).toHaveLength(3);
  expect(result.observedVins).not.toContain(rows[5]?.Vin);
  expect(result.observedVins).not.toContain(rows[8]?.Vin);
  expect(result.observedVins).not.toContain(rows[9]?.Vin);
  expect(result.observedVins).not.toContain(rows[10]?.Vin);
  expect(
    vehicles.find((vehicle) => vehicle.vin === first.Vin)?.stockNumber,
  ).toBe(first["Stock Number"]);
  expect(vehicles.find((vehicle) => vehicle.row === "999")).toBeDefined();
  expect(vehicles.some((vehicle) => vehicle.row === "300")).toBe(false);
  expect(requests).toHaveLength(6);
  expect(
    result.warnings?.some((warning) => warning.includes("unknown status")),
  ).toBe(true);
});

test("publishes pre-1981 identifiers and preserves their presence through metadata failures", async () => {
  mockCatalog([
    ...records,
    { ...first, Year: "1979", Vin: "FH22G9G241556" },
    { ...first, Year: "1950", Vin: "67019949", Model: "" },
  ]);
  const { result, vehicles } = await run();
  expect(vehicles.some((vehicle) => vehicle.vin === "FH22G9G241556")).toBe(
    true,
  );
  expect(result.observedVins).toContain("67019949");
});

test("new directory-backed yards are derived from first-party JSON-LD", async () => {
  mockCatalog(
    [
      ...records,
      { ...first, Vin: "1FMCU49H37KA00001", "Yard City": "BAKERSFIELD" },
    ],
    ["Bakersfield"],
  );
  const { vehicles } = await run();
  expect(
    vehicles.find((vehicle) => vehicle.locationCity === "Bakersfield")
      ?.locationCode,
  ).toBe("IPULLUPULL-BAKERSFIELD-CA");
});

test("known-yard metadata failures preserve VINs and do not fail the entire catalog", async () => {
  mockCatalog(records, [], "Fresno");
  const { result, vehicles } = await run();
  expect(vehicles).toHaveLength(3);
  expect(result.observedVins).toEqual([first.Vin]);
  expect(result.accounting?.recordsExcluded).toBe(1);
  expect(result.errors).toEqual([]);
  expect(result.warnings?.some((warning) => warning.includes("FRESNO"))).toBe(
    true,
  );
});

test("unlisted yards cannot emit vehicles or preserve VINs through uncertain metadata/status", async () => {
  const requests = mockCatalog(
    [
      ...records,
      { ...first, Vin: "1FMCU49H37KA00001", Status: "Pending" },
      { ...first, Vin: "1FMCU49H37KA00002", Model: "" },
    ],
    [],
    undefined,
    cities.filter((city) => city !== "Fresno"),
  );
  const { result, vehicles } = await run();
  expect(vehicles).toHaveLength(3);
  expect(result.observedVins).toEqual([]);
  expect(result.accounting).toMatchObject({
    recordsProcessed: 6,
    recordsExcluded: 3,
    recordsRejected: 0,
  });
  expect(requests.some((url) => url.endsWith("/fresno-ca/"))).toBe(false);
});

test("catalog completeness follows currently listed yards, not the historical city list", async () => {
  mockCatalog(
    records.filter((record) => record["Yard City"] !== "FRESNO"),
    [],
    undefined,
    cities.filter((city) => city !== "Fresno"),
  );
  const { result, vehicles } = await run();
  expect(result.status).toBe("complete");
  expect(vehicles).toHaveLength(3);
});

test.each([
  ["HTTP failure", () => new Response("unavailable", { status: 403 })],
  [
    "partial response",
    () => new Response(directoryHtml(cities), { status: 206 }),
  ],
  [
    "paginated directory",
    () =>
      new Response(directoryHtml(cities), {
        headers: { Link: '</locations/?page=2>; rel="next"' },
      }),
  ],
  ["empty directory", () => new Response(directoryHtml([]))],
  [
    "multiple link relations",
    () =>
      new Response(directoryHtml(cities), {
        headers: { Link: '</locations/?page=2>; rel="alternate next"' },
      }),
  ],
  [
    "truncated directory",
    () => new Response(directoryHtml(cities).replace("</body>", "")),
  ],
])(
  "%s aborts before emitting inventory or yard metadata",
  async (_name, response) => {
    mockCatalog(records);
    const underlyingFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).endsWith("/locations/")
          ? response()
          : underlyingFetch(input, init),
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(
        streamIPullUPullInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.fail(new Error("unexpected vehicle callback")),
            onYards: () => Effect.fail(new Error("unexpected yard callback")),
          },
          (request) => request,
        ),
      ),
    ).rejects.toThrow(/directory|eligibility/i);
  },
);

test("unusable-only listed yard fails before requesting yard metadata or emitting batches", async () => {
  const requests = mockCatalog(
    records.map((record) =>
      record["Yard City"] === "FRESNO" ? { ...record, Make: "" } : record,
    ),
  );
  let batches = 0;
  const result = await Effect.runPromise(
    Effect.either(
      streamIPullUPullInventoryWithRequestGate(
        {
          onBatch: () =>
            Effect.sync(() => {
              batches++;
            }),
        },
        (request) => request,
      ),
    ),
  );
  expect(result._tag).toBe("Left");
  expect(requests).toHaveLength(2);
  expect(batches).toBe(0);
});

test("uses bounded callback batches, propagates sink errors, and terminal cursor does no work", async () => {
  mockCatalog([
    ...records,
    ...Array.from({ length: 300 }, (_, i) => ({
      ...first,
      Vin: `1FMCU49H37KA${String(i).padStart(5, "0")}`,
    })),
  ]);
  const { result, batches } = await run();
  expect(result.count).toBe(304);
  expect(batches).toEqual([IPULLUPULL_BATCH_SIZE, 54]);
  const failed = await Effect.runPromise(
    Effect.either(
      streamIPullUPullInventoryWithRequestGate(
        { onBatch: () => Effect.fail("sink failed") },
        (request) => request,
      ),
    ),
  );
  expect(failed).toMatchObject({ _tag: "Left", left: "sink failed" });
  const requests = mockCatalog(records);
  const terminal = await Effect.runPromise(
    streamIPullUPullInventoryWithRequestGate(
      {
        startCursor: 1,
        onBatch: () => Effect.die("unexpected batch"),
        onYards: () => Effect.die("unexpected yards"),
      },
      (request) => request,
    ),
  );
  expect(terminal).toMatchObject({ cursor: 1, pagesProcessed: 0, count: 0 });
  expect(requests).toHaveLength(0);
});

test("yard links reject off-site pages and metadata rejects wrong city and bad coordinates", () => {
  expect(
    ipullUPullDirectoryLinks(
      '<a href="https://evil.example/locations/fresno-ca/">x</a><a href="/locations/fresno-ca/">Fresno</a>',
    ),
  ).toHaveLength(1);
  const url = new URL("https://ipullupull.com/locations/fresno-ca/");
  expect(parseIPullUPullYard(page("Pomona"), url, "FRESNO")).toBeNull();
  expect(parseIPullUPullYard(page("Fresno", 100), url, "FRESNO")).toBeNull();
  const yard = parseIPullUPullYard(page("Fresno"), url, "FRESNO");
  expect(yard).not.toBeNull();
  if (!yard) return;
  expect(transformIPullUPullVehicle(first, yard)).toMatchObject({
    make: "Ford",
    model: "ESCAPE HYBRID",
    availableDate: "2026-09-14T00:00:00.000Z",
    row: "79",
    color: "Gray",
  });
  expect(
    transformIPullUPullVehicle(
      { ...first, "Yard Date": "2026-02-30T12:00:00" },
      yard,
    )?.availableDate,
  ).toBeNull();
  expect(transformIPullUPullVehicle({ ...first, Year: "0" }, yard)).toBeNull();
  expect(
    transformIPullUPullVehicle(first, { ...yard, lat: null, lng: null }),
  ).toBeNull();
});
