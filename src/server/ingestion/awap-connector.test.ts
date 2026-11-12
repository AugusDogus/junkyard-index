import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { streamAwapInventoryWithRequestGate } from "./awap-connector";
import { fetchAwapPage } from "./awap-client";
import { AwapCursor } from "./awap-cursor";
import {
  awapSavedCensus,
  awapTestCard,
  awapTestPage,
} from "./awap-test-fixtures";
import type { AwapCanonicalVehicle } from "./awap-transform";
import { AWAP_ABOUT, AWAP_CATALOG, AWAP_YARD } from "./awap-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const gate = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect;
function source(
  pages = awapSavedCensus.pages,
  change: (raw: string, url: string, count: number) => string = (raw) => raw,
) {
  const requests: string[] = [];
  const counts = new Map<string, number>();
  const bodies = new Map([
    [AWAP_ABOUT, awapSavedCensus.about],
    ...pages.map((raw, index): [string, string] => [
      AWAP_CATALOG + (index === 0 ? "" : `page/${index + 1}/`),
      raw,
    ]),
  ]);
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("manual");
      requests.push(url);
      const body = bodies.get(url);
      if (body === undefined)
        throw new Error(
          "Unlisted AWAP request has no network fallback: " + url,
        );
      const count = (counts.get(url) ?? 0) + 1;
      counts.set(url, count);
      return new Response(change(body, url, count), {
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  return requests;
}

test("AWAP saved census completes with exact17 GETs and serialized one/eight-request chunks", async () => {
  for (const maxPages of [1, 8]) {
    const requests = source();
    const vehicles: AwapCanonicalVehicle[] = [];
    let yards = 0;
    let batches = 0;
    let cursor: AwapCursor = AwapCursor.initial;
    let chunks = 0;
    let peakCursorBytes = 0;
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamAwapInventoryWithRequestGate(
          {
            startCursor: cursor,
            maxPages,
            onBatch: (batch) =>
              Effect.sync(() => {
                batches++;
                vehicles.push(...batch);
              }),
            onYards: (batch) =>
              Effect.sync(() => {
                expect(batch).toEqual([AWAP_YARD]);
                yards++;
              }),
          },
          gate,
        ),
      );
      expect(result.pagesProcessed).toBeLessThanOrEqual(maxPages);
      const wire = AwapCursor.serialize(result.cursor);
      peakCursorBytes = Math.max(peakCursorBytes, Buffer.byteLength(wire));
      cursor = AwapCursor.parse(wire);
      chunks++;
      if (cursor.phase !== "complete") {
        expect(result.count).toBe(0);
        expect(result.observedVins).toEqual([]);
        expect(result.accounting.recordsProcessed).toBe(0);
        expect(vehicles).toEqual([]);
        expect(yards).toBe(0);
      } else {
        expect(result.count).toBe(183);
        expect(result.accounting).toEqual({
          recordsProcessed: 183,
          recordsRejected: 0,
          recordsExcluded: 0,
          duplicateVehicles: 0,
        });
      }
      if (chunks > 17)
        throw new Error("AWAP replay exceeded pinned17-request census");
    }
    expect(chunks).toBe(maxPages === 1 ? 17 : 3);
    expect(requests).toHaveLength(17);
    expect(requests.filter((url) => url === AWAP_ABOUT)).toHaveLength(1);
    expect(
      vehicles.map((vehicle) => [
        vehicle.vin,
        String(vehicle.year),
        vehicle.make.toLowerCase(),
        vehicle.model,
        vehicle.detailsUrl,
      ]),
    ).toEqual(
      awapSavedCensus.oracle.map((row) => [
        row.vin,
        row.yearText,
        row.make.toLowerCase(),
        row.model,
        row.detailUrl,
      ]),
    );
    expect(yards).toBe(1);
    expect(batches).toBe(1);
    expect(peakCursorBytes).toBeLessThan(2 * 1024 * 1024);
    await Effect.runPromise(
      streamAwapInventoryWithRequestGate(
        {
          startCursor: cursor,
          onBatch: () => Effect.die("Unexpected terminal callback"),
          onYards: () => Effect.die("Unexpected terminal yard"),
        },
        gate,
      ),
    );
    expect(requests).toHaveLength(17);
  }
});

test("AWAP rejects request, yard and batch failures without returning advanced checkpoints", async () => {
  for (const callback of ["yard", "batch"]) {
    const requests = source([awapTestPage()]);
    const first = await Effect.runPromise(
      streamAwapInventoryWithRequestGate(
        { maxPages: 1, onBatch: () => Effect.void },
        gate,
      ),
    );
    const wire = AwapCursor.serialize(first.cursor);
    let resolved = false;
    await expect(
      Effect.runPromise(
        streamAwapInventoryWithRequestGate(
          {
            startCursor: AwapCursor.parse(wire),
            onYards: () =>
              callback === "yard"
                ? Effect.fail(new Error("yard callback failed"))
                : Effect.void,
            onBatch: () => Effect.fail(new Error("batch callback failed")),
          },
          gate,
        ),
      ).then(() => {
        resolved = true;
      }),
    ).rejects.toThrow(callback + " callback failed");
    expect(resolved).toBe(false);
    expect(AwapCursor.serialize(first.cursor)).toBe(wire);
    const resumed = await Effect.runPromise(
      streamAwapInventoryWithRequestGate(
        { startCursor: AwapCursor.parse(wire), onBatch: () => Effect.void },
        gate,
      ),
    );
    expect(resumed.status).toBe("complete");
    expect(requests).toHaveLength(5);
  }
});

test("AWAP closing required drift fails globally while optional drift becomes null", async () => {
  source([awapTestPage()], (raw, url, count) =>
    url === AWAP_CATALOG && count === 2 ? raw.replaceAll("2003", "2004") : raw,
  );
  await expect(
    Effect.runPromise(
      streamAwapInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
    ),
  ).rejects.toThrow("closing catalog changed");
  const optional =
    '<div class="awap-cy-specs"><div><b>Color:</b> BLACK</div><div><b>Engine:</b> 2.4L</div><div><b>Trans:</b> Automatic</div></div><img src="https://www.alwholesaleautoparts.com/wp-content/uploads/first.jpg">';
  source(
    [awapTestPage(1, 1, [awapTestCard(1, { optional })])],
    (raw, url, count) =>
      url === AWAP_CATALOG && count === 2
        ? raw.replaceAll("BLACK", "WHITE").replace("first.jpg", "second.jpg")
        : raw,
  );
  const vehicles: AwapCanonicalVehicle[] = [];
  const result = await Effect.runPromise(
    streamAwapInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => vehicles.push(...batch)).pipe(Effect.asVoid),
      },
      gate,
    ),
  );
  expect(result.count).toBe(1);
  expect(vehicles[0]).toMatchObject({
    color: null,
    imageUrl: null,
    engine: "2.4L",
    transmission: "Automatic",
  });
});

test("AWAP no-retry transport rejects denials, redirects, partial and wrong-type responses", async () => {
  for (const response of [
    new Response("denied", { status: 403 }),
    new Response("busy", { status: 503 }),
    new Response("moved", { status: 302, headers: { Location: AWAP_CATALOG } }),
    new Response("partial", { status: 206 }),
    new Response("not HTML", {
      headers: { "Content-Type": "application/json" },
    }),
    new Response(awapSavedCensus.about, {
      headers: {
        "Content-Type": "text/html",
        "Content-Range": "bytes0-10/100",
      },
    }),
  ]) {
    let requests = 0;
    globalThis.fetch = Object.assign(
      async () => {
        requests++;
        return response;
      },
      { preconnect: originalFetch.preconnect },
    );
    await expect(
      Effect.runPromise(
        streamAwapInventoryWithRequestGate(
          { onBatch: () => Effect.void },
          gate,
        ),
      ),
    ).rejects.toThrow("Expected complete unredirected");
    expect(requests).toBe(1);
  }
});

test("AWAP preserves observed VINs for accepted10% incomplete metadata census", async () => {
  const cards = Array.from({ length: 10 }, (_, i) =>
    awapTestCard(i + 1, i === 0 ? { model: "unknown" } : {}),
  );
  source([awapTestPage(1, 10, cards)]);
  const result = await Effect.runPromise(
    streamAwapInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result.count).toBe(9);
  expect(result.observedVins).toEqual(["1HGCM82633A000001"]);
  expect(result.accounting.recordsRejected).toBe(1);
});

test("AWAP stops streaming at2MiB and preserves strict body completeness", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls++;
      if (pulls <= 4) controller.enqueue(new Uint8Array(1024 * 1024).fill(32));
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  globalThis.fetch = Object.assign(
    async () =>
      new Response(body, { headers: { "Content-Type": "text/html" } }),
    { preconnect: originalFetch.preconnect },
  );
  await expect(
    Effect.runPromise(fetchAwapPage(AWAP_ABOUT, gate)),
  ).rejects.toThrow("2 MiB");
  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThan(5);
  for (const response of [
    new Response("short", {
      headers: { "Content-Type": "text/html", "Content-Length": "999" },
    }),
    new Response(new Uint8Array([0xff]), {
      headers: { "Content-Type": "text/html" },
    }),
  ]) {
    globalThis.fetch = Object.assign(async () => response, {
      preconnect: originalFetch.preconnect,
    });
    await expect(
      Effect.runPromise(fetchAwapPage(AWAP_ABOUT, gate)),
    ).rejects.toThrow();
  }
});
