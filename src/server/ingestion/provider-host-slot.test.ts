import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  RELEASE_HOST_SLOT,
  RESERVE_HOST_SLOT,
  ProviderHostKeyspace,
  providerHostKeys,
  redisProviderHostStore,
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

// Redis Cluster hashes only the text inside a key's first {...}, or the whole
// key without one.
const hashSlotText = (key: string) => /\{([^}]+)\}/.exec(key)?.[1] ?? key;

test("production host gates keep the keys older deployments use", () => {
  expect(providerHostKeys(policy, "production")).toEqual({
    lease: "ingestion:host:offline:v1",
    lane: [
      "ingestion:host:offline:v1",
      "{ingestion:host:offline:v1}:queue",
      "{ingestion:host:offline:v1}:deadlines",
      "{ingestion:host:offline:v1}:sequence",
    ],
    ready: [
      "{ingestion:host:offline:v1}:ready",
      "{ingestion:host:offline:v1}:ready-deadlines",
    ],
    readySequence: "{ingestion:host:offline:v1}:ready-sequence",
    active: "{ingestion:host:offline:v1}:active",
  });
  // URG lanes share a group: old and new deployments must keep one queue.
  const tag = "{ingestion:host-group:urg:v1}";
  expect(
    providerHostKeys(
      { ...policy, key: "urg:first", group: { key: "urg", activeLanes: 1 } },
      "production",
    ),
  ).toEqual({
    lease: `${tag}:lane:urg:first`,
    lane: [
      `${tag}:lane:urg:first`,
      `${tag}:lane:urg:first:queue`,
      `${tag}:lane:urg:first:deadlines`,
      `${tag}:lane:urg:first:sequence`,
    ],
    ready: [`${tag}:ready`, `${tag}:ready-deadlines`],
    readySequence: `${tag}:ready-sequence`,
    active: `${tag}:active`,
  });
});

test.each(["preview", "development", "local"] as const)(
  "%s host gates never share a key with production and keep one hash slot",
  (keyspace) => {
    const productionKeys = new Set(
      [policy, { ...policy, group: { key: "urg", activeLanes: 1 } }].flatMap(
        (lanePolicy) => {
          const keys = providerHostKeys(lanePolicy, "production");
          return [...keys.lane, ...keys.ready, keys.readySequence, keys.active];
        },
      ),
    );
    for (const lanePolicy of [
      policy,
      { ...policy, group: { key: "urg", activeLanes: 1 } },
    ]) {
      const keys = providerHostKeys(lanePolicy, keyspace);
      const all = [
        ...keys.lane,
        ...keys.ready,
        keys.readySequence,
        keys.active,
      ];
      for (const key of all) {
        expect(key).toContain(`${keyspace}:ingestion:`);
        expect(productionKeys.has(key)).toBe(false);
      }
      const slots = new Set(
        (lanePolicy.group ? all : keys.lane).map(hashSlotText),
      );
      expect(slots.size).toBe(1);
    }
  },
);

test.each([
  ["production", "production"],
  ["preview", "preview"],
  ["development", "development"],
  [undefined, "local"],
  ["", "local"],
] as const)(
  "VERCEL_ENV=%p uses the %p host keyspace",
  (vercelEnv, keyspace) => {
    expect(ProviderHostKeyspace.parse(vercelEnv)).toBe(keyspace);
  },
);

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

const hasRedis = Boolean(Bun.which("redis-server") && Bun.which("redis-cli"));

/** Runs `use` against a throwaway Redis on a Unix socket. */
async function withRedis(
  use: (command: (...args: string[]) => string) => void | Promise<void>,
) {
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
    const result = Bun.spawnSync(["redis-cli", "-s", socket, "--raw", ...args]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return result.stdout.toString().trim();
  };
  try {
    for (let attempts = 0; attempts < 100; attempts++) {
      if (Bun.spawnSync(["redis-cli", "-s", socket, "ping"]).exitCode === 0)
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await use(command);
  } finally {
    server.kill();
    await server.exited;
    rmSync(directory, { recursive: true, force: true });
  }
}

// Runs the production Lua, not an in-memory imitation. Redis is optional for
// the normal unit suite; the launch runbook records the explicit local command.
test.skipIf(!hasRedis)(
  "Redis FIFO prevents a busy source overtaking either queued source and expires dead waiters",
  () =>
    withRedis((command) => {
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
    }),
);

test.skipIf(!hasRedis)(
  "Redis caps a group's active lanes and gives free places to ready lanes in the order they became ready",
  () =>
    withRedis((command) => {
      const group = "{group}";
      const lane = (name: string) => [
        `${group}:lane:${name}`,
        `${group}:lane:${name}:queue`,
        `${group}:lane:${name}:deadlines`,
        `${group}:lane:${name}:sequence`,
      ];
      const ready = [
        `${group}:ready`,
        `${group}:ready-deadlines`,
        `${group}:ready-sequence`,
      ];
      const active = `${group}:active`;
      const reserve = (name: string, token: string) =>
        command(
          "EVAL",
          RESERVE_HOST_SLOT,
          "8",
          ...lane(name),
          ...ready,
          active,
          token,
          "90000",
          "2",
        );
      const release = (name: string, token: string) =>
        command(
          "EVAL",
          RELEASE_HOST_SLOT,
          "2",
          lane(name)[0] ?? "",
          active,
          token,
        );
      expect(reserve("a", "a1")).toBe("1");
      expect(reserve("b", "b1")).toBe("1");
      // Two lanes are active: lane c waits for a place.
      expect(reserve("c", "c1")).toBe("0");
      // a2 waits behind its own lane, not for a place, so it is not ready.
      expect(reserve("a", "a2")).toBe("0");
      expect(reserve("d", "d1")).toBe("0");
      expect(release("a", "a1")).toBe("1");
      // d1 polls first, but c1 became ready first.
      expect(reserve("d", "d1")).toBe("0");
      expect(reserve("a", "a2")).toBe("0");
      expect(reserve("c", "c1")).toBe("1");
      expect(release("b", "b1")).toBe("1");
      expect(reserve("a", "a2")).toBe("0");
      expect(reserve("d", "d1")).toBe("1");
      // A crashed holder's place expires with its lease.
      command("ZADD", active, "0", "c1");
      expect(reserve("a", "a2")).toBe("1");
      expect(command("ZCARD", ready[0] ?? "")).toBe("0");
      // A dead ready waiter expires instead of holding back later lanes.
      expect(release("d", "d1")).toBe("1");
      expect(reserve("e", "e1")).toBe("1");
      expect(reserve("f", "f1")).toBe("0");
      expect(reserve("g", "g1")).toBe("0");
      expect(release("a", "a2")).toBe("1");
      command("ZADD", ready[1] ?? "", "0", "f1");
      expect(reserve("g", "g1")).toBe("1");
      // A lost lease still frees its place.
      command("DEL", lane("e")[0] ?? "");
      expect(release("e", "e1")).toBe("0");
      expect(command("ZCARD", active)).toBe("1");
    }),
);

test.skipIf(!hasRedis)(
  "grouped host stores share their group's places through Upstash, and a cancelled waiter leaves the ready queue",
  () =>
    withRedis(async (command) => {
      // Upstash REST commands, answered by the local Redis.
      const passthrough = globalThis.fetch;
      const run = (body: unknown) => {
        if (!Array.isArray(body)) throw new Error("Expected a Redis command");
        return { result: Number(command(...body.map(String))) };
      };
      globalThis.fetch = Object.assign(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body: unknown = JSON.parse(String(init?.body));
          return Response.json(
            Array.isArray(body) && Array.isArray(body[0])
              ? body.map(run)
              : run(body),
          );
        },
        { preconnect: passthrough.preconnect },
      );
      try {
        const redis = new Redis({
          url: "https://store.upstash.test",
          token: "store-test",
          retry: false,
        });
        const group = { key: "urg", activeLanes: 1 };
        const first = redisProviderHostStore(
          { ...policy, key: "urg:first", group },
          redis,
          "production",
        );
        const second = redisProviderHostStore(
          { ...policy, key: "urg:second", group },
          redis,
          "production",
        );
        const tag = "{ingestion:host-group:urg:v1}";
        expect(await first.reserve("first-1", 90_000)).toBe(true);
        expect(await second.reserve("second-1", 90_000)).toBe(false);
        expect(command("ZCARD", `${tag}:ready`)).toBe("1");
        await second.cancel("second-1");
        expect(command("ZCARD", `${tag}:ready`)).toBe("0");
        expect(command("ZCARD", `${tag}:lane:urg:second:queue`)).toBe("0");
        expect(await first.release("first-1")).toBe(true);
        expect(command("ZCARD", `${tag}:active`)).toBe("0");
        expect(await second.reserve("second-2", 90_000)).toBe(true);
        expect(command("GET", `${tag}:lane:urg:second`)).toBe("second-2");
        // Ungrouped lanes keep their existing keys.
        const plain = redisProviderHostStore(policy, redis, "production");
        expect(await plain.reserve("plain-1", 90_000)).toBe(true);
        expect(command("GET", "ingestion:host:offline:v1")).toBe("plain-1");
        expect(await plain.release("plain-1")).toBe(true);
      } finally {
        globalThis.fetch = passthrough;
      }
    }),
);
