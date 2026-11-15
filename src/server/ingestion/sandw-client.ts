import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { SANDW_API, SANDW_CATALOG, SANDW_OWNER } from "./sandw-yard-metadata";

export class SandwProviderError extends Error {
  readonly tag = "SandwProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `S&W ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const sandwRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );

async function document(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent": "JunkyardIndex/1.0",
      Accept: url === SANDW_API ? "application/json" : "text/html",
    },
  });
  const expected = url === SANDW_API ? "application/json" : "text/html";
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
    const failure = new Error(
      `Expected complete owned HTTP200 ${expected} at ${url}; received HTTP${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread body cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "S&W " + url,
    signal,
    2 * 1024 * 1024,
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readSandwPage(
  url: string,
  gate: ProviderRequestGate = sandwRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (![SANDW_API, SANDW_CATALOG, SANDW_OWNER].includes(url))
        return Effect.fail(
          new SandwProviderError(
            "destination",
            "URL is outside the verified native inventory controls",
          ),
        );
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = document(
            url,
            AbortSignal.any([lifetime.signal, deadline, interruption]),
          );
          return pending;
        },
        catch: (cause) => new SandwProviderError("request/body " + url, cause),
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
        Effect.timeoutFail({
          duration: "20 seconds",
          onTimeout: () =>
            new SandwProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
