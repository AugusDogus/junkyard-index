import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { OEM_ARRIVALS, OEM_MAKES, oemOwnedUrl } from "./oem-html";
import { OEM_MAX_BODY_BYTES } from "./oem-cursor";

export class OemProviderError extends Data.TaggedError("OemProviderError")<{
  operation: string;
  cause: unknown;
}> {
  get message() {
    return `OEM ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Prior inventory is preserved; inspect the saved native response before resuming.`;
  }
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
const requestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );
async function document(url: string, signal: AbortSignal): Promise<string> {
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
      `Expected complete native HTTP 200 HTML at ${url}; received HTTP ${response.status}`,
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
    "OEM " + url,
    signal,
    OEM_MAX_BODY_BYTES,
  );
}
/** One owned GET/body lifetime. No retries, redirect following or hidden endpoint. */
export function readOemPage(
  url: string,
  gate: ProviderRequestGate = requestGate,
) {
  return gate(
    Effect.suspend(() => {
      const parsed = oemOwnedUrl(url);
      if (
        !parsed ||
        parsed.href !== url ||
        (![OEM_ARRIVALS, OEM_MAKES].includes(url) &&
          !/^\/parts\/[^/]+(?:\/[^/]+)?\/?$/.test(parsed.pathname))
      )
        return Effect.fail(
          new OemProviderError({
            operation: "request destination",
            cause: "URL is outside the owned donor graph: " + url,
          }),
        );
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(40000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          pending = document(
            url,
            AbortSignal.any([lifetime.signal, interrupted, deadline]),
          );
          return pending;
        },
        catch: (cause) =>
          new OemProviderError({ operation: "request/body " + url, cause }),
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
          duration: "40 seconds",
          onTimeout: () =>
            new OemProviderError({
              operation: "request/body " + url,
              cause: "Combined request/body deadline exceeded 40 seconds",
            }),
        }),
      );
    }),
  ).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof Error
        ? new OemProviderError({ operation: "shared host " + url, cause })
        : cause,
    ),
  );
}
