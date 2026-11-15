import { Data, Effect } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  BEAVERS_ORIGIN,
  beaversDetailUrl,
  beaversDonorId,
  beaversPage,
} from "./beavers-yard-metadata";

export class BeaversProviderError extends Data.TaggedError(
  "BeaversProviderError",
)<{ operation: string; cause: unknown }> {
  override get message() {
    return `Beaver's ${this.operation}: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}. Previous inventory and the last validated checkpoint are preserved. Inspect the native response before resuming.`;
  }
}
export type BeaversResponse =
  | { kind: "redirect"; url: string }
  | { kind: "html"; body: string };
export const BEAVERS_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const serial = Effect.runSync(Effect.makeSemaphore(1));
export const beaversRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );

async function document(
  url: string,
  route: string | null,
  signal: AbortSignal,
): Promise<BeaversResponse> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "JunkyardIndex/1.0", Accept: "text/html" },
  });
  if (
    response.status !== (route ? 302 : 200) ||
    response.redirected ||
    response.headers.has("content-range") ||
    (response.url && response.url !== url) ||
    response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase() !== "text/html"
  ) {
    const failure = new Error(
      `Expected complete native HTTP ${route ? 302 : 200} HTML, received ${response.status}`,
    );
    try {
      await response.body?.cancel();
    } catch (cleanup) {
      throw new AggregateError(
        [failure, cleanup],
        failure.message + "; response cancellation failed",
      );
    }
    throw failure;
  }
  if (route) {
    const location = response.headers.get("location");
    const expected = beaversDetailUrl(url);
    await response.body?.cancel();
    if (
      location === null ||
      URL.parse(location, BEAVERS_ORIGIN)?.href !== expected
    )
      throw new Error(
        "Published donor redirect left its tenant 503 identifier",
      );
    return { kind: "redirect", url: expected };
  }
  return {
    kind: "html",
    body: await readIPullUPullResponseText(
      response,
      "Beaver's " + url,
      signal,
      BEAVERS_MAX_RESPONSE_BYTES,
    ),
  };
}
export function fetchBeaversPage(url: string, gate: ProviderRequestGate) {
  const route = beaversDonorId(url, "route");
  if (beaversPage(url) === null && !route && !beaversDonorId(url, "detail"))
    return Effect.fail(
      new BeaversProviderError({
        operation: "destination",
        cause: "Request is outside the published tenant 503 inventory",
      }),
    );
  return gate(
    Effect.suspend(() => {
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(25_000);
      let pending: Promise<BeaversResponse> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          pending = document(
            url,
            route,
            AbortSignal.any([lifetime.signal, interrupted, deadline]),
          );
          return pending;
        },
        catch: (cause) => cause,
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
          duration: "25 seconds",
          onTimeout: () =>
            new Error(
              "Beaver's combined request/body deadline exceeded 25 seconds",
            ),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new BeaversProviderError({ operation: url, cause }),
    ),
  );
}
