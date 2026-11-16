import { Clock, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";

export class ShopifyYardProviderError extends Error {
  readonly tag = "ShopifyYardProviderError";
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
    readonly retryAt: number | null = null,
  ) {
    super(
      `${source} ${operation}: ${cause instanceof Error ? cause.message : String(cause)}.${retryAt === null ? "" : " Retry at " + new Date(retryAt).toISOString() + "."} Prior inventory is preserved; retain the last checkpoint and inspect the owned response before resuming.`,
      { cause },
    );
  }
}
export function shopifyRetryAfter(
  value: string | null,
  now = Date.now(),
): number {
  // Bound malformed or implausible provider pauses to one day, never Infinity.
  const maximum = 86_400_000;
  if (value !== null && /^\d+$/.test(value.trim()))
    return Math.min(maximum, Number(value) * 1000);
  const date = value === null ? NaN : Date.parse(value);
  return Number.isFinite(date)
    ? Math.min(maximum, Math.max(0, date - now))
    : 60_000;
}
/** One in-flight request, including body cleanup, and a twelve-second completion gap. */
export function shopifyYardReader(
  source: string,
  destinations: ReadonlyMap<string, "text/html" | "application/json">,
) {
  const serial = Effect.runSync(Effect.makeSemaphore(1));
  let blockedUntil = 0;
  const wait = (deadline: number) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      if (Math.max(now, blockedUntil) >= deadline)
        return yield* Effect.fail(
          new ShopifyYardProviderError(
            source,
            "request pacing",
            "Provider pause exceeds the remaining chunk budget; resume the last checkpoint after the retry time",
            Math.max(now, blockedUntil),
          ),
        );
      yield* Effect.sleep(Math.max(0, blockedUntil - now));
    });
  const gate = (
    request: Effect.Effect<string, ShopifyYardProviderError>,
    deadline: number,
  ) =>
    serial.withPermits(1)(
      Effect.gen(function* () {
        yield* wait(deadline);
        const result = yield* Effect.exit(
          request.pipe(
            Effect.ensuring(
              Clock.currentTimeMillis.pipe(
                Effect.tap((now) =>
                  Effect.sync(() => {
                    blockedUntil = Math.max(blockedUntil, now + 12_000);
                  }),
                ),
              ),
            ),
          ),
        );
        // Pacing must remain interruptible. Finalizers only clean up the body.
        yield* wait(deadline);
        return yield* result;
      }),
    );
  return (
    url: string,
    options: { deadline?: number; requestGate?: ProviderRequestGate } = {},
  ) => {
    const expected = destinations.get(url);
    if (!expected)
      return Effect.fail(
        new ShopifyYardProviderError(
          source,
          "destination",
          "URL is outside the verified inventory controls",
        ),
      );
    return Effect.gen(function* () {
      const clock = yield* Effect.clock;
      const deadline =
        options.deadline ?? clock.unsafeCurrentTimeMillis() + 180_000;
      const request = Effect.suspend(() => {
        const lifetime = new AbortController();
        let pending: Promise<string> | null = null;
        let retryAt: number | null = null;
        return Effect.tryPromise({
          try: (interruption) => {
            pending = (async () => {
              const signal = AbortSignal.any([
                lifetime.signal,
                interruption,
                AbortSignal.timeout(25_000),
              ]);
              const response = await fetch(url, {
                method: "GET",
                redirect: "manual",
                signal,
                headers: {
                  "User-Agent":
                    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
                  Accept: expected,
                  "Accept-Language": "en-US,en;q=0.9",
                },
              });
              if (response.status === 429 || response.status === 503) {
                const now = clock.unsafeCurrentTimeMillis();
                retryAt =
                  now +
                  shopifyRetryAfter(response.headers.get("retry-after"), now);
                blockedUntil = Math.max(blockedUntil, retryAt);
              }
              if (
                response.status !== 200 ||
                response.redirected ||
                (response.url && response.url !== url) ||
                response.headers.has("content-range") ||
                response.headers
                  .get("content-type")
                  ?.split(";")[0]
                  ?.trim()
                  .toLowerCase() !== expected
              ) {
                await response.body?.cancel();
                throw new Error(
                  `Expected complete owned HTTP200 ${expected} at ${url}; received HTTP${response.status}${response.status === 429 ? "; resume after Retry-After " + (response.headers.get("retry-after") ?? "60 seconds") : ""}`,
                );
              }
              return readIPullUPullResponseText(
                response,
                source + " " + url,
                signal,
                4 * 1024 * 1024,
              );
            })();
            return pending;
          },
          catch: (cause) =>
            new ShopifyYardProviderError(
              source,
              "request/body " + url,
              cause,
              retryAt,
            ),
        }).pipe(
          Effect.ensuring(
            Effect.promise(async () => {
              lifetime.abort();
              if (pending)
                await pending.then(
                  () => undefined,
                  () => undefined,
                );
            }),
          ),
        );
      });
      return yield* options.requestGate
        ? options.requestGate(request)
        : gate(request, deadline);
    });
  };
}
