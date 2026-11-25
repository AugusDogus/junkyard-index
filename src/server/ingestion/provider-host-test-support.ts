import { Effect, Either, Fiber, TestClock, TestContext } from "effect";

const FAKE_UPSTASH = "https://queued-host.upstash.test";

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
 * Runs `effect` on the test clock as production does on Vercel, with the
 * Upstash REST endpoint replaced by one simulated shared host queue: each
 * waiter gets the lease `turnWaitMs` after it first asks (as if requests from
 * other sources were ahead of it), and only once the lease is free.
 * `turnWaitMs` may depend on the turn number. Other fetches pass through to
 * whatever `fetch` the test installed, and answer `requestMs(url)` of test
 * clock time later (at once by default).
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
  const command = (script: string, token: string, leaseMs: number) => {
    if (script.includes("ZRANGEBYSCORE")) {
      const asked = firstAsked.get(token) ?? now;
      firstAsked.set(token, asked);
      // RESERVE_HOST_SLOT replies [granted, laneAhead, readyAhead]; the
      // simulated waiter is always at the front of its lane.
      if (holder !== null || now - asked < turnWait(turns.length))
        return [0, 0, 0];
      holder = token;
      firstAsked.delete(token);
      turns.push({ acquiredAt: now, releasedAt: null, leaseMs });
      return [1, 0, 0];
    }
    if (script.includes("'DEL'")) {
      if (holder !== token) return 0;
      holder = null;
      const turn = turns.at(-1);
      if (turn) turn.releasedAt = now;
      return 1;
    }
    if (firstAsked.delete(token)) cancelled++;
    return 1;
  };
  const passthrough = globalThis.fetch;
  const environment = {
    VERCEL: process.env.VERCEL,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  const queued = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.startsWith(FAKE_UPSTASH)) {
      const startedAt = now;
      const response = await passthrough(input, init);
      const at = startedAt + (options.requestMs?.(url) ?? 0);
      if (at > now)
        await new Promise<void>((answer) => answering.push({ at, answer }));
      requests.push({ url, startedAt, endedAt: now });
      return response;
    }
    const evaluate = (eval_: unknown) => {
      if (!Array.isArray(eval_) || String(eval_[0]).toLowerCase() !== "eval")
        throw new Error(`Unexpected Upstash command ${String(init?.body)}`);
      const keys = Number(eval_[2]);
      return {
        result: command(
          String(eval_[1]),
          String(eval_[3 + keys]),
          Number(eval_[4 + keys]),
        ),
      };
    };
    const body: unknown = JSON.parse(String(init?.body));
    // The client may pipeline concurrent commands into one request.
    return Response.json(
      Array.isArray(body) && Array.isArray(body[0])
        ? body.map(evaluate)
        : evaluate(body),
    );
  };
  process.env.VERCEL = "1";
  process.env.UPSTASH_REDIS_REST_URL = FAKE_UPSTASH;
  process.env.UPSTASH_REDIS_REST_TOKEN = "queued-host-test";
  globalThis.fetch = Object.assign(queued, {
    preconnect: passthrough.preconnect,
  });
  try {
    return await Effect.runPromise(
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
    );
  } finally {
    globalThis.fetch = passthrough;
    for (const [key, value] of Object.entries(environment))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
