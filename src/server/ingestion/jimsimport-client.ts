import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { jimsimportControlPath } from "./jimsimport-parser";
import {
  JIMSIMPORT_CATALOG,
  JIMSIMPORT_OWNER,
  JIMSIMPORT_MAX_BYTES,
} from "./jimsimport-yard-metadata";

export class JimsimportProviderError extends Error {
  readonly tag = "JimsimportProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Jim's Import ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const jimsimportRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("2500 millis"))),
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
    "Jim's Import " + url,
    signal,
    JIMSIMPORT_MAX_BYTES,
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readJimsimportPage(
  url: string,
  gate: ProviderRequestGate = jimsimportRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        url !== JIMSIMPORT_OWNER &&
        url !== JIMSIMPORT_CATALOG &&
        ((jimsimportControlPath(url, 1) === null &&
          jimsimportControlPath(url, 2) === null) ||
          URL.parse(url)?.href !== url)
      )
        return Effect.fail(
          new JimsimportProviderError(
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
          new JimsimportProviderError("request/body " + url, cause),
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
            new JimsimportProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
