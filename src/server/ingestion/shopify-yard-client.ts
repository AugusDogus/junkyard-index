import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";

export class ShopifyYardProviderError extends Error {
  readonly tag = "ShopifyYardProviderError";
  constructor(
    readonly source: string,
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `${source} ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; retain the last checkpoint and inspect the owned response before resuming.`,
      { cause },
    );
  }
}
export function shopifyRetryAfter(
  value: string | null,
  now = Date.now(),
): number {
  if (value !== null && /^\d+$/.test(value.trim())) return Number(value) * 1000;
  const date = value === null ? NaN : Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 60_000;
}
/** One in-flight request, including body cleanup, and a twelve-second completion gap. */
export function shopifyYardReader(
  source: string,
  destinations: ReadonlyMap<string, "text/html" | "application/json">,
) {
  const serial = Effect.runSync(Effect.makeSemaphore(1));
  let blockedUntil = 0;
  const gate: ProviderRequestGate = (request) =>
    serial.withPermits(1)(
      Effect.suspend(() =>
        Effect.sleep(Math.max(0, blockedUntil - Date.now())),
      ).pipe(
        Effect.zipRight(request),
        Effect.ensuring(
          Effect.suspend(() =>
            Effect.sleep(Math.max(12_000, blockedUntil - Date.now())),
          ),
        ),
      ),
    );
  return (url: string, requestGate: ProviderRequestGate = gate) => {
    const expected = destinations.get(url);
    if (!expected)
      return Effect.fail(
        new ShopifyYardProviderError(
          source,
          "destination",
          "URL is outside the verified inventory controls",
        ),
      );
    return requestGate(
      Effect.suspend(() => {
        const lifetime = new AbortController();
        let pending: Promise<string> | null = null;
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
              if (response.status === 429 || response.status === 503)
                blockedUntil = Math.max(
                  blockedUntil,
                  Date.now() +
                    shopifyRetryAfter(response.headers.get("retry-after")),
                );
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
            new ShopifyYardProviderError(source, "request/body " + url, cause),
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
      }),
    );
  };
}
