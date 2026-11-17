import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  ALSAUTO_CATALOG,
  alsautoPageUrl,
  ALSAUTO_MAX_PAGES,
  ALSAUTO_MAX_BODY_BYTES,
} from "./alsauto-configuration";

export class AlsautoProviderError extends Error {
  readonly tag = "AlsautoProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Al's Auto Salvage ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const alsautoRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1800 millis"))),
  );

async function document(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: url === ALSAUTO_CATALOG ? "text/html" : "application/json",
    },
  });
  const expected = url === ALSAUTO_CATALOG ? "text/html" : "application/json";
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
    "Al's Auto Salvage " + url,
    signal,
    ALSAUTO_MAX_BODY_BYTES,
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readAlsautoPage(
  url: string,
  gate: ProviderRequestGate = alsautoRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        ![
          ALSAUTO_CATALOG,
          ...Array.from({ length: ALSAUTO_MAX_PAGES }, (_, index) =>
            alsautoPageUrl(index + 1),
          ),
        ].includes(url)
      )
        return Effect.fail(
          new AlsautoProviderError(
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
        catch: (cause) =>
          new AlsautoProviderError("request/body " + url, cause),
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
            new AlsautoProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
