import { expect, test } from "bun:test";
import { Effect, Either, RateLimiter } from "effect";
import { SourceSoakMetrics } from "../../../scripts/source-soak-metrics";
import type { IngestionSource } from "../../lib/ingestion-source";

test("concurrent scoped sources keep requests, statuses and network errors attributed across yields", async () => {
  const originalFetch = globalThis.fetch;
  const networkError = new Error("mock connection reset");
  const seen = new Set<string>();
  let release: () => void = () => {};
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fakeFetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/start") {
        seen.add(url.hostname);
        if (seen.size === 2) release();
        // Both sources must run concurrently to release these requests.
        await bothStarted;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (url.pathname === "/error") throw networkError;
      return new Response(null, {
        status: url.hostname === "row52" ? 200 : 429,
      });
    },
    { preconnect: originalFetch.preconnect },
  );
  globalThis.fetch = fakeFetch;
  const metrics = new SourceSoakMetrics();
  const restoreFetch = metrics.installFetchMetrics();
  const request = (source: IngestionSource, path: string) =>
    Effect.tryPromise({
      try: () => fetch(`https://${source}${path}`),
      catch: (error) => error,
    });
  const run = (source: "row52" | "pullapart") =>
    metrics.runPromise(
      source,
      Effect.scoped(
        Effect.gen(function* () {
          const gate = yield* RateLimiter.make({
            limit: 1,
            interval: "1 millis",
          });
          yield* gate(request(source, "/start"));
          yield* Effect.yieldNow();
          // Exercise scheduler inheritance in child fibers as well as the root.
          yield* Effect.all(
            [gate(request(source, "/child")), Effect.sleep("1 millis")],
            { concurrency: "unbounded" },
          );
          if (source === "pullapart") {
            const result = yield* Effect.either(
              gate(request(source, "/error")),
            );
            expect(Either.isLeft(result) && result.left).toBe(networkError);
          }
          return source;
        }),
      ),
    );

  try {
    expect(await Promise.all([run("row52"), run("pullapart")])).toEqual([
      "row52",
      "pullapart",
    ]);
    expect(metrics.metricsFor("row52")).toEqual({
      requests: 2,
      statuses: new Map([[200, 2]]),
      networkErrors: 0,
    });
    expect(metrics.metricsFor("pullapart")).toEqual({
      requests: 3,
      statuses: new Map([[429, 2]]),
      networkErrors: 1,
    });

    // Calls outside a source are passed through without inheriting the last fiber.
    expect((await fetch("https://row52/untracked")).status).toBe(200);
    expect(metrics.metricsFor("row52").requests).toBe(2);
    restoreFetch();
    expect(globalThis.fetch).toBe(fakeFetch);
  } finally {
    restoreFetch();
    globalThis.fetch = originalFetch;
  }
});
