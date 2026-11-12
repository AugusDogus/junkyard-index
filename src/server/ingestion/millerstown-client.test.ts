import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  fetchMillerstownHtml,
  fetchMillerstownPdf,
} from "./millerstown-client";
import { MILLERSTOWN_FIXTURE_PDF_URL } from "./millerstown-test-fixtures";
import type { ProviderRequestGate } from "./provider-http-client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
const immediate: ProviderRequestGate = (request) => request;
function respond(response: () => Response | Promise<Response>) {
  globalThis.fetch = Object.assign(async () => response(), {
    preconnect: originalFetch.preconnect,
  });
}
const html = () => Effect.runPromise(fetchMillerstownHtml("root", immediate));
test("client uses one gated public GET without redirect or retry", async () => {
  let calls = 0;
  let gates = 0;
  const gate: ProviderRequestGate = (request) =>
    Effect.sync(() => {
      gates++;
    }).pipe(Effect.zipRight(request));
  globalThis.fetch = Object.assign(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      calls++;
      expect(String(url)).toBe("http://picapartyard.com/");
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.headers).toEqual({
        "User-Agent": "JunkyardIndex/1.0",
        Accept: "text/html",
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response("<html></html>", {
        headers: {
          "content-type": "text/html; charset=UTF-8",
          "content-length": "13",
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  expect(await Effect.runPromise(fetchMillerstownHtml("root", gate))).toBe(
    "<html></html>",
  );
  expect({ calls, gates }).toEqual({ calls: 1, gates: 1 });
});
for (const [name, status, headers] of [
  ["partial status", 206, { "content-type": "text/html" }],
  ["server failure", 503, { "content-type": "text/html" }],
  [
    "partial range",
    200,
    { "content-type": "text/html", "content-range": "bytes 0-1/20" },
  ],
  ["wrong MIME", 200, { "content-type": "application/json" }],
  ["missing MIME", 200, {}],
] as const)
  test(`client rejects and cancels ${name} without retry`, async () => {
    let calls = 0;
    let cancelled = false;
    respond(() => {
      calls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { status, headers },
      );
    });
    await expect(html()).rejects.toThrow("complete unredirected HTTP 200");
    expect(calls).toBe(1);
    expect(cancelled).toBe(true);
  });
for (const [name, property, value] of [
  ["redirect flag", "redirected", true],
  ["changed final URL", "url", "http://picapartyard.com/other/"],
] as const)
  test(`client rejects ${name}`, async () => {
    respond(() => {
      const response = new Response("body", {
        headers: { "content-type": "text/html" },
      });
      Object.defineProperty(response, property, { value });
      return response;
    });
    await expect(html()).rejects.toThrow("unredirected");
  });
for (const length of ["9", "oops", "-1"])
  test(`client rejects incomplete or invalid length ${length}`, async () => {
    respond(
      () =>
        new Response("body", {
          headers: { "content-type": "text/html", "content-length": length },
        }),
    );
    await expect(html()).rejects.toThrow("Incomplete native body");
  });
test("client rejects invalid UTF-8", async () => {
  respond(
    () =>
      new Response(new Uint8Array([0xc3, 0x28]), {
        headers: { "content-type": "text/html" },
      }),
  );
  await expect(html()).rejects.toThrow("UTF-8");
});
test("client enforces streamed HTML byte limit and cancels overflow", async () => {
  let cancelled = false;
  respond(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
  );
  await expect(html()).rejects.toThrow("exceeds 4194304");
  expect(cancelled).toBe(true);
});
test("client enforces streamed PDF limit and rejects fake PDF MIME bodies", async () => {
  respond(
    () =>
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
        headers: { "content-type": "application/pdf" },
      }),
  );
  await expect(
    Effect.runPromise(
      fetchMillerstownPdf(MILLERSTOWN_FIXTURE_PDF_URL, immediate),
    ),
  ).rejects.toThrow("exceeds 8388608");
  respond(
    () =>
      new Response("<html>not a PDF</html>", {
        headers: { "content-type": "application/pdf" },
      }),
  );
  await expect(
    Effect.runPromise(
      fetchMillerstownPdf(MILLERSTOWN_FIXTURE_PDF_URL, immediate),
    ),
  ).rejects.toThrow("PDF signature");
});
test("body reader failures propagate as source failures", async () => {
  respond(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(new Error("truncated transport"));
          },
        }),
        { headers: { "content-type": "text/html" } },
      ),
  );
  await expect(html()).rejects.toThrow("truncated transport");
});
test("fetch failures preserve retry-from-start recovery wording", async () => {
  respond(() => Promise.reject(new Error("offline")));
  await expect(html()).rejects.toThrow(
    "Previous published inventory is preserved",
  );
});
