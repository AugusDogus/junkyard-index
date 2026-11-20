import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { Effect } from "effect";
import { z } from "zod";
import { ALLIED_CONTRACT } from "./allied-configuration";
import {
  streamAlliedInventory,
  type AlliedStreamResult,
} from "./allied-connector";
import { AlliedCursor } from "./allied-cursor";
import { ALLIED_ORIGIN } from "./allied-html";
import { AlliedResult } from "./allied-result";
import { alliedValue } from "./allied-test-fixtures";

const census = z
  .array(z.object({ url: z.string(), body: z.string() }).strict())
  .parse(
    JSON.parse(
      brotliDecompressSync(
        readFileSync(
          new URL("./allied-test-fixtures/census.json.br", import.meta.url),
        ),
      ).toString(),
    ),
  );
// Nov 19 raw-ampersand captures of the two "_-and_" model controls whose
// literal Nov 15 routes returned explicit empties despite badges 15 and 10.
const ampersand = z
  .record(z.string(), z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./allied-test-fixtures/ampersand-models.json.gz",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
// Nov 20 literal captures of the two parenthesized model controls whose
// percent-encoded Nov 15 routes returned explicit empties despite badge 1.
// Each lists one VIN-less card with a nonstandard stock (NOF, CORMTR).
const parenthesis = z
  .record(z.string(), z.string())
  .parse(
    JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            "./allied-test-fixtures/parenthesis-models.json.gz",
            import.meta.url,
          ),
        ),
      ).toString(),
    ),
  );
const ampersandRoutes = new Map([
  [
    ALLIED_ORIGIN + "/parts/CHRYSLER/TOWN_-and_COUNTRY/",
    ALLIED_ORIGIN + "/parts/CHRYSLER/TOWN_&_COUNTRY/",
  ],
  [
    ALLIED_ORIGIN + "/parts/LINCOLN/LINCOLN_-and_TOWN_CAR/",
    ALLIED_ORIGIN + "/parts/LINCOLN/LINCOLN_&_TOWN_CAR/",
  ],
]);
// Every donor VIN on those two raw-ampersand pages; none is in prod today.
const ampersandVins = [
  "1C4GP64L0WB554699",
  "1LNBM83F0JY617506",
  "1LNBP96F7FY623383",
  "1LNHM81VX7Y636254",
  "1LNHM82W03Y642565",
  "1LNHM82W66Y624995",
  "1LNHM82W72Y672063",
  "2A4RR5DG0BR733282",
  "2C4GP44383R260601",
  "2C4GP54L45R175392",
  "2C4RC1BG0CR306267",
  "2C4RC1BG1GR166607",
  "2C4RC1BG3FR565503",
  "2C4RC1BG4DR519692",
  "2C4RC1BG8CR410571",
  "2C4RC1BG8FR707215",
  "2C4RC1BG8GR148377",
  "2C4RC1CG2CR368915",
  "2C4RC1CG6ER176593",
];

/** Replay the ordered census, serving the raw-ampersand capture in place of
 * the literal "_-and_" explicit empty. Each position accepts its literal
 * census URL, or only the raw-ampersand spelling of the two broken routes. */
function replay(responses: readonly { url: string; body: string }[]) {
  const requested: string[] = [];
  const vins: string[] = [];
  let batches = 0;
  const readPage = (url: string) => {
    const response = responses[requested.length];
    requested.push(url);
    const substitute = response && ampersandRoutes.get(response.url);
    const body =
      response?.url === url
        ? (parenthesis[url] ?? response.body)
        : substitute === url
          ? ampersand[url]
          : undefined;
    return body === undefined
      ? Effect.fail(
          AlliedResult.error(
            "offline census",
            `Unexpected request ${requested.length}: ${url}`,
          ),
        )
      : Effect.succeed(body);
  };
  const onBatch = (vehicles: { vin: string }[]) =>
    Effect.sync(() => {
      expect(requested).toHaveLength(responses.length);
      expect(new Set(vehicles.map((vehicle) => vehicle.vin)).size).toBe(
        vehicles.length,
      );
      vins.push(...vehicles.map((vehicle) => vehicle.vin));
      batches++;
    });
  return Effect.gen(function* () {
    let cursor = AlliedCursor.initial(ALLIED_CONTRACT);
    let complete: AlliedStreamResult | null = null;
    while (cursor.phase !== "complete") {
      const result = yield* streamAlliedInventory({
        contract: ALLIED_CONTRACT,
        previousUniqueInventory: null,
        startCursor: cursor,
        maxPages: 4,
        readPage,
        onBatch,
      });
      cursor = alliedValue(
        AlliedCursor.fromWire(
          alliedValue(AlliedCursor.serialize(result.cursor, ALLIED_CONTRACT)),
          ALLIED_CONTRACT,
        ),
      );
      if (result.status === "paused") {
        expect(batches).toBe(0);
        expect(result.count).toBe(0);
      } else complete = result;
    }
    const again = yield* streamAlliedInventory({
      contract: ALLIED_CONTRACT,
      previousUniqueInventory: null,
      startCursor: cursor,
      readPage,
      onBatch,
    });
    expect(again.status).toBe("complete");
    return { complete, requested, vins, batches };
  });
}

test("Allied replays the complete ordered live census and closing controls before publishing", async () => {
  const { complete, requested, vins, batches } = await Effect.runPromise(
    replay(census),
  );
  // The two "_-and_" model controls are requested with the raw ampersand and
  // their donors are accepted under the "_and__" donor destinations.
  expect(ampersandVins.filter((vin) => !vins.includes(vin))).toEqual([]);
  expect(requested[166]).toBe(
    ALLIED_ORIGIN + "/parts/CHRYSLER/TOWN_&_COUNTRY/",
  );
  expect(requested[345]).toBe(
    ALLIED_ORIGIN + "/parts/LINCOLN/LINCOLN_&_TOWN_CAR/",
  );
  expect(requested).toHaveLength(577);
  expect(batches).toBe(1);
  expect(complete?.count).toBe(2_526);
  expect(complete?.accounting).toEqual({
    recordsProcessed: 3_437,
    recordsRejected: 86,
    recordsExcluded: 786,
    duplicateVehicles: 39,
  });
  const warnings = complete?.warnings.join(" ") ?? "";
  expect(warnings).toContain("not a yard total");
  expect(warnings).toContain(
    "3/3389 advertised model donors sit on routes proven unreachable on this host",
  );
  for (const route of [
    "/parts/CHRYSLER/NEW_YORKER_(FWD)/",
    "/parts/PLYMOUTH/PLYMOUTH_PASS./",
    "/parts/SUBARU/SUBARU_PASS./",
  ])
    expect(warnings).toContain(`: 1 [${route}]`);
  // Literal parenthesized routes list their cards, so they are no longer
  // tolerated as unreachable.
  for (const route of [
    "/parts/GMC/SAFARI_(GMC)/",
    "/parts/ISUZU/ISUZU_PUP_(PICKUP)/",
  ])
    expect(warnings).not.toContain(route);
}, 120_000);
