import { sharedProviderHostSlot } from "./shared-provider-host";
import { Effect, Either } from "effect";
import { readIPullUPullResponseText } from "./ipullupull-response-text";
import type { ProviderRequestGate } from "./provider-http-client";
import {
  PRATT_ARRIVALS,
  PRATT_MAKES,
  PRATT_ORIGIN,
  prattBrowsePath,
} from "./pratt-html";
import { PrattResult, type PrattError } from "./pratt-result";
import {
  ProviderChunkClock,
  type ProviderTurnDeferred,
} from "./provider-chunk-clock";

export const PRATT_REQUEST_TIMEOUT_MS = 20_000;
export const PRATT_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The shared Pratt and Lambert server intermittently answers HTTP 5xx, drops
 * connections or stalls, and one such answer in a roughly 520-request run used
 * to fail the whole run. Two more attempts follow 5 then 10 seconds apart, so
 * one page takes at most about 80 seconds, inside the 110-second URG turn. */
export const PRATT_REQUEST_ATTEMPTS = 3;
/** Chunk work one attempt may take: its deadline, the 1.6-second client gap,
 * the 3.5-second URG gap its turn holds after the page and checkpoint
 * validation. A failed attempt that leaves no room for the next one's backoff
 * and work defers at once, so the turn holds that gap only once. */
const PRATT_ATTEMPT_WORK_MS = PRATT_REQUEST_TIMEOUT_MS + 10_000;
const serial = Effect.runSync(Effect.makeSemaphore(1));
/** Hold the permit through body completion and padding, including failures.
 * Module scope preserves the gap across consecutive connector chunks. */
export const prattRequestGate: ProviderRequestGate = (request) =>
  serial.withPermits(1)(
    request.pipe(Effect.ensuring(Effect.sleep("1600 millis"))),
  );

/** An attempt that failed without saying anything about the page: HTTP 5xx,
 * a failed connection or the request deadline. Only these are retried. */
interface PrattTransientFailure {
  tag: "PrattTransientFailure";
  error: PrattError;
}
const transient = (error: PrattError): PrattTransientFailure => ({
  tag: "PrattTransientFailure",
  error,
});

class PrattStatusRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** HTTP 5xx, undici's network failure or mid-body connection reset
 * (`terminated`) and the request signal's deadline. Redirects, 4xx, partial
 * content, wrong MIME and other body or parse failures say something about
 * the page and stay fatal. */
function isTransientCause(cause: unknown): boolean {
  return (
    (cause instanceof PrattStatusRefusal && cause.status >= 500) ||
    (cause instanceof TypeError &&
      (cause.message === "fetch failed" || cause.message === "terminated")) ||
    (cause instanceof DOMException && cause.name === "TimeoutError")
  );
}

async function document(url: string, signal: AbortSignal): Promise<string> {
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
    const failure = new PrattStatusRefusal(
      response.status,
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
    "Pratt " + url,
    signal,
    PRATT_MAX_BODY_BYTES,
  );
}

/** Direct fetch is intentional: the shared response helper does not propagate
 * Effect interruption into its fetch signal. The shared bounded body reader is
 * reused while this adapter owns each attempt's request/body lifetime. Every
 * attempt takes the request gate and its own host slot, and starts only if it
 * can end within the chunk's work allowance. Otherwise the read is deferred
 * (`ProviderChunkClock.unlessDeferred`), so an advanced chunk returns its last
 * validated checkpoint instead of running past its deadline. */
export function readPrattPage(
  url: string,
  gate: ProviderRequestGate = prattRequestGate,
): Effect.Effect<string, PrattError | ProviderTurnDeferred> {
  const request = gate(
    Effect.suspend(() => {
      if (
        URL.parse(url)?.href !== url ||
        (![PRATT_ORIGIN + "/", PRATT_ARRIVALS, PRATT_MAKES].includes(url) &&
          !prattBrowsePath(url, 1) &&
          !prattBrowsePath(url, 2))
      )
        return Effect.fail(
          PrattResult.error(
            "request destination",
            "URL is outside the literal owned native root/make/model graph: " +
              url,
          ),
        );
      const lifetime = new AbortController();
      const deadline = AbortSignal.timeout(PRATT_REQUEST_TIMEOUT_MS);
      let pending: Promise<string> | null = null;
      return Effect.tryPromise({
        try: (interrupted) => {
          pending = document(
            url,
            AbortSignal.any([lifetime.signal, interrupted, deadline]),
          );
          return pending;
        },
        catch: (cause) => {
          const error = PrattResult.error(
            "request/body " + url,
            cause instanceof Error ? cause.message : String(cause),
          );
          return isTransientCause(cause) ? transient(error) : error;
        },
      }).pipe(
        Effect.ensuring(
          Effect.promise(async () => {
            lifetime.abort();
            // Await release after interruption; preserve the request's original error.
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
            transient(
              PrattResult.error(
                "request/body " + url,
                "Combined request and body deadline exceeded 20 seconds",
              ),
            ),
        }),
      );
    }),
  ).pipe(
    sharedProviderHostSlot(url),
    Effect.mapError((cause) =>
      cause instanceof Error
        ? PrattResult.error("shared host " + url, cause.message)
        : cause,
    ),
  );
  return Effect.gen(function* () {
    for (let attempt = 1; ; attempt++) {
      // The fit covers the backoff too: checked after it, a late failure
      // could sleep past the work deadline before deferring.
      const backoffMs = attempt === 1 ? 0 : 5_000 * 2 ** (attempt - 2);
      if (
        !(yield* ProviderChunkClock.workFits(backoffMs + PRATT_ATTEMPT_WORK_MS))
      )
        return yield* Effect.flip(
          ProviderChunkClock.deferred("Pratt", "allowance"),
        );
      yield* Effect.sleep(backoffMs);
      const outcome = yield* Effect.either(request);
      if (Either.isRight(outcome)) return outcome.right;
      const failure = outcome.left;
      if (failure.tag === "PrattError") return yield* Effect.fail(failure);
      if (attempt === PRATT_REQUEST_ATTEMPTS)
        return yield* Effect.fail(failure.error);
    }
  });
}
