import { sharedProviderHostSlot } from "./shared-provider-host";
import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { CALTON_MAKES, CALTON_ROOT, CaltonError } from "./calton-contract";
import { caltonOwnedUrl } from "./calton-html";

export const CALTON_REQUEST_TIMEOUT_MS = 20_000;
/** Saved census: largest observed body 1,240,697 bytes at 493 Accord cards.
 * This matches the capture's 2 MiB guard, not the small test graph. */
export const CALTON_MAX_BODY_BYTES = 2 * 1024 * 1024;
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const caltonRequestGate: ProviderRequestGate = (request) =>
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
      `Expected complete owned HTTP 200 text/html at ${url}; received HTTP ${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread response cancellation also failed",
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Calton " + url,
    signal,
    CALTON_MAX_BODY_BYTES,
  );
}

/** One request/body lifetime, no retry, redirects or hidden detail endpoint.
 * Callers pace it with `caltonRequestGate` outside the shared host turn, so
 * the gate does not hold the lane. */
export function readCaltonPage(url: string) {
  return Effect.suspend(() => {
    const parsed = caltonOwnedUrl(url);
    if (
      !parsed ||
      parsed.href !== url ||
      (![CALTON_ROOT, CALTON_MAKES].includes(url) &&
        !/^\/parts\/[^/]+(?:\/[^/]+)?$/.test(parsed.pathname))
    )
      return Effect.fail(
        CaltonError.create(
          "request destination",
          "URL is outside the owned root/make/model graph: " + url,
        ),
      );
    const lifetime = new AbortController(),
      deadline = AbortSignal.timeout(CALTON_REQUEST_TIMEOUT_MS);
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
        CaltonError.create(
          "request/body " + url,
          cause instanceof Error ? cause.message : String(cause),
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
      Effect.timeoutFail({
        duration: "20 seconds",
        onTimeout: () =>
          CaltonError.create(
            "request/body " + url,
            "Combined request and body deadline exceeded 20 seconds",
          ),
      }),
    );
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof Error
        ? CaltonError.create("shared host " + url, cause.message)
        : cause,
    ),
  );
}
