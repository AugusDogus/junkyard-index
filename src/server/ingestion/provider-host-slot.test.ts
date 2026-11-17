import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  RESERVE_HOST_SLOT,
  withProviderHostSlot,
  type ProviderHostPolicy,
} from "./provider-host-slot";

const policy: ProviderHostPolicy = {
  key: "offline",
  label: "offline",
  leaseMs: 90_000,
  requestMs: 65_000,
  waitMs: 10_000,
  pollMs: 1000,
  gapMs: 3500,
};

test("an interrupted waiter cancels its queue entry without releasing an uncertain lease", async () => {
  const cancelled: string[] = [];
  let releases = 0,
    requests = 0;
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withProviderHostSlot(
          policy,
          {
            reserve: async () => false,
            release: async () => {
              releases++;
              return true;
            },
            cancel: async (token) => {
              cancelled.push(token);
              return true;
            },
          },
          Effect.sync(() => {
            requests++;
          }),
        ),
      );
      yield* TestClock.adjust("1 second");
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  expect(cancelled).toHaveLength(1);
  expect(releases).toBe(0);
  expect(requests).toBe(0);
});

test("shared backend retains its lease through response completion and the failure gap", async () => {
  let release = false;
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          withProviderHostSlot(
            policy,
            {
              reserve: async () => true,
              release: async () => {
                release = true;
                return true;
              },
              cancel: async () => true,
            },
            Effect.sleep("2 seconds").pipe(
              Effect.andThen(Effect.fail(new Error("HTTP 500"))),
            ),
          ),
        ),
      );
      yield* TestClock.adjust("5499 millis");
      expect(release).toBe(false);
      yield* TestClock.adjust("1 millis");
      expect((yield* Fiber.join(fiber))._tag).toBe("Left");
      expect(release).toBe(true);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
});

// Runs the production Lua, not an in-memory imitation. Redis is optional for
// the normal unit suite; the launch runbook records the explicit local command.
test.skipIf(!Bun.which("redis-server") || !Bun.which("redis-cli"))(
  "Redis FIFO prevents a busy source overtaking either queued source and expires dead waiters",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "provider-host-"));
    const socket = join(directory, "redis.sock");
    const server = Bun.spawn(
      [
        "redis-server",
        "--port",
        "0",
        "--unixsocket",
        socket,
        "--save",
        "",
        "--appendonly",
        "no",
      ],
      { stdout: "ignore", stderr: "pipe" },
    );
    const command = (...args: string[]) => {
      const result = Bun.spawnSync([
        "redis-cli",
        "-s",
        socket,
        "--raw",
        ...args,
      ]);
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
      return result.stdout.toString().trim();
    };
    try {
      for (let attempts = 0; attempts < 100; attempts++) {
        if (Bun.spawnSync(["redis-cli", "-s", socket, "ping"]).exitCode === 0)
          break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const keys = [
        "{host}:lease",
        "{host}:queue",
        "{host}:deadlines",
        "{host}:sequence",
      ] as const;
      const reserve = (token: string) =>
        command("EVAL", RESERVE_HOST_SLOT, "4", ...keys, token, "90000");
      expect(reserve("cstruck-1")).toBe("1");
      expect(reserve("heavytruckparts")).toBe("0");
      expect(reserve("bigtruckpage")).toBe("0");
      command("DEL", keys[0]);
      expect(reserve("cstruck-2")).toBe("0");
      // Repeated polling cannot move the later source to the front.
      expect(reserve("bigtruckpage")).toBe("0");
      expect(reserve("heavytruckparts")).toBe("1");
      command("DEL", keys[0]);
      expect(reserve("cstruck-2")).toBe("0");
      expect(reserve("bigtruckpage")).toBe("1");
      command("DEL", keys[0]);
      // Simulate an expired crashed waiter, without a real 30-second sleep.
      command("ZADD", keys[2], "0", "cstruck-2");
      expect(reserve("next")).toBe("1");
      expect(command("ZCARD", keys[1])).toBe("0");
    } finally {
      server.kill();
      await server.exited;
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
