import { IisSupplierIdentityError } from "./iis-supplier-identity";
import { ProviderTurnDeferred } from "./provider-chunk-clock";
import { sharedProviderHostRequest } from "./shared-provider-host";
import { Effect, Schedule } from "effect";
import { parseRetryAfterMs } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { randomBytes } from "node:crypto";
import {
  iisBrowsePath,
  iisDocumentComplete,
  iisOwnedUrl,
} from "./urgiis-catalog";
import type { UrgiisTenant } from "./urgiis-tenant";
import { urgiisModelRoute } from "./urgiis-model-route";

export type UrgiisError = {
  tag: "UrgiisError";
  operation: string;
  message: string;
  /** Set when a retry of this failed read could not get a shared host turn
   * within the chunk, so fewer attempts than usual ran. */
  retryDeferred?: ProviderTurnDeferred;
} & (
  | { kind: "failure" }
  | { kind: "identity" }
  | { kind: "blocked"; status: 403 | 429; retryAfterMs: number }
);
export const urgiisError = (
  operation: string,
  cause: unknown,
): UrgiisError => ({
  tag: "UrgiisError",
  kind: cause instanceof IisSupplierIdentityError ? "identity" : "failure",
  operation,
  message: `URG IIS ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the saved response or resume the last validated checkpoint.`,
});
const BLOCKED_BODY_PREFIX_BYTES = 500;
const describeCause = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
/** Shows whether a CDN rule or the origin refused a blocked request, using
 * only headers and a bounded prefix of the body already sent. Never rejects:
 * a body that cannot be read is reported in the evidence instead. */
async function blockedResponseEvidence(response: Response): Promise<string> {
  const headers = ["server", "cf-ray", "cf-mitigated"]
    .map((name) => `${name}=${response.headers.get(name) ?? "absent"}`)
    .join(", ");
  const reader = response.body?.getReader();
  if (!reader) return `${headers}; body: none`;
  let body: string;
  try {
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (length < BLOCKED_BODY_PREFIX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      length += value.byteLength;
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    body = JSON.stringify(
      new TextDecoder()
        .decode(bytes.subarray(0, BLOCKED_BODY_PREFIX_BYTES))
        .replace(/\s+/g, " ")
        .trim(),
    );
  } catch (cause) {
    body = `unreadable (${describeCause(cause)})`;
  }
  const cancelled = await reader.cancel().then(
    () => "",
    (cause: unknown) => `; body cancel failed (${describeCause(cause)})`,
  );
  return `${headers}; body prefix: ${body}${cancelled}`;
}
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Cloudflare statuses that serve a stored copy instead of the origin. */
const CLOUDFLARE_CACHED = /^(hit|stale|updating|revalidated)$/i;
/** The stored copy's Cloudflare status, or null for an origin response. */
const cloudflareCopy = (response: Response) => {
  const status = response.headers.get("cf-cache-status")?.trim() ?? null;
  return status !== null && CLOUDFLARE_CACHED.test(status) ? status : null;
};
/**
 * URG tenants' Cloudflare cache rule stores query-less parts pages for hours,
 * including a render the origin cut off. Norb's served `/parts/ACURA` that way
 * on November 25 and 26, 2026: 67,462 bytes ending mid-page after a 10.7 s
 * render, cached since 11:14 UTC. A query string misses that rule when the
 * request carries `urg_hv=1`, and the plugin does not reflect it into links.
 */
const cacheBustUrl = (requestUrl: string) =>
  requestUrl +
  (requestUrl.includes("?") ? "&" : "?") +
  "cb=" +
  randomBytes(8).toString("hex");
export const URGIIS_MAX_BODY_BYTES = 4 * 1024 * 1024;
export function readUrgiisPage(url: string, tenant: UrgiisTenant) {
  const owned = iisOwnedUrl(url, tenant);
  if (
    !owned ||
    (![tenant.ownerPath, tenant.makesPath, tenant.arrivalsPath].includes(
      owned.pathname,
    ) &&
      !iisBrowsePath(url, 1, tenant) &&
      !iisBrowsePath(url, 2, tenant) &&
      !(tenant.attribution.kind === "seller" && iisBrowsePath(url, 4, tenant)))
  )
    return Effect.fail(
      urgiisError(
        "request destination",
        "URL is outside the qualified native graph: " + url,
      ),
    );
  // Some WordPress filters reject literal parentheses in native model slugs.
  // Encode them for HTTP while retaining the published graph and checkpoints.
  const requestUrl = new URL(
    urgiisModelRoute(owned.pathname, tenant).requestPath,
    tenant.origin,
  ).href
    .replaceAll("(", "%28")
    .replaceAll(")", "%29");
  /** One read of `target`. A cache-busted read must reach the origin. */
  const read = (target: string, busted: boolean) => {
    const request = Effect.tryPromise({
      try: async (signal) => {
        const timeout = AbortSignal.timeout(tenant.requestTimeoutMs);
        const combined = AbortSignal.any([signal, timeout]);
        const response = await fetch(target, {
          signal: combined,
          redirect: "manual",
          headers: {
            "User-Agent":
              tenant.userAgent === "firefox"
                ? "Mozilla/5.0 (X11; Linux x86_64; rv:157.0) Gecko/20100101 Firefox/157.0"
                : "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            Referer: tenant.origin + "/",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Accept-Language": "en-US,en;q=0.9",
            ...(tenant.cookie ? { Cookie: tenant.cookie } : {}),
          },
        });
        return { response, signal: combined };
      },
      catch: (cause) => urgiisError("request/body " + url, cause),
    }).pipe(
      Effect.flatMap(({ response, signal }) =>
        Effect.gen(function* () {
          const invalid =
            response.status !== 200 ||
            response.redirected ||
            (response.url && response.url !== target) ||
            response.headers.has("content-range") ||
            response.headers
              .get("content-type")
              ?.split(";")[0]
              ?.trim()
              .toLowerCase() !== "text/html";
          if (invalid && (response.status === 403 || response.status === 429)) {
            const evidence = yield* Effect.promise(() =>
              blockedResponseEvidence(response),
            );
            const retryAfterMs = parseRetryAfterMs(
              response.headers.get("Retry-After"),
              Date.now(),
            );
            const error: UrgiisError = {
              tag: "UrgiisError",
              kind: "blocked",
              operation: "request/body " + url,
              status: response.status,
              retryAfterMs,
              message: `URG IIS ${tenant.code} returned HTTP${response.status} at ${url}; stopping this tenant without further requests. Retry-After: ${response.headers.get("Retry-After") ?? "not provided"}. Response: ${evidence}. A supplied Retry-After pauses this frontier; without one only this tenant stops. Prior inventory is preserved.`,
            };
            return yield* Effect.fail(error);
          }
          if (invalid) {
            yield* Effect.tryPromise({
              try: async () => {
                await response.body?.cancel();
              },
              catch: (cause) => urgiisError("cancel response " + url, cause),
            });
            return yield* Effect.fail(
              urgiisError(
                "request/body " + url,
                `Expected complete HTTP200 text/html; received HTTP${response.status}`,
              ),
            );
          }
          const copy = cloudflareCopy(response);
          if (busted && copy !== null) {
            yield* Effect.promise(() =>
              (response.body?.cancel() ?? Promise.resolve()).catch(
                () => undefined,
              ),
            );
            return yield* Effect.fail(
              urgiisError(
                "cache-busted reread " + target,
                `Cloudflare served the page truncated from its cache, and the reread with a unique cache-busting query string was served from its cache too (cf-cache-status ${copy}), so the complete page could not be read. Re-verify that a query string with the urg_hv cookie still misses the tenant's cache rule`,
              ),
            );
          }
          const text = yield* Effect.tryPromise({
            try: (bodySignal) =>
              readIPullUPullResponseText(
                response,
                "URG IIS " + url,
                AbortSignal.any([signal, bodySignal]),
                URGIIS_MAX_BODY_BYTES,
              ),
            catch: (cause) => urgiisError("request/body " + url, cause),
          });
          return { text, copy };
        }),
      ),
    );
    // Each attempt takes its own shared host turn, so client pacing and retry
    // backoff run after the lease is released. A deferred turn sent no request:
    // it is neither a provider failure nor retried.
    return serial.withPermits(1)(
      request.pipe(
        sharedProviderHostRequest(url),
        Effect.mapError((cause) =>
          cause instanceof ProviderTurnDeferred
            ? cause
            : cause instanceof Error
              ? urgiisError("shared host " + url, cause)
              : cause,
        ),
        Effect.ensuring(Effect.sleep(tenant.pacingMs)),
      ),
    );
  };
  // A truncated page from Cloudflare's cache is reread once past it. Only
  // tenants with the verification cookie can miss the cache rule; without it
  // a query string gets the cookie interstitial. The parser still rejects a
  // reread the origin truncated too.
  const attempt = Effect.suspend(() =>
    read(requestUrl, false).pipe(
      Effect.flatMap(({ text, copy }) =>
        copy !== null && tenant.cookie !== null && !iisDocumentComplete(text)
          ? read(cacheBustUrl(requestUrl), true).pipe(
              Effect.map((reread) => reread.text),
            )
          : Effect.succeed(text),
      ),
    ),
  );
  // A retry that cannot get its turn in this chunk ends the read with the
  // failure it is retrying, marked with that deferral, so the connector can
  // still apply its failed-model handling instead of deferring onto the same
  // failing page every chunk.
  return Effect.suspend(() => {
    let failure: UrgiisError | null = null;
    return attempt.pipe(
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (!(error instanceof ProviderTurnDeferred)) failure = error;
        }),
      ),
      Effect.retry({
        schedule: Schedule.exponential("4 seconds").pipe(
          Schedule.intersect(Schedule.recurs(2)),
        ),
        while: (error) =>
          !(error instanceof ProviderTurnDeferred) && error.kind !== "blocked",
      }),
      Effect.catchAll((error) =>
        Effect.fail(
          error instanceof ProviderTurnDeferred && failure !== null
            ? { ...failure, retryDeferred: error }
            : error,
        ),
      ),
    );
  });
}
