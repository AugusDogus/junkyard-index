import { expect, spyOn, test } from "bun:test";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import { fetchCstruckPage } from "./cstruck-client";
import { fetchDutchersPage } from "./dutchers-client";
import { CSTRUCK_STORE, cstruckRangeUrl } from "./cstruck-yard-metadata";
import { DUTCHERS_STORE } from "./dutchers-yard-metadata";
import { cstruckFixture } from "./cstruck-test-fixtures";

const pass = <A, E, R>(request: Effect.Effect<A, E, R>) => request;
test("HTTP allowlist rejects foreign suppliers, range page links, inquiries and unsupported controls before fetching", async () => {
  const fetcher = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected network"),
  );
  try {
    for (const url of [
      CSTRUCK_STORE.replace("7131988", "3987345"),
      cstruckRangeUrl([1970, 1998]) + "&page=2",
      "https://www.heavytruckparts.net/partinquiry.php?partid=5528&productcode=7131988&store=1",
      cstruckRangeUrl([1970, 1998]).replace("1970", "1900"),
      cstruckRangeUrl({ page: 2 }).replace("page=2", "page=16"),
      cstruckRangeUrl({ page: 2 }).replace("SortBy=year", "SortBy=model"),
    ])
      await expect(Effect.runPromise(fetchCstruckPage(url))).rejects.toThrow(
        "outside",
      );
    expect(fetcher).toHaveBeenCalledTimes(0);
  } finally {
    fetcher.mockRestore();
  }
});

test.each([200, 403, 429])(
  "both HTP suppliers share one serial gate and four completed seconds after HTTP %i",
  async (status) => {
    const fetcher = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async () =>
          new Response(cstruckFixture("store-opening"), {
            status,
            headers: { "Content-Type": "text/html" },
          }),
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const first = yield* Effect.fork(
            Effect.either(fetchCstruckPage(CSTRUCK_STORE)),
          );
          const second = yield* Effect.fork(
            Effect.either(fetchDutchersPage(DUTCHERS_STORE, pass)),
          );
          yield* TestClock.adjust("3999 millis");
          expect(fetcher).toHaveBeenCalledTimes(1);
          yield* TestClock.adjust("1 millis");
          expect(fetcher).toHaveBeenCalledTimes(2);
          yield* TestClock.adjust("4 seconds");
          const results = [yield* Fiber.join(first), yield* Fiber.join(second)];
          expect(
            results.every(
              (result) => result._tag === (status === 200 ? "Right" : "Left"),
            ),
          ).toBe(true);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    } finally {
      fetcher.mockRestore();
    }
  },
);

test.each([
  [200, { "Content-Type": "application/json" }],
  [206, { "Content-Type": "text/html" }],
  [302, { "Content-Type": "text/html", Location: "https://example.com" }],
  [200, { "Content-Type": "text/html", "Content-Range": "bytes 0-5/10" }],
] as const)(
  "invalid HTTP envelope %i stops without retries",
  async (status, headers) => {
    const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("invalid", { status, headers }),
    );
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            Effect.either(fetchCstruckPage(CSTRUCK_STORE)),
          );
          yield* TestClock.adjust("4 seconds");
          const result = yield* Fiber.join(fiber);
          expect(result._tag).toBe("Left");
          expect(fetcher).toHaveBeenCalledTimes(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    } finally {
      fetcher.mockRestore();
    }
  },
);

test.each([1, 2, 15])(
  "HTTP allowlist accepts exact unfiltered native page %i",
  async (page) => {
    const fetcher = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(cstruckFixture("unfiltered-1"), {
        headers: { "Content-Type": "text/html" },
      }),
    );
    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(
            fetchCstruckPage(cstruckRangeUrl({ page })),
          );
          yield* TestClock.adjust("4 seconds");
          expect(yield* Fiber.join(fiber)).toContain("C&S Truck Sales");
          expect(fetcher).toHaveBeenCalledTimes(1);
        }).pipe(Effect.provide(TestContext.TestContext)),
      );
    } finally {
      fetcher.mockRestore();
    }
  },
);
