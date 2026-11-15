import { Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  LONESTARIMPORTS_ORIGIN,
  LONESTARIMPORTS_DOCUMENTS,
  LONESTARIMPORTS_MAX_PAGES,
  LONESTARIMPORTS_MAX_BODY_BYTES,
} from "./lonestarimports-yard-metadata";

export class LonestarimportsProviderError extends Error {
  readonly tag = "LonestarimportsProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Lonestar Imports ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native evidence and resume from the last validated checkpoint.`,
      { cause },
    );
  }
}
export { LONESTARIMPORTS_MAX_BODY_BYTES } from "./lonestarimports-yard-metadata";
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const lonestarimportsRequestGate: ProviderRequestGate = (request) =>
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
      Accept: "text/html, application/json",
    },
  });
  const expected =
    new URL(url).pathname === "/api/new-arrivals"
      ? "application/json"
      : "text/html";
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
    "Lonestar Imports " + url,
    signal,
    LONESTARIMPORTS_MAX_BODY_BYTES,
  );
}

export function lonestarimportsAllowedUrl(raw: string): boolean {
  const url = URL.parse(raw);
  if (
    !url ||
    url.origin !== LONESTARIMPORTS_ORIGIN ||
    url.username ||
    url.password ||
    url.hash
  )
    return false;
  if (
    LONESTARIMPORTS_DOCUMENTS.some(
      (path) => raw === LONESTARIMPORTS_ORIGIN + path,
    )
  )
    return true;
  const page = /^\?page=([1-9]\d{0,2})$/.exec(url.search)?.[1];
  return (
    url.pathname === "/api/new-arrivals" &&
    page !== undefined &&
    Number(page) <= LONESTARIMPORTS_MAX_PAGES &&
    raw === LONESTARIMPORTS_ORIGIN + url.pathname + url.search
  );
}

/** No retries. The gate owns the entire request/body lifetime and completion gap. */
export function readLonestarimportsPage(
  url: string,
  gate: ProviderRequestGate = lonestarimportsRequestGate,
) {
  return gate(
    Effect.suspend(() => {
      if (!lonestarimportsAllowedUrl(url))
        return Effect.fail(
          new LonestarimportsProviderError(
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
          new LonestarimportsProviderError("request/body " + url, cause),
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
            new LonestarimportsProviderError(
              "request/body " + url,
              "Combined request and body deadline exceeded 20 seconds",
            ),
        }),
      );
    }),
  );
}
