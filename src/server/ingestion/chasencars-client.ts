import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  CHASENCARS_YARD_URL,
  CHASENCARS_CATALOG,
  CHASENCARS_OWNER,
} from "./chasencars-yard-metadata";

export class ChasencarsProviderError extends Error {
  readonly tag = "ChasencarsProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Chase N Cars ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
export const CHASENCARS_MAX_BODY_BYTES = 2 * 1024 * 1024;
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const chasencarsRequestGate: ProviderRequestGate = (request) =>
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
      Accept: "text/html",
    },
  });
  const expected = "text/html";
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
    "Chase N Cars " + url,
    signal,
    CHASENCARS_MAX_BODY_BYTES,
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readChasencarsPage(
  url: string,
  gate: ProviderRequestGate = chasencarsRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        ![CHASENCARS_YARD_URL, CHASENCARS_CATALOG, CHASENCARS_OWNER].includes(
          url,
        )
      )
        return Effect.fail(
          new ChasencarsProviderError(
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
          new ChasencarsProviderError("request/body " + url, cause),
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
            new ChasencarsProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
