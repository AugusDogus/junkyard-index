import { afterEach, expect, test } from "bun:test";
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import { streamGrandpajohnsInventoryWithRequestGate } from "./alln1-connector";
import { Alln1CursorSchema, GrandpajohnsCursor } from "./alln1-cursor";
import { parseAlln1Page } from "./alln1-parser";
import { GRANDPAJOHNS_TENANT } from "./alln1-yard-metadata";
import { transformUpullRecord } from "./alln1-transform";
import {
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-cursor";
import { validateSourceSnapshot } from "./source-validation";
import type { CanonicalVehicle } from "./types";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const archive = z
  .object({
    responses: z.array(z.object({ url: z.string(), html: z.string() })),
  })
  .parse(
    JSON.parse(
      brotliDecompressSync(
        await Bun.file(
          new URL(
            "./alln1-test-fixtures/grandpajohns.json.br",
            import.meta.url,
          ),
        ).bytes(),
      ).toString(),
    ),
  );
function mock(
  budget: number,
  rewrite: (html: string, index: number) => string = (html) => html,
) {
  // Resume anchors reuse opening captures. Terminal controls are separate live reads.
  const sequence = budget === 1 ? [0, 1, 0, 1, 2, 3, 4] : [0, 1, 2, 3, 4];
  let reads = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const index = sequence[reads++];
      const saved = index === undefined ? undefined : archive.responses[index];
      if (!saved || saved.url !== String(input))
        throw new Error("Unsaved U-Pull request " + String(input));
      return new Response(rewrite(saved.html, index ?? -1), {
        headers: { "content-type": "text/html" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => reads;
}
test.each([1, 2, 3, 32])(
  "Grandpa John's complete saved replay through durable checkpoints, budget %i",
  async (budget) => {
    const reads = mock(budget);
    let cursor = GrandpajohnsCursor.schema.parse(GrandpajohnsCursor.initial);
    const vehicles: CanonicalVehicle[] = [];
    let processed = 0,
      rejected = 0;
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamGrandpajohnsInventoryWithRequestGate(
          {
            startCursor: cursor,
            maxPages: budget,
            onBatch: (batch) =>
              Effect.sync(() => {
                vehicles.push(...batch);
              }),
          },
          gate,
        ),
      );
      processed += result.accounting?.recordsProcessed ?? 0;
      rejected += result.accounting?.recordsRejected ?? 0;
      cursor = parseDurableSourceCursor(
        "grandpajohns",
        serializeDurableSourceCursor(result.cursor),
      );
    }
    expect(reads()).toBe(budget === 1 ? 7 : 5);
    expect(vehicles).toHaveLength(636);
    expect(rejected).toBe(16);
    expect(
      vehicles.filter((vehicle) => vehicle.imageUrl !== null),
    ).toHaveLength(302);
    for (const invalid of [
      "1G6DM57N7301581A4",
      "1B3BD4FBFBN586782",
      "1FTZR15E61TA58985",
      "5N1AR18W37C612222",
      "1J8FF28W68D557370",
      "1GCDT136246216311",
      "1J4GL48K26W287387",
      "JHLRD78905C022937",
    ])
      expect(vehicles.some((vehicle) => vehicle.vin === invalid)).toBe(false);
    expect(processed).toBe(652);
    expect(new Set(vehicles.map((v) => v.vin)).size).toBe(636);
    for (const vehicle of vehicles) {
      expect(vehicle).toMatchObject({
        source: "grandpajohns",
        locationCode: "WI25",
        locationCity: "Green Bay",
        state: "Wisconsin",
        stateAbbr: "WI",
        lat: 44.552055694176,
        lng: -88.053118559214,
      });
      expect(vehicle.detailsUrl).toBe(
        GRANDPAJOHNS_TENANT.inventoryUrl + "&search=" + vehicle.vin,
      );
    }
    expect(
      createHash("sha256").update(JSON.stringify(vehicles)).digest("hex"),
    ).toBe("87ddc40a8ccc14ed038de0cc355db50e69c0d0a4091119bcd22c38e608fe6cb0");
    expect(
      validateSourceSnapshot({
        source: "grandpajohns",
        terminal: true,
        uniqueVehicles: vehicles.length,
        vehiclesProcessed: processed,
        rejectedVehicles: rejected,
        duplicateVehicles: 0,
        previousAcceptedCount: null,
        errors: [],
      }).errors,
    ).toEqual([]);
  },
);
test("Grandpa John's rejects foreign owner, scope, pagination and closing drift before callbacks", async () => {
  for (const rewrite of [
    (html: string, i: number) =>
      i === 0
        ? html.replaceAll("1746 Velp Avenue", "999 Foreign Street")
        : html,
    (html: string, i: number) =>
      i === 1 ? html.replace("'WI25'", "'MO42'") : html,
    (html: string, i: number) =>
      i === 1 ? html.replaceAll("pagenum=2", "pagenum=3") : html,
    (html: string, i: number) =>
      i === 4 ? html.replaceAll("STK014372", "STK999999") : html,
  ]) {
    mock(3, rewrite);
    let callbacks = 0;
    await expect(
      Effect.runPromise(
        streamGrandpajohnsInventoryWithRequestGate(
          {
            onBatch: () =>
              Effect.sync(() => {
                callbacks++;
              }),
          },
          gate,
        ),
      ),
    ).rejects.toThrow();
    expect(callbacks).toBe(0);
  }
});
test("U-Pull cursors cannot resume another tenant or follow its origin", async () => {
  const reads = mock(1);
  const first = await Effect.runPromise(
    streamGrandpajohnsInventoryWithRequestGate(
      { maxPages: 1, onBatch: () => Effect.void },
      gate,
    ),
  );
  expect(Alln1CursorSchema.safeParse(first.cursor).success).toBe(false);
  if (first.cursor.phase !== "pages")
    throw new Error("Expected paused native pages");
  expect(
    GrandpajohnsCursor.schema.safeParse({
      ...first.cursor,
      nextUrl: first.cursor.nextUrl.replace(
        "grandpajohnsautoparts.com",
        "alln1kc.com",
      ),
    }).success,
  ).toBe(false);
  expect(reads()).toBe(2);
  expect(
    GrandpajohnsCursor.schema.safeParse({ ...first.cursor, source: "alln1" })
      .success,
  ).toBe(false);
});
test("Grandpa John's native first-page invalid VINs stay rejected and foreign photos stay null", () => {
  const saved = archive.responses[1];
  if (!saved) throw new Error("Missing saved opening table");
  const page = parseAlln1Page(saved.html, 1, GRANDPAJOHNS_TENANT);
  expect(page.records).toHaveLength(500);
  expect(
    page.records.filter(
      (record) =>
        transformUpullRecord(record, GRANDPAJOHNS_TENANT).status !==
        "available",
    ),
  ).toHaveLength(14);
  expect(page.records.filter((record) => record.imageUrl !== null).length).toBe(
    306,
  );
  expect(
    page.records.find((record) => record.stock === "STK013463")?.imageUrl,
  ).toBe(
    "https://da8h1v3w8q6n5.cloudfront.net/wi25/images/STK013463/STK013463-1-85POZI_1.jpg",
  );
  const foreign = parseAlln1Page(
    saved.html.replaceAll("/wi25/images/", "/mo42/images/"),
    1,
    GRANDPAJOHNS_TENANT,
  );
  expect(foreign.records.every((record) => record.imageUrl === null)).toBe(
    true,
  );
});

test("Grandpa John's canonical VIN destination follows the independently verified native GET search", async () => {
  const html = brotliDecompressSync(
    await Bun.file(
      new URL(
        "./alln1-test-fixtures/grandpajohns-vin-search.html.br",
        import.meta.url,
      ),
    ).bytes(),
  ).toString();
  const vin = "1FMCU9GX9GUC13987";
  expect(html).toContain('name="search" value="' + vin + '"');
  const table = /<table\b[^>]*IISUpullTable[\s\S]*?<\/table>/i.exec(html)?.[0];
  if (!table) throw new Error("Missing saved VIN search table");
  expect([...table.matchAll(/<tr\b/gi)]).toHaveLength(2); // Header and one donor.
  expect(table).toContain(vin);
});
