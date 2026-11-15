import { Effect, Schedule } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { iisOwnedUrl, iisBrowsePath } from "./urgiis-catalog";
import type { UrgiisTenant } from "./urgiis-snapshot";

export interface UrgiisError {
  tag: "UrgiisError";
  operation: string;
  message: string;
}
export const urgiisError = (
  operation: string,
  cause: unknown,
): UrgiisError => ({
  tag: "UrgiisError",
  operation,
  message: `URG IIS ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the saved response or resume the last validated checkpoint.`,
});
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const URGIIS_MAX_BODY_BYTES = 4 * 1024 * 1024;
export function readUrgiisPage(url: string, tenant: UrgiisTenant) {
  const owned = iisOwnedUrl(url, tenant);
  if (
    !owned ||
    (![tenant.ownerPath, tenant.makesPath].includes(owned.pathname) &&
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
  return Effect.suspend(() => {
    const request = Effect.tryPromise({
      try: async (signal) => {
        const timeout = AbortSignal.timeout(40_000);
        const combined = AbortSignal.any([signal, timeout]);
        const response = await fetch(url, {
          signal: combined,
          redirect: "manual",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
            Accept: "text/html",
            "Accept-Language": "en-US,en;q=0.9",
            ...(tenant.cookie ? { Cookie: tenant.cookie } : {}),
          },
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
          await response.body?.cancel();
          throw new Error(
            `Expected complete HTTP200 text/html at ${url}; received HTTP${response.status}`,
          );
        }
        return readIPullUPullResponseText(
          response,
          "URG IIS " + url,
          combined,
          URGIIS_MAX_BODY_BYTES,
        );
      },
      catch: (cause) => urgiisError("request/body " + url, cause),
    });
    return serial.withPermits(1)(
      request.pipe(Effect.ensuring(Effect.sleep(tenant.pacingMs))),
    );
  }).pipe(
    Effect.retry(
      Schedule.exponential("4 seconds").pipe(
        Schedule.intersect(Schedule.recurs(2)),
      ),
    ),
  );
}
