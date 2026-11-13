import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchAplusPage } from "./aplus-client";
import { parseAplusModel } from "./aplus-parser";
import { aplusSnapshot } from "./aplus-snapshot";
import {
  aplusFixtureMake,
  aplusFixtureModel,
  aplusFixtureModelPage,
  aplusFixturePage,
  aplusFixtureRecord,
} from "./aplus-test-fixtures";
import { APLUS_CONTACT } from "./aplus-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("A Plus quarantines every occurrence of one VIN with two donor destinations", () => {
  const original = aplusFixtureRecord(1);
  const alternate = aplusFixtureRecord(1);
  alternate[3] = "ST2";
  alternate[4] = "/parts/ACURA/ILX/ST2/2003";
  const snapshot = aplusSnapshot(
    [{ ...aplusFixtureMake, models: [aplusFixtureModel] }],
    [aplusFixturePage([original])],
    [aplusFixturePage([alternate])],
  );
  expect(snapshot.vehicles).toHaveLength(0);
  expect(snapshot.accounting.recordsRejected).toBe(2);
  expect(snapshot.accounting.duplicateVehicles).toBe(0);
  expect(snapshot.observedVins).toEqual([original[0]]);
});

test("A Plus refuses an explicit numeric donor continuation", () => {
  const raw = aplusFixtureModelPage([aplusFixtureRecord(1)]).replace(
    '<input id="dev-table-filter">',
    '<input id="dev-table-filter"><nav aria-label="Pagination"><a href="?page=2">2</a></nav>',
  );
  expect(() =>
    parseAplusModel(raw, aplusFixtureMake, aplusFixtureModel),
  ).toThrow("continuation");
});

test("A Plus enforces its 2 MiB source limit while reading the response", async () => {
  const chunkBytes = 64 * 1024;
  let bytesRead = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (bytesRead >= 3 * 1024 * 1024) {
          controller.close();
          return;
        }
        bytesRead += chunkBytes;
        controller.enqueue(new Uint8Array(chunkBytes).fill(65));
      },
    },
    { highWaterMark: 0 },
  );
  globalThis.fetch = Object.assign(
    async () =>
      new Response(body, { headers: { "content-type": "text/html" } }),
    { preconnect: originalFetch.preconnect },
  );
  const result = await Effect.runPromise(
    Effect.either(fetchAplusPage(APLUS_CONTACT, (request) => request)),
  );
  expect(result._tag).toBe("Left");
  expect(bytesRead).toBeLessThanOrEqual(2 * 1024 * 1024 + chunkBytes);
});
