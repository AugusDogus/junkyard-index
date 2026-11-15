import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { oemgarageDonorId } from "./oemgarage-parser";
import {
  OEMGARAGE_CATALOG,
  OEMGARAGE_ORIGIN,
  OEMGARAGE_MAX_BYTES,
} from "./oemgarage-yard-metadata";

export class OemgarageProviderError extends Error {
  readonly tag = "OemgarageProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `oeM Garage ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const oemgarageRequestGate: ProviderRequestGate = (request) =>
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
    "oeM Garage " + url,
    signal,
    OEMGARAGE_MAX_BYTES,
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readOemgaragePage(
  url: string,
  gate: ProviderRequestGate = oemgarageRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (
        url !== OEMGARAGE_ORIGIN + "/" &&
        url !== OEMGARAGE_CATALOG &&
        (oemgarageDonorId(url) === null || URL.parse(url)?.href !== url)
      )
        return Effect.fail(
          new OemgarageProviderError(
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
          new OemgarageProviderError("request/body " + url, cause),
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
            new OemgarageProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
