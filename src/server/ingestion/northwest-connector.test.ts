import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  streamNorthwestInventoryWithRequestGate,
  type NorthwestStreamResult,
} from "./northwest-connector";
import { NorthwestCursor } from "./northwest-cursor";
import {
  NORTHWEST_MAKES,
  NORTHWEST_ORIGIN,
  NORTHWEST_ROOT,
} from "./northwest-yard-metadata";
import {
  isDurableSourceCursorTerminal,
  parseDurableSourceCursor,
  serializeDurableSourceCursor,
} from "./durable-source";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
const MAKE = "/parts/ACURA";
const MODELS = 12;
const DONORS = 200;
const envelope = (content: string) =>
  `<!doctype html><html><head><script>var urgid = 'AK01'; var iisHomeUrl = 'northwestautoparts.com';</script></head><body>${content}<footer>Northwest Auto Parts 5700 Camelot Drive Anchorage, AK 99504 907-333-6531</footer></body></html>`;
const directory = (
  controls: { path: string; label: string; count: number }[],
) =>
  envelope(
    controls
      .map(
        (c) =>
          `<a class="iis-center-block" href="${NORTHWEST_ORIGIN + c.path}">${c.label} <span class="badge">${c.count}</span></a>`,
      )
      .join(""),
  );
const modelPage = (i: number) =>
  envelope(
    `<h1>Used ACURA M${i} Parts</h1>` +
      Array.from({ length: DONORS }, (_, n) => {
        const stock = `ST${i}-${n}`;
        const vin = "1HGCM82633A" + String(i * 1000 + n + 1).padStart(6, "0");
        return `<div class="card card-price"><div class="car-details"><b>Stock:</b> ${stock}<br><b>Year:</b> 2010<br><b>Make/Model:</b> ACURA M${i}<br><b>Vin:</b> ${vin}<br></div><a href="${NORTHWEST_ORIGIN}/parts/ACURA/M${i}/${stock}/2010">See Parts</a></div>`;
      }).join(""),
  );

/** Twelve ACURA models with 200 donors each, above the coverage floor. */
function transport() {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const model = /\/parts\/ACURA\/M(\d+)\/$/.exec(url);
      const body =
        url === NORTHWEST_ROOT
          ? envelope(`<a href="${NORTHWEST_MAKES}">Parts</a>`)
          : url === NORTHWEST_MAKES
            ? directory([
                { path: MAKE, label: "ACURA", count: MODELS * DONORS },
              ])
            : url === NORTHWEST_ORIGIN + MAKE
              ? directory(
                  Array.from({ length: MODELS }, (_, i) => ({
                    path: `${MAKE}/M${i}/`,
                    label: "M" + i,
                    count: DONORS,
                  })),
                )
              : model
                ? modelPage(Number(model[1]))
                : undefined;
      if (body === undefined) throw new Error("Unexpected request " + url);
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
}

test("Northwest cold crawl ends on a terminal census cursor and its first checkpoint is not terminal", async () => {
  transport();
  let cursor: NorthwestCursor = NorthwestCursor.initial;
  let midWire: string | null = null;
  for (let chunk = 0; chunk < 20 && cursor.phase !== "complete"; chunk++) {
    const result: NorthwestStreamResult = await Effect.runPromise(
      streamNorthwestInventoryWithRequestGate(
        { startCursor: cursor, maxPages: 3, onBatch: () => Effect.void },
        gate,
      ),
    );
    const wire = serializeDurableSourceCursor(result.cursor);
    midWire ??= wire;
    cursor = parseDurableSourceCursor("northwest", wire);
  }
  expect(cursor.phase).toBe("complete");
  const wire = serializeDurableSourceCursor(cursor);
  const parsed = parseDurableSourceCursor("northwest", wire);
  expect(serializeDurableSourceCursor(parsed)).toBe(wire);
  if (parsed.phase !== "complete") throw new Error("Expected terminal cursor");
  expect(parsed.census?.models.length ?? 0).toBeGreaterThan(0);
  expect(isDurableSourceCursorTerminal("northwest", wire)).toBe(true);
  expect(midWire).not.toBeNull();
  expect(midWire).not.toBe(wire);
  expect(isDurableSourceCursorTerminal("northwest", midWire)).toBe(false);
});
