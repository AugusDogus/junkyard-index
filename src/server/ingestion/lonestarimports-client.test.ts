import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
  readLonestarimportsPage,
  lonestarimportsAllowedUrl,
} from "./lonestarimports-client";
import { LonestarimportsCursor } from "./lonestarimports-cursor";
import { streamLonestarimportsInventoryWithRequestGate } from "./lonestarimports-connector";
import { lonestarimportsNative } from "./lonestarimports-test-fixtures";
import type { ProviderRequestGate } from "./provider-http-client";

const identityGate: ProviderRequestGate = (request) => request;
const bodies = [
  ...lonestarimportsNative.openingDocuments,
  ...lonestarimportsNative.openingPages,
  ...lonestarimportsNative.closingPages,
  ...[...lonestarimportsNative.closingDocuments].reverse(),
];
test("all actual bodies replay through bounded production HTTP and durable eight-GET checkpoints", async () => {
  let reads = 0,
    gates = 0,
    batches = 0,
    chunks = 0,
    maxWireBytes = 0;
  const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        expect(lonestarimportsAllowedUrl(url)).toBe(true);
        expect(init?.method).toBe("GET");
        expect(init?.redirect).toBe("manual");
        const raw = bodies[reads++];
        if (!raw) throw new Error("Unexpected physical request");
        return new Response(raw, {
          headers: {
            "content-type": new URL(url).pathname.startsWith("/api/")
              ? "application/json"
              : "text/html",
            "content-length": String(Buffer.byteLength(raw)),
          },
        });
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );
  const gate: ProviderRequestGate = (request) =>
    Effect.suspend(() => {
      gates++;
      return request;
    });
  try {
    let cursor = LonestarimportsCursor.initial(null);
    while (cursor.phase !== "complete") {
      const result = await Effect.runPromise(
        streamLonestarimportsInventoryWithRequestGate(
          {
            previousAcceptedCount: null,
            startCursor: cursor,
            onBatch: (items) =>
              Effect.sync(() => {
                batches++;
                expect(items).toHaveLength(2532);
              }),
          },
          gate,
        ),
      );
      chunks++;
      expect(result.pagesProcessed).toBe(8);
      const wire = LonestarimportsCursor.serialize(result.cursor, null);
      maxWireBytes = Math.max(maxWireBytes, Buffer.byteLength(wire));
      cursor = LonestarimportsCursor.fromWire(wire, null);
      if (result.status === "complete")
        expect(result.accounting).toEqual({
          recordsProcessed: 2560,
          recordsRejected: 9,
          recordsExcluded: 19,
          duplicateVehicles: 0,
        });
      else expect(result.count).toBe(0);
    }
    expect([reads, gates, batches, chunks]).toEqual([264, 264, 1, 33]);
    expect(maxWireBytes).toBeLessThan(16 * 1024 * 1024);
    console.log(
      JSON.stringify({
        lonestarimportsActualReplay: {
          reads,
          gates,
          batches,
          chunks,
          maxWireBytes,
        },
      }),
    );
  } finally {
    fetchSpy.mockRestore();
  }
}, 30_000);
test("foreign hosts, guessed controls and alias routes cannot dispatch", async () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  try {
    for (const url of [
      "https://lonestarimport.com/api/new-arrivals?page=1",
      "https://www.lonestarimport.com/api/new-arrivals?page=0",
      "https://www.lonestarimport.com/api/new-arrivals?page=501",
      "https://www.lonestarimport.com/api/new-arrivals?page=1&limit=1000",
      "https://www.lonestarimport.com/api/new-arrivals?page=1#x",
      "https://example.com/",
      "https://www.lonestarimport.com/admin",
    ])
      expect(
        (
          await Effect.runPromiseExit(
            readLonestarimportsPage(url, identityGate),
          )
        )._tag,
      ).toBe("Failure");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
});
test("denial, redirect, partial HTTP and media-type drift fail once without retry", async () => {
  for (const response of [
    new Response("denied", { status: 403 }),
    new Response("", {
      status: 302,
      headers: { location: "https://example.com" },
    }),
    new Response("{}", {
      status: 206,
      headers: {
        "content-type": "application/json",
        "content-range": "bytes 0-1/10",
      },
    }),
    new Response("{}", { headers: { "content-type": "text/html" } }),
  ]) {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      expect(
        (
          await Effect.runPromiseExit(
            readLonestarimportsPage(
              "https://www.lonestarimport.com/api/new-arrivals?page=1",
              identityGate,
            ),
          )
        )._tag,
      ).toBe("Failure");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fetchSpy.mockRestore();
    }
  }
});
test("the custom gate includes the entire response-body lifetime", async () => {
  let deliver: (() => void) | undefined,
    gateDone = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      deliver = () => {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      };
    },
  });
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(stream, { headers: { "content-type": "application/json" } }),
  );
  const gate: ProviderRequestGate = (request) =>
    request.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          gateDone = true;
        }),
      ),
    );
  try {
    const pending = Effect.runPromise(
      readLonestarimportsPage(
        "https://www.lonestarimport.com/api/new-arrivals?page=1",
        gate,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(gateDone).toBe(false);
    if (!deliver) throw new Error("Response stream was not initialized");
    deliver();
    expect(await pending).toBe("{}");
    expect(gateDone).toBe(true);
  } finally {
    fetchSpy.mockRestore();
  }
});
