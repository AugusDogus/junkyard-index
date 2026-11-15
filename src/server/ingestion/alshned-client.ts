import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  alshnedDonorHandle,
  alshnedListingPage,
  ALSHNED_CONTACT,
  ALSHNED_MAX_BYTES,
} from "./alshned-parser";

export class AlshnedProviderError extends Error {
  readonly tag = "AlshnedProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Alshned ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved. Inspect the native evidence and retain the last validated checkpoint before resuming.`,
      { cause },
    );
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Shared across invocations, including errors and interrupted request cleanup. */
export const alshnedRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("2500 millis"))),
  );
async function readDocument(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  });
  if (
    response.status !== 200 ||
    response.redirected ||
    (response.url && response.url !== url) ||
    response.headers.has("content-range") ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "text/html"
  ) {
    const failure = new Error(
      `Expected complete unredirected HTTP200 HTML at ${url}; received ${response.status}`,
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
    "Alshned " + url,
    signal,
    ALSHNED_MAX_BYTES,
  );
}
export function fetchAlshnedPage(
  url: string,
  gate: ProviderRequestGate = alshnedRequestGate,
) {
  if (
    URL.parse(url)?.href !== url ||
    (url !== ALSHNED_CONTACT &&
      alshnedListingPage(url) === null &&
      alshnedDonorHandle(url) === null)
  )
    return Effect.fail(
      new AlshnedProviderError(
        "destination",
        "URL is outside the native donor catalog",
      ),
    );
  return gate(
    Effect.suspend(() => {
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(25_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readDocument(
            url,
            AbortSignal.any([lifetime.signal, deadline, interruption]),
          );
          return pending;
        },
        catch: (cause) => cause,
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
          duration: "25 seconds",
          onTimeout: () =>
            new Error(
              "Combined Alshned fetch/body deadline exceeded 25 seconds",
            ),
        }),
      );
    }),
  ).pipe(Effect.mapError((cause) => new AlshnedProviderError(url, cause)));
}
export function alshnedValidated<T>(operation: string, read: () => T) {
  return Effect.try({
    try: read,
    catch: (cause) => new AlshnedProviderError(operation, cause),
  });
}
