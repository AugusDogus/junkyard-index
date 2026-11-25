import { Effect, Either, Fiber, TestClock, TestContext } from "effect";
import {
  HostReservation,
  ProviderHostStores,
  type ProviderHostStore,
} from "./provider-host-slot";

export interface QueuedHostRun<A, E> {
  result: Either.Either<A, E>;
  /** Test clock time at which the effect finished. */
  elapsedMs: number;
  /** Leases granted, with the test clock time of acquisition and release. */
  turns: { acquiredAt: number; releasedAt: number | null; leaseMs: number }[];
  /** Waiters that gave up their place without a turn. */
  cancelled: number;
  /** Provider requests, with the test clock time they started and ended. */
  requests: { url: string; startedAt: number; endedAt: number }[];
}

/**
 * The longest lease and the shortest gap between one request's end and the
 * next one's start. A client's own gate belongs after its lease, so the lease
 * covers only the request and the host gap while the source still waits its
 * gate before its next request. The test clock moves in whole seconds.
 */
export function queuedHostPacing<A, E>(run: QueuedHostRun<A, E>) {
  const leases = run.turns.flatMap((turn) =>
    turn.releasedAt === null ? [] : [turn.releasedAt - turn.acquiredAt],
  );
  const gaps = run.requests.slice(1).flatMap((request, index) => {
    const previous = run.requests[index];
    return previous ? [request.startedAt - previous.endedAt] : [];
  });
  return {
    longestLeaseMs: Math.max(...leases),
    shortestGapMs: Math.min(...gaps),
  };
}

/**
 * Runs `effect` on the test clock as production does on Vercel, with every
 * shared host lease kept in one simulated host queue: each waiter gets the
 * lease `turnWaitMs` after it first asks (as if requests from other sources
 * were ahead of it), and only once the lease is free. `turnWaitMs` may depend
 * on the turn number. Fetches pass through to whatever `fetch` the test
 * installed, and answer `requestMs(url)` of test clock time later (at once by
 * default).
 */
export async function runWithQueuedHost<A, E>(
  effect: Effect.Effect<A, E>,
  options: {
    turnWaitMs: number | ((turn: number) => number);
    requestMs?: (url: string) => number;
  },
): Promise<QueuedHostRun<A, E>> {
  let now = 0;
  const requests: QueuedHostRun<A, E>["requests"] = [];
  const answering: { at: number; answer: () => void }[] = [];
  let holder: string | null = null;
  let cancelled = 0;
  const firstAsked = new Map<string, number>();
  const turns: QueuedHostRun<A, E>["turns"] = [];
  const turnWait = (turn: number) =>
    typeof options.turnWaitMs === "number"
      ? options.turnWaitMs
      : options.turnWaitMs(turn);
  const store: ProviderHostStore = {
    reserve: async (token, leaseMs) => {
      const asked = firstAsked.get(token) ?? now;
      firstAsked.set(token, asked);
      // The simulated waiter is always at the front of its lane.
      if (holder !== null || now - asked < turnWait(turns.length))
        return HostReservation.queued(0, 0);
      holder = token;
      firstAsked.delete(token);
      turns.push({ acquiredAt: now, releasedAt: null, leaseMs });
      return HostReservation.granted;
    },
    release: async (token) => {
      if (holder !== token) return false;
      holder = null;
      const turn = turns.at(-1);
      if (turn) turn.releasedAt = now;
      return true;
    },
    cancel: async (token) => {
      if (firstAsked.delete(token)) cancelled++;
      return true;
    },
  };
  const passthrough = globalThis.fetch;
  const vercel = process.env.VERCEL;
  const queued = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    const startedAt = now;
    const response = await passthrough(input, init);
    const at = startedAt + (options.requestMs?.(url) ?? 0);
    if (at > now)
      await new Promise<void>((answer) => answering.push({ at, answer }));
    requests.push({ url, startedAt, endedAt: now });
    return response;
  };
  process.env.VERCEL = "1";
  globalThis.fetch = Object.assign(queued, {
    preconnect: passthrough.preconnect,
  });
  try {
    return await ProviderHostStores.using(
      () => store,
      () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const fiber = yield* Effect.fork(Effect.either(effect));
            while (fiber.unsafePoll() === null) {
              // Answer requests that are due before time moves on.
              for (const request of answering.filter(({ at }) => at <= now)) {
                answering.splice(answering.indexOf(request), 1);
                request.answer();
              }
              // Let resolved promises (fixture responses, lease calls) settle
              // before simulated time moves on.
              yield* Effect.promise(
                () => new Promise<void>((resolve) => setImmediate(resolve)),
              );
              // The store sees the time the woken fibers see.
              now += 1000;
              yield* TestClock.adjust("1 second");
            }
            return {
              result: yield* Fiber.join(fiber),
              elapsedMs: now,
              turns,
              cancelled,
              requests,
            };
          }).pipe(Effect.provide(TestContext.TestContext)),
        ),
    );
  } finally {
    globalThis.fetch = passthrough;
    if (vercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = vercel;
  }
}
