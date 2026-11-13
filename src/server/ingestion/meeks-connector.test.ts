import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import { streamMeeksInventoryWithRequestGate } from "./meeks-connector";
import { MeeksCursor, MeeksCursorSchema } from "./meeks-cursor";
import type { MeeksCanonicalVehicle } from "./meeks-transform";
import {
  MEEKS_FULL_INVENTORY_URL,
  MEEKS_INVENTORY_URL,
  MEEKS_ORIGIN,
} from "./meeks-yard-metadata";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const fixture = (name: string) =>
  readFileSync(
    new URL(`./meeks-test-fixtures/${name}.html`, import.meta.url),
    "utf8",
  );
const primary = fixture("full-inventory");
const secondary = fixture("inventory").replace(
  /<tbody>([\s\S]*?)<\/tbody>/,
  (_whole: string, body: string) =>
    `<tbody>${body.match(/<tr\b[\s\S]*?<\/tr>/)?.[0] ?? ""}</tbody>`,
);
const gate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;

function mockSource(
  change: (body: string, index: number) => Response = (body) =>
    new Response(body, { headers: { "content-type": "text/html" } }),
  views = { primary, secondary },
) {
  const bodies = [
    fixture("owner"),
    views.primary,
    views.secondary,
    views.primary,
    views.secondary,
  ];
  const urls = [
    MEEKS_ORIGIN + "/",
    MEEKS_FULL_INVENTORY_URL,
    MEEKS_INVENTORY_URL,
    MEEKS_FULL_INVENTORY_URL,
    MEEKS_INVENTORY_URL,
  ];
  let requests = 0;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const index = requests++;
      const expectedUrl = urls[index];
      if (expectedUrl === undefined)
        throw new Error("Expected five bounded Meeks source reads");
      expect(String(input)).toBe(expectedUrl);
      expect(init?.redirect).toBe("manual");
      return change(bodies[index] ?? "", index);
    },
    { preconnect: originalFetch.preconnect },
  );
  return () => requests;
}

test("Meeks emits once after both source-owned views and closing controls validate", async () => {
  const requests = mockSource();
  const vehicles: MeeksCanonicalVehicle[] = [];
  const result = await Effect.runPromise(
    streamMeeksInventoryWithRequestGate(
      {
        onBatch: (batch) =>
          Effect.sync(() => {
            vehicles.push(...batch);
          }),
      },
      gate,
    ),
  );
  expect(requests()).toBe(5);
  expect(result).toMatchObject({
    status: "complete",
    count: 2,
    pagesProcessed: 1,
    accounting: {
      recordsProcessed: 2,
      recordsRejected: 0,
      duplicateVehicles: 0,
    },
  });
  expect(
    vehicles.find((v) => v.vin === "6G3NS5U36EL982322")?.availableDate,
  ).toBeNull();
  expect(vehicles.every((v) => v.detailsUrl === MEEKS_FULL_INVENTORY_URL)).toBe(
    true,
  );
});

test.each([0, 1, 2, 3, 4])(
  "Meeks blocks a partial response at control %i before callbacks and never retries",
  async (failed) => {
    const requests = mockSource(
      (body, index) =>
        new Response(body, {
          status: index === failed ? 206 : 200,
          headers: { "content-type": "text/html" },
        }),
    );
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamMeeksInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(requests()).toBe(failed + 1);
    expect(callbacks).toBe(0);
  },
);

test.each([3, 4])(
  "Meeks rejects changed closing contents at control %i before emission",
  async (changed) => {
    const requests = mockSource(
      (body, index) =>
        new Response(
          index === changed ? body.replace("CAPRICE", "DIFFERENT") : body,
          { headers: { "content-type": "text/html" } },
        ),
    );
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamMeeksInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("changed during");
    expect(requests()).toBe(changed + 1);
    expect(callbacks).toBe(0);
  },
);

test("Meeks complete-cursor replay performs no requests or callbacks", async () => {
  const requests = mockSource();
  const result = await Effect.runPromise(
    streamMeeksInventoryWithRequestGate(
      {
        startCursor: { source: "meeks", phase: "complete" },
        onBatch: () => Effect.die("unexpected callback"),
      },
      gate,
    ),
  );
  expect(requests()).toBe(0);
  expect(result).toMatchObject({
    count: 0,
    status: "complete",
    pagesProcessed: 0,
  });
});

test("Meeks validates explicit complete cursors and budgets before the no-I/O replay", async () => {
  const requests = mockSource();
  const invalid = { source: "meeks", phase: "complete", page: 2 } as const;
  expect(MeeksCursorSchema.safeParse(invalid).success).toBe(false);
  expect(
    MeeksCursorSchema.safeParse({ ...MeeksCursor.initial, source: "other" })
      .success,
  ).toBe(false);
  await expect(
    Effect.runPromise(
      streamMeeksInventoryWithRequestGate(
        {
          startCursor: invalid,
          onBatch: () => Effect.die("Unexpected callback"),
        },
        gate,
      ),
    ),
  ).rejects.toThrow("Invalid cursor or page budget");
  for (const maxPages of [0, -1, 1.5, 33, NaN])
    await expect(
      Effect.runPromise(
        streamMeeksInventoryWithRequestGate(
          {
            startCursor: { source: "meeks", phase: "complete" },
            maxPages,
            onBatch: () => Effect.die("Unexpected callback"),
          },
          gate,
        ),
      ),
    ).rejects.toThrow("Invalid cursor or page budget");
  expect(requests()).toBe(0);
});

test("Meeks rejects network, destination, body-length and UTF-8 failures without emission or retry", async () => {
  const refusals: readonly ((body: string) => Response)[] = [
    (body) =>
      new Response(body, {
        status: 302,
        headers: { location: MEEKS_INVENTORY_URL, "content-type": "text/html" },
      }),
    (body) =>
      new Response(body, {
        status: 200,
        headers: {
          "content-range": "bytes 0-1/100",
          "content-type": "text/html",
        },
      }),
    (body) =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    (body) =>
      new Response(body, {
        status: 503,
        headers: { "content-type": "text/html" },
      }),
    (body) =>
      new Response(body, {
        status: 200,
        headers: { "content-length": "100000", "content-type": "text/html" },
      }),
    (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "url", { value: "https://example.com/" });
      return response;
    },
    (body) => {
      const response = new Response(body, {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, "redirected", { value: true });
      return response;
    },
    () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Broken body"));
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
    () => {
      throw new Error("Network failure");
    },
  ];
  for (const refusal of refusals) {
    const requests = mockSource((body, index) =>
      index === 2
        ? refusal(body)
        : new Response(body, { headers: { "content-type": "text/html" } }),
    );
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamMeeksInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(requests()).toBe(3);
    expect(callbacks).toBe(0);
  }
});

test.each([0, 1, 2])(
  "Meeks rejects changed source controls at %i before closing reads or emission",
  async (failed) => {
    const requests = mockSource(
      (body, index) =>
        new Response(index === failed ? body.replace("</html>", "") : body, {
          headers: { "content-type": "text/html" },
        }),
    );
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamMeeksInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("previous inventory is preserved");
    expect(requests()).toBe(failed === 0 ? 1 : 3);
    expect(callbacks).toBe(0);
  },
);

test("Meeks fails when a consistency donor is absent from the full primary inventory", async () => {
  const requests = mockSource(undefined, {
    primary,
    secondary: secondary.replaceAll("6G3NS5U36EL982322", "JH4CU26689C019172"),
  });
  let callbacks = 0;
  const callback = () =>
    Effect.sync(() => {
      callbacks++;
    });
  await expect(
    Effect.runPromise(
      streamMeeksInventoryWithRequestGate(
        { onBatch: callback, onYards: callback },
        gate,
      ),
    ),
  ).rejects.toThrow("absent from the primary");
  expect(requests()).toBe(3);
  expect(callbacks).toBe(0);
});

const firstRow = primary.match(/<tbody>(<tr\b[\s\S]*?<\/tr>)/)?.[1] ?? "";
function inventoryViews(count: number, rejected = 0, duplicates = 0) {
  const rows = Array.from({ length: count }, (_, index) =>
    firstRow
      .replaceAll(
        "1FMZU63E22ZA65206",
        "1FMZU63E22ZA" + String(index).padStart(5, "0"),
      )
      .replaceAll("STK000034", "STK" + String(index).padStart(6, "0"))
      .replace("EXPLORER", index < rejected ? "" : "EXPLORER"),
  );
  const first = rows[0] ?? "";
  for (let index = 0; index < duplicates; index++) rows.push(first);
  return {
    primary: primary.replace(
      /<tbody>[\s\S]*?<\/tbody>/,
      "<tbody>" + rows.join("") + "</tbody>",
    ),
    secondary: secondary
      .replaceAll("6G3NS5U36EL982322", "1FMZU63E22ZA00000")
      .replaceAll("2014", "2002")
      .replace("CHEVROLET", "FORD")
      .replace("CAPRICE", rejected > 0 ? "" : "EXPLORER"),
  };
}

test("Meeks preserves valid rejected VIN presence at exactly 10% primary rejection", async () => {
  mockSource(undefined, inventoryViews(10, 1));
  const result = await Effect.runPromise(
    streamMeeksInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result).toMatchObject({
    count: 9,
    observedVins: ["1FMZU63E22ZA00000"],
    accounting: {
      recordsProcessed: 10,
      recordsRejected: 1,
      duplicateVehicles: 0,
    },
  });
});

test("Meeks counts primary duplicates at exactly 25% without counting consistency controls", async () => {
  mockSource(undefined, inventoryViews(3, 0, 1));
  const result = await Effect.runPromise(
    streamMeeksInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result).toMatchObject({
    count: 3,
    accounting: {
      recordsProcessed: 4,
      recordsRejected: 0,
      duplicateVehicles: 1,
    },
  });
});

test("Meeks quality above either primary limit fails before closing reads or callbacks", async () => {
  for (const views of [inventoryViews(10, 2), inventoryViews(3, 0, 2)]) {
    const requests = mockSource(undefined, views);
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks++;
      });
    await expect(
      Effect.runPromise(
        streamMeeksInventoryWithRequestGate(
          { onBatch: callback, onYards: callback },
          gate,
        ),
      ),
    ).rejects.toThrow("quality failed");
    expect(requests()).toBe(3);
    expect(callbacks).toBe(0);
  }
});

test("Meeks semantic closing guards tolerate an unrelated updated-at label change", async () => {
  mockSource(
    (body, index) =>
      new Response(index > 2 ? body.replace("1:30 am", "1:31 am") : body, {
        headers: { "content-type": "text/html" },
      }),
  );
  const result = await Effect.runPromise(
    streamMeeksInventoryWithRequestGate({ onBatch: () => Effect.void }, gate),
  );
  expect(result.count).toBe(2);
});
