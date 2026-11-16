import { Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { hasHttpPaginationLink } from "./provider-http-pagination";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { harrysChallengeCookie } from "./harrys-challenge";
import {
  HARRYS_OWNER,
  HARRYS_MAX_PAGES,
  harrysPageUrl,
} from "./harrys-yard-metadata";
export class HarrysProviderError extends Error {
  readonly tag = "HarrysProviderError";
  constructor(
    readonly operation: string,
    cause: unknown,
  ) {
    super(
      `Harry's ${operation}: ${cause instanceof Error ? cause.message : String(cause)}. Prior inventory is preserved; inspect the native response and resume the last validated checkpoint.`,
      { cause },
    );
  }
}
const semaphore = Effect.runSync(Effect.makeSemaphore(1));
export const harrysRequestGate: ProviderRequestGate = (request) =>
  semaphore.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("3500 millis"))),
  );
let session: { cookie: string; expires: number } | null = null;
function request(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.tryPromise({
      try: async (interruption) => {
        const signal = AbortSignal.any([
          interruption,
          AbortSignal.timeout(25_000),
        ]);
        const response = await fetch(url, {
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": "Mozilla/5.0",
            Accept: "text/html",
            "Cache-Control": "no-cache",
            ...(session && session.expires > Date.now()
              ? { Cookie: session.cookie }
              : {}),
          },
        });
        const valid =
          (response.status === 200 || response.status === 307) &&
          !response.redirected &&
          (!response.url || response.url === url) &&
          !response.headers.has("content-range") &&
          !hasHttpPaginationLink(response.headers) &&
          response.headers
            .get("content-type")
            ?.split(";")[0]
            ?.trim()
            .toLowerCase() === "text/html";
        if (!valid) {
          await response.body?.cancel();
          throw new Error(
            `Expected complete owned HTTP200 HTML or the known HTTP307 challenge at ${url}; received HTTP${response.status}`,
          );
        }
        const raw = await readIPullUPullResponseText(
          response,
          "Harry's " + url,
          signal,
          response.status === 307 ? 16_384 : 2 * 1024 * 1024,
        );
        return { status: response.status, raw };
      },
      catch: (cause) => new HarrysProviderError("request/body " + url, cause),
    }),
  );
}
/** At most one challenge and one retry per native GET. The public cookie is
 * process-local, never persisted in workflow checkpoints. */
export function readHarrysPage(
  url: string,
  gate: ProviderRequestGate = harrysRequestGate,
) {
  return Effect.gen(function* () {
    if (
      url !== HARRYS_OWNER &&
      !Array.from({ length: HARRYS_MAX_PAGES }, (_, i) =>
        harrysPageUrl(i),
      ).includes(url)
    )
      return yield* Effect.fail(
        new HarrysProviderError(
          "destination",
          "URL is outside the qualified native inventory",
        ),
      );
    let result = yield* request(url, gate);
    if (result.status === 307) {
      const cookie = yield* Effect.try({
        try: () => harrysChallengeCookie(result.raw),
        catch: (cause) => new HarrysProviderError("Sucuri challenge", cause),
      });
      session = { cookie, expires: Date.now() + 86_000_000 };
      result = yield* request(url, gate);
    }
    if (result.status !== 200)
      return yield* Effect.fail(
        new HarrysProviderError(
          "Sucuri challenge",
          "Cookie retry remained challenged; challenge or request identity changed",
        ),
      );
    return result.raw;
  });
}
