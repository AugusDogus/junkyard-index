import { sharedProviderHostSlot } from "./shared-provider-host";
import { Effect, Schedule } from "effect";
import { parseRetryAfterMs } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { iisOwnedUrl, iisBrowsePath } from "./urgiis-catalog";
import type { UrgiisTenant } from "./urgiis-tenant";

export type UrgiisError = {
  tag: "UrgiisError";
  operation: string;
  message: string;
} & (
  | { kind: "failure" }
  | { kind: "blocked"; status: 403 | 429; retryAfterMs: number }
);
export const urgiisError = (
  operation: string,
  cause: unknown,
): UrgiisError => ({
  tag: "UrgiisError",
  kind: "failure",
  operation,
  message: `URG IIS ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the saved response or resume the last validated checkpoint.`,
});
const serial = Effect.runSync(Effect.makeSemaphore(1));
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
  const requestUrl = url.replaceAll("(", "%28").replaceAll(")", "%29");
  return Effect.suspend(() => {
    const request = Effect.tryPromise({
      try: async (signal) => {
        const timeout = AbortSignal.timeout(tenant.requestTimeoutMs);
        const combined = AbortSignal.any([signal, timeout]);
        const response = await fetch(requestUrl, {
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
            (response.url && response.url !== requestUrl) ||
            response.headers.has("content-range") ||
            response.headers
              .get("content-type")
              ?.split(";")[0]
              ?.trim()
              .toLowerCase() !== "text/html";
          if (invalid) {
            yield* Effect.tryPromise({
              try: async () => {
                await response.body?.cancel();
              },
              catch: (cause) => urgiisError("cancel response " + url, cause),
            });
            if (response.status === 403 || response.status === 429) {
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
                message: `URG IIS ${tenant.code} returned HTTP${response.status} at ${url}; stopping this tenant without further requests. Retry-After: ${response.headers.get("Retry-After") ?? "not provided"}. A supplied Retry-After pauses this frontier; without one the source stops. Prior inventory is preserved.`,
              };
              return yield* Effect.fail(error);
            }
            return yield* Effect.fail(
              urgiisError(
                "request/body " + url,
                `Expected complete HTTP200 text/html; received HTTP${response.status}`,
              ),
            );
          }
          return yield* Effect.tryPromise({
            try: (bodySignal) =>
              readIPullUPullResponseText(
                response,
                "URG IIS " + url,
                AbortSignal.any([signal, bodySignal]),
                URGIIS_MAX_BODY_BYTES,
              ),
            catch: (cause) => urgiisError("request/body " + url, cause),
          });
        }),
      ),
    );
    return serial.withPermits(1)(
      request.pipe(
        sharedProviderHostSlot(url),
        Effect.mapError((cause) =>
          cause instanceof Error
            ? urgiisError("shared host " + url, cause)
            : cause,
        ),
        Effect.ensuring(Effect.sleep(tenant.pacingMs)),
      ),
    );
  }).pipe(
    Effect.retry({
      schedule: Schedule.exponential("4 seconds").pipe(
        Schedule.intersect(Schedule.recurs(2)),
      ),
      while: (error) => error.kind !== "blocked",
    }),
  );
}
