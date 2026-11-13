import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  CARS4PARTS_INVENTORY,
  CARS4PARTS_ORIGIN,
  CARS4PARTS_MAX_BODY_BYTES,
  cars4partsLeafUrl,
} from "./cars4parts-html";
import { Cars4PartsResult } from "./cars4parts-result";

export const CARS4PARTS_REQUEST_TIMEOUT_MS = 20_000;
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Module scope retains serialization and the completion gap across chunks. */
export const cars4partsRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );
export function cars4partsRequestUrl(value: string): boolean {
  const url = URL.parse(value);
  if (
    !url ||
    url.href !== value ||
    url.origin !== CARS4PARTS_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  )
    return false;
  if (value === CARS4PARTS_INVENTORY || cars4partsLeafUrl(value) === value)
    return true;
  if (url.pathname !== "/wp-admin/admin-ajax.php") return false;
  const fields = url.search.slice(1).split("&");
  if (
    (fields.length !== 3 && fields.length !== 4) ||
    fields[0] !== "action=ajax_custom_search" ||
    fields[1] !== "cps_use_ajax=1"
  )
    return false;
  if (fields.length === 4) {
    const page = /^page=([1-9]\d*)$/.exec(fields[2] ?? "")?.[1];
    if (!page || Number(page) > 200) return false;
  }
  const nonce = fields.at(-1) ?? "";
  return (
    nonce !== "" &&
    String(Number(nonce)) === nonce &&
    Number(nonce) >= 0 &&
    Number(nonce) < 1
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
    "Cars4Parts " + url,
    signal,
    CARS4PARTS_MAX_BODY_BYTES,
  );
}
/** One abortable request/body lifetime, manual redirects, no retry. */
export function readCars4PartsPage(
  url: string,
  gate: ProviderRequestGate = cars4partsRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (!cars4partsRequestUrl(url))
        return Effect.fail(
          Cars4PartsResult.error(
            "request destination",
            "URL is outside the owned inventory/leaf and source-defined native AJAX graph: " +
              url,
          ),
        );
      const lifetime = new AbortController(),
        deadline = AbortSignal.timeout(CARS4PARTS_REQUEST_TIMEOUT_MS);
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
          Cars4PartsResult.error(
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
            Cars4PartsResult.error(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
