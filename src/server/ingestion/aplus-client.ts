import { sharedProviderHostSlot } from "./shared-provider-host";
import { Data, Duration, Effect, Schedule } from "effect";
import type { ProviderRequestGate } from "./provider-http-client";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import {
  APLUS_CONTACT,
  APLUS_MAKES,
  APLUS_ROOT,
  aplusBrowsePath,
} from "./aplus-yard-metadata";

export class AplusProviderError extends Data.TaggedError("AplusProviderError")<{
  operation: string;
  cause: unknown;
}> {
  override get message() {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Aplus ${this.operation}: ${detail}. No advanced checkpoint was accepted; prior inventory is preserved. Inspect the native source and resume only from the last validated checkpoint.`;
  }
}

/** Model pages are generated per request on the shared URG backend. Live
 * measurements on 2026-11-19 saw 2 to 7 seconds before headers, growing with
 * the card count, and production runs failed on 20 second deadlines. Match the
 * standard URG tenant deadline instead of aborting healthy slow pages. */
const APLUS_REQUEST_TIMEOUT_MS = 40_000;
/** Two more attempts, 4 then 8 seconds apart. Every attempt acquires its own
 * shared host slot, so the worst case for one page stays below three minutes. */
export const APLUS_REQUEST_ATTEMPTS = 3;
const retrySchedule = Schedule.exponential("4 seconds").pipe(
  Schedule.intersect(Schedule.recurs(APLUS_REQUEST_ATTEMPTS - 1)),
);

class AplusDeadlineError extends Data.TaggedError("AplusDeadlineError") {
  override get message() {
    return `Combined request/body deadline exceeded ${APLUS_REQUEST_TIMEOUT_MS / 1000} seconds`;
  }
}

/** Retry only a page that missed its deadline. Every HTTP status other than
 * a complete 200, redirects, partial content, wrong media types and parser
 * failures stop immediately, as do caller interruptions. */
function isAplusDeadline(cause: unknown): boolean {
  return (
    cause instanceof AplusDeadlineError ||
    (cause instanceof DOMException && cause.name === "TimeoutError")
  );
}

async function readAplusDocument(
  url: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
    },
  });
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
  ) {
    const failure = new Error(
      "Expected complete unredirected Aplus HTTP200 text/html, received " +
        response.status,
    );
    try {
      await response.body?.cancel();
    } catch (cleanupFailure) {
      throw new AggregateError(
        [failure, cleanupFailure],
        failure.message + "; unread response body cancellation also failed",
        { cause: failure },
      );
    }
    throw failure;
  }
  return readIPullUPullResponseText(
    response,
    "Aplus " + url,
    signal,
    2 * 1024 * 1024,
  );
}

export function fetchAplusPage(url: string, gate: ProviderRequestGate) {
  return gate(
    Effect.suspend(() => {
      if (
        ![APLUS_ROOT, APLUS_CONTACT, APLUS_MAKES].includes(url) &&
        !aplusBrowsePath(url, 1) &&
        !aplusBrowsePath(url, 2)
      )
        return Effect.fail(
          new Error("Destination is outside the finite Aplus browse graph"),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(APLUS_REQUEST_TIMEOUT_MS);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interruption) => {
          pending = readAplusDocument(
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
            // The request effect owns its failure. Await resource release on
            // interruption without replacing that original failure.
            if (pending)
              await pending.then(
                () => undefined,
                () => undefined,
              );
          }),
        ),
        Effect.timeoutFail({
          duration: Duration.millis(APLUS_REQUEST_TIMEOUT_MS),
          onTimeout: () => new AplusDeadlineError(),
        }),
      );
    }),
  ).pipe(
    sharedProviderHostSlot(url),
    Effect.retry({ schedule: retrySchedule, while: isAplusDeadline }),
    Effect.mapError(
      (cause) => new AplusProviderError({ operation: url, cause }),
    ),
  );
}
