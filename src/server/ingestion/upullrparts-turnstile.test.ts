import { describe, expect, test } from "bun:test";
import { Effect, Either, TestClock, TestContext } from "effect";
import type { BrowserSessions } from "./document-transport";
import { BrowserSessionError } from "./errors";
import { KernelApiError } from "./kernel-sessions";
import {
  ProviderCapacityDeferred,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import {
  UPULLRPARTS_TOKEN_MAX_AGE_MS,
  UpullRPartsTokens,
  UpullRPartsTurnstile,
  type UpullRPartsTurnstileOpen,
} from "./upullrparts-turnstile";

/** A token browser whose tabs mint numbered tokens. */
function fakeBrowser(options: { tabs?: number; failAfter?: number } = {}) {
  const events: string[] = [];
  let minted = 0;
  const open: UpullRPartsTurnstileOpen = Effect.acquireRelease(
    Effect.sync(() => {
      events.push("open");
      return {
        tabs: Array.from({ length: options.tabs ?? 2 }, () => async () => {
          if (options.failAfter !== undefined && minted >= options.failAfter)
            throw new Error("widget never issued a token");
          minted += 1;
          return `token-${minted}`;
        }),
      };
    }),
    () => Effect.sync(() => events.push("close")),
  );
  return { open, events, minted: () => minted };
}

const run = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.either(effect));

describe("UpullRPartsTokens", () => {
  test("opens the browser on first take, mints at most the count and closes it", async () => {
    const browser = fakeBrowser();
    const result = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const tokens = yield* UpullRPartsTokens.make(browser.open, 3);
          expect(browser.events).toEqual([]);
          const taken = [
            yield* tokens.take,
            yield* tokens.take,
            yield* tokens.take,
          ];
          const extra = yield* Effect.either(tokens.take);
          return { taken, extra };
        }),
      ),
    );
    if (Either.isLeft(result)) throw new Error("pool failed");
    expect(new Set(result.right.taken).size).toBe(3);
    expect(browser.minted()).toBe(3);
    expect(Either.isLeft(result.right.extra)).toBe(true);
    if (Either.isLeft(result.right.extra))
      expect(result.right.extra.left.message).toContain("all 3 tokens");
    expect(browser.events).toEqual(["open", "close"]);
  });

  test("never opens a browser when no token is taken", async () => {
    const browser = fakeBrowser();
    await run(Effect.scoped(UpullRPartsTokens.make(browser.open, 5)));
    expect(browser.events).toEqual([]);
  });

  test("hands out tokens minted before a tab failed, then the failure", async () => {
    const browser = fakeBrowser({ tabs: 1, failAfter: 2 });
    const result = await run(
      Effect.scoped(
        Effect.gen(function* () {
          const tokens = yield* UpullRPartsTokens.make(browser.open, 10);
          const first = yield* tokens.take;
          const second = yield* tokens.take;
          const third = yield* Effect.either(tokens.take);
          return { first, second, third };
        }),
      ),
    );
    if (Either.isLeft(result)) throw new Error("pool failed");
    expect([result.right.first, result.right.second]).toEqual([
      "token-1",
      "token-2",
    ]);
    expect(result.right.third).toMatchObject({
      _tag: "Left",
      left: { _tag: "BrowserSessionError", phase: "fetch" },
    });
  });

  test("passes a session lease deferral through unchanged", async () => {
    const deferral = new ProviderTurnDeferred({
      host: "Kernel browser for upullrparts",
      stage: "wait",
      elapsedMs: 0,
      queuedMs: 0,
    });
    const result = await run(
      Effect.scoped(
        Effect.flatMap(
          UpullRPartsTokens.make(Effect.fail(deferral), 3),
          (tokens) => tokens.take,
        ),
      ),
    );
    expect(result).toMatchObject({ _tag: "Left", left: deferral });
  });

  test("drops tokens too old to verify", async () => {
    let minted = 0;
    const open: UpullRPartsTurnstileOpen = Effect.succeed({
      tabs: [async () => `token-${++minted}`],
    });
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tokens = yield* UpullRPartsTokens.make(open, 3);
          const first = yield* tokens.take;
          // Let the minter queue the other two, then age them out.
          yield* Effect.promise(() => new Promise((r) => setTimeout(r, 20)));
          yield* TestClock.adjust(UPULLRPARTS_TOKEN_MAX_AGE_MS + 1);
          const stale = yield* Effect.either(tokens.take);
          return { first, stale };
        }),
      ).pipe(Effect.provide(TestContext.TestContext)),
    );
    expect(result.first).toBe("token-1");
    expect(minted).toBe(3);
    expect(result.stale).toMatchObject({ _tag: "Left" });
    if (Either.isLeft(result.stale)) {
      expect(result.stale.left).not.toBeInstanceOf(BrowserSessionError);
      expect(result.stale.left.message).toContain("2 expired");
    }
  });
});

describe("UpullRPartsTurnstile.open", () => {
  test("a Kernel create refused at the plan's browser limit defers the chunk, holding the lease only while it tries", async () => {
    const events: string[] = [];
    const sessions: BrowserSessions = {
      provider: "kernel",
      lease: Effect.acquireRelease(
        Effect.sync(() => events.push("lease")),
        () => Effect.sync(() => events.push("release")),
      ).pipe(Effect.asVoid),
      create: async () => {
        throw new KernelApiError({
          operation: "create",
          status: 429,
          code: "org_limit_exceeded",
          detail: "limit=5, utilization=5, requested=1",
        });
      },
      stop: async () => events.push("stop"),
      connect: async () => {
        throw new Error("never connects");
      },
    };

    const result = await Effect.runPromise(
      Effect.either(Effect.scoped(UpullRPartsTurnstile.open(sessions, 2))),
    );

    expect(Either.isLeft(result) && result.left).toBeInstanceOf(
      ProviderCapacityDeferred,
    );
    expect(events).toEqual(["lease", "release"]);
  });
});
