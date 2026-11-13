import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  RMMDTP_INVENTORY,
  RMMDTP_MAX_BODY_BYTES,
  rmmdtpPageUrl,
} from "./rmmdtp-html";
import { RmmdtpResult } from "./rmmdtp-result";

export const RMMDTP_REQUEST_TIMEOUT_MS = 20_000;
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Module scope retains serialization and the completion gap across chunks. */
export const rmmdtpRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );
export function rmmdtpRequestUrl(value: string): boolean {
  if (value === RMMDTP_INVENTORY) return true;
  const url = URL.parse(value);
  const page = Number(url?.searchParams.get("page_number"));
  return (
    url !== null && url.href === value && rmmdtpPageUrl(value, page) === value
  );
}
async function document(url: string, signal: AbortSignal) {
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
      `Expected complete owned HTTP200 text/html at ${url}; received HTTP${response.status}`,
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
    "Rmmdtp " + url,
    signal,
    RMMDTP_MAX_BODY_BYTES,
  );
}
/** One abortable request/body lifetime, manual redirects, no retry. */
export function readRmmdtpPage(
  url: string,
  gate: ProviderRequestGate = rmmdtpRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (!rmmdtpRequestUrl(url))
        return Effect.fail(
          RmmdtpResult.error(
            "request destination",
            "URL is outside the owned unfiltered native truck graph: " + url,
          ),
        );
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(RMMDTP_REQUEST_TIMEOUT_MS);
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
          RmmdtpResult.error(
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
            RmmdtpResult.error(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
