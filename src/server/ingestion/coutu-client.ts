import { Data, Effect } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import { COUTU_HOME, COUTU_ROOT, coutuBrowsePath } from "./coutu-protocol";

export class CoutuProviderError extends Data.TaggedError("CoutuProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Coutu ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

async function readCoutuDocument(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
  });
  let outcome:
    | { status: "success"; html: string }
    | { status: "failure"; cause: unknown };
  try {
    if (
      response.status !== 200 ||
      response.redirected ||
      response.headers.has("content-range") ||
      (response.url && response.url !== url) ||
      response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "text/html"
    )
      throw new Error(
        "Expected complete unredirected Coutu HTTP200 text/html, received " +
          response.status,
      );
    outcome = {
      status: "success",
      html: await readIPullUPullResponseText(
        response,
        "Coutu " + url,
        signal,
        2 * 1024 * 1024,
      ),
    };
  } catch (cause) {
    outcome = { status: "failure", cause };
  }
  try {
    if (response.body && !response.body.locked) await response.body.cancel();
  } catch (cleanup) {
    if (outcome.status === "failure") {
      const original =
        outcome.cause instanceof Error
          ? outcome.cause.message
          : String(outcome.cause);
      const cleanupMessage =
        cleanup instanceof Error ? cleanup.message : String(cleanup);
      throw new AggregateError(
        [outcome.cause, cleanup],
        original + "; response body cleanup also failed: " + cleanupMessage,
      );
    }
    throw cleanup;
  }
  if (outcome.status === "failure") throw outcome.cause;
  return outcome.html;
}

export function fetchCoutuPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      if (
        ![COUTU_HOME, COUTU_ROOT].includes(url) &&
        !coutuBrowsePath(url, 1) &&
        !coutuBrowsePath(url, 2)
      )
        return Effect.fail(
          new Error("Destination is outside the finite Coutu browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(20_000);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readCoutuDocument(
            url,
            AbortSignal.any([lifetime.signal, interruption, deadline]),
          );
          return pending;
        },
        catch: (cause) => cause,
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            // The request effect owns its failure. Cleanup awaits transport/body
            // release on interruption without replacing that original failure.
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
            new Error("Combined request/body deadline exceeded 20 seconds"),
        }),
      );
    }),
  ).pipe(
    Effect.mapError(
      (cause) => new CoutuProviderError({ operation: url, cause }),
    ),
  );
}
