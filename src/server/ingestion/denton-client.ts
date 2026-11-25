import { sharedProviderHostSlot } from "./shared-provider-host";
import { Effect } from "effect";
import { z } from "zod";
import { DentonError, dentonOwnedUrl } from "./denton-html";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import { DENTON_ARRIVALS, DENTON_MAKES } from "./denton-yard-metadata";

export const DENTON_ABOUT = "https://dentonauto.com/about-us/";
export const DENTON_CONTACT = "https://dentonauto.com/contact/";
export const DENTON_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const DENTON_REQUEST_TIMEOUT_MS = 20_000;
export const DentonResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("document"), url: z.string(), body: z.string() })
    .strict(),
  z
    .object({
      kind: z.literal("redirect"),
      url: z.string(),
      target: z.string(),
      body: z.string(),
    })
    .strict(),
]);
export type DentonResponse = z.infer<typeof DentonResponseSchema>;

export function dentonRequestUrl(raw: string) {
  const url = dentonOwnedUrl(raw);
  return url?.href === raw &&
    ([DENTON_ABOUT, DENTON_CONTACT, DENTON_MAKES, DENTON_ARRIVALS].includes(
      raw,
    ) ||
      /^\/used-parts\/[^/]+(?:\/[^/]+)?\/?$/.test(url.pathname))
    ? url
    : null;
}
export function dentonSlashRedirect(from: string, to: string) {
  return (
    dentonRequestUrl(from) !== null && !from.endsWith("/") && to === from + "/"
  );
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const dentonRequestGate: ProviderRequestGate = (paced) =>
  serial.withPermits(1)(
    paced.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );

async function request(
  url: string,
  signal: AbortSignal,
): Promise<DentonResponse> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  });
  const target = response.headers.get("location");
  const redirect =
    response.status === 301 &&
    target !== null &&
    dentonSlashRedirect(url, target);
  if (
    (!redirect && response.status !== 200) ||
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
      `Expected owned complete HTTP 200 HTML or exact native slash HTTP 301 at ${url}; received HTTP ${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; unread body cancellation failed",
      );
    }
    throw failure;
  }
  const body =
    response.body === null &&
    redirect &&
    response.headers.get("content-length") === "0"
      ? ""
      : await readIPullUPullResponseText(
          response,
          "Denton " + url,
          signal,
          DENTON_MAX_BODY_BYTES,
        );
  return redirect && target !== null
    ? { kind: "redirect", url, target, body }
    : { kind: "document", url, body };
}

/** Exactly one physical GET and bounded body, with no retry or hidden redirect.
 * Callers pace it with `dentonRequestGate` outside the shared host turn, so
 * the gate does not hold the lane. */
export function readDentonPage(url: string) {
  return Effect.suspend(() => {
    if (!dentonRequestUrl(url))
      return Effect.fail(
        DentonError.create(
          "request destination",
          "URL is outside the owned catalog: " + url,
        ),
      );
    const lifetime = new AbortController();
    const deadline = AbortSignal.timeout(DENTON_REQUEST_TIMEOUT_MS);
    let pending: Promise<DentonResponse> | null = null;
    return Effect.tryPromise({
      try: (interrupted) => {
        pending = request(
          url,
          AbortSignal.any([lifetime.signal, interrupted, deadline]),
        );
        return pending;
      },
      catch: (cause) =>
        DentonError.create(
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
          DentonError.create(
            "request/body " + url,
            "Combined request and body deadline exceeded 20 seconds",
          ),
      }),
    );
  }).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof Error
        ? DentonError.create(
            "shared host " + url,
            cause instanceof Error ? cause.message : String(cause),
          )
        : cause,
    ),
  );
}
