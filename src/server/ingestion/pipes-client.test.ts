import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { fetchPipesControl } from "./pipes-client";

const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
});
const immediate = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
function response(
  body: BodyInit | null,
  headers: Record<string, string>,
  status = 200,
) {
  globalThis.fetch = Object.assign(
    async () => new Response(body, { status, headers }),
    { preconnect: originalFetch.preconnect },
  );
  return Effect.runPromise(
    fetchPipesControl({ kind: "context", index: 0 }, immediate),
  );
}
test("Pipes rejects partial status, wrong MIME, missing bodies and dishonest length", async () => {
  await expect(
    response("body", { "content-type": "text/html" }, 206),
  ).rejects.toThrow("HTTP 200");
  await expect(
    response("body", { "content-type": "application/json" }),
  ).rejects.toThrow("HTTP 200");
  await expect(response(null, { "content-type": "text/html" })).rejects.toThrow(
    "no body",
  );
  await expect(
    response("body", { "content-type": "text/html", "content-length": "5" }),
  ).rejects.toThrow("Incomplete");
  await expect(
    response("body", {
      "content-type": "text/html",
      "content-range": "bytes 0-3/5",
    }),
  ).rejects.toThrow("HTTP 200");
});
test("Pipes rejects oversized and invalid UTF-8 bodies", async () => {
  await expect(
    response(new Uint8Array(4 * 1024 * 1024 + 1), {
      "content-type": "text/html",
    }),
  ).rejects.toThrow("4 MiB");
  await expect(
    response(new Uint8Array([255]), { "content-type": "text/html" }),
  ).rejects.toThrow();
});
test("Pipes shares one request deadline across fetch and complete body reading", async () => {
  AbortSignal.timeout = (delay) => {
    expect(delay).toBe(20_000);
    return originalTimeout(100);
  };
  globalThis.fetch = Object.assign(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      let timer: ReturnType<typeof setTimeout>;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            timer = setTimeout(() => {
              controller.enqueue(new TextEncoder().encode("body"));
              controller.close();
            }, 60);
          },
          cancel() {
            clearTimeout(timer);
          },
        }),
        { status: 200, headers: { "content-type": "text/html" } },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  // Each half would fit a fresh 100 ms timer. The combined 120 ms must fail.
  await expect(
    Effect.runPromise(
      fetchPipesControl({ kind: "context", index: 0 }, immediate),
    ),
  ).rejects.toThrow();
});
