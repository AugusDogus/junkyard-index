import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import { Effect, Fiber, TestClock, TestContext } from "effect";
import {
  HostReservation,
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
            reserve: async () => HostReservation.queued(0, 0),
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
              reserve: async () => HostReservation.granted,
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

test("a waiter sleeps longer between polls the more turns stand ahead of it", async () => {
  // Behind three turns of its lane twice, then behind two ready lanes for one
  // of four group places, then at the front of a held lane.
  const places = [
    HostReservation.queued(3, 0),
    HostReservation.queued(3, 0),
    HostReservation.queued(0, 2),
    HostReservation.queued(0, 0),
    HostReservation.granted,
  ];
  let now = 0;
  const polledAt: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        withProviderHostSlot(
          { ...policy, waitMs: 60_000, group: { key: "g", activeLanes: 4 } },
          {
            reserve: async () => {
              polledAt.push(now);
              return places[polledAt.length - 1] ?? HostReservation.granted;
            },
            release: async () => true,
            cancel: async () => true,
          },
          Effect.void,
        ),
      );
      // The first poll happens before the clock moves.
      yield* TestClock.adjust("0 millis");
      while (polledAt.length < places.length) {
        now += 250;
        yield* TestClock.adjust("250 millis");
      }
      yield* TestClock.adjust("10 seconds");
      yield* Fiber.join(fiber);
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  // Each turn ahead holds the lane for at least the 3.5 s gap, and four
  // places share the ready lanes' turns. Sleeps stop at 10 s, so a waiter
  // renews its 30 s queue deadline in time.
  expect(
    polledAt.slice(1).map((at, index) => at - (polledAt[index] ?? 0)),
  ).toEqual([10_000, 10_000, 2_750, 1_000]);
});

test("a waiter never sleeps past the end of its wait", async () => {
  const polls: number[] = [];
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.either(
          withProviderHostSlot(
            { ...policy, waitMs: 15_000 },
            {
              reserve: async () => {
                polls.push(polls.length);
                return HostReservation.queued(5, 0);
              },
              release: async () => true,
              cancel: async () => true,
            },
            Effect.void,
          ),
        ),
      );
      yield* TestClock.adjust("15 seconds");
      expect((yield* Fiber.join(fiber))._tag).toBe("Left");
    }).pipe(Effect.provide(TestContext.TestContext)),
  );
  // Polls at 0 s, 10 s (capped sleep) and 15 s (the end of the wait).
  expect(polls).toHaveLength(3);
});

/** Billed Upstash commands for `run`: each script plus every command it ran. */
function billedCommands(
  command: (...args: string[]) => string,
  run: () => void,
) {
  command("CONFIG", "RESETSTAT");
  run();
  return command("INFO", "commandstats")
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("cmdstat_") && !line.startsWith("cmdstat_config"),
    )
    .reduce(
      (total, line) => total + Number(/calls=(\d+)/.exec(line)?.[1] ?? 0),
      0,
    );
}

const reply = (output: string) => output.split("\n").map(Number);
/** The flag a store sends with each reservation: "1" on a token's first. */
function firstAttempts() {
  const seen = new Set<string>();
  return (token: string) => {
    const flag = seen.has(token) ? "0" : "1";
    seen.add(token);
    return flag;
  };
}
/** "1" when a raw reservation reply granted the lease, else "0". */
const granted = (output: string) => String(reply(output)[0]);

test.skipIf(!hasRedis)(
  "an uncontended reservation runs few billed commands and a waiter learns how many turns stand ahead of it",
  () =>
    withRedis((command) => {
      const lane = (name: string) => [
        `{g}:lane:${name}`,
        `{g}:lane:${name}:queue`,
        `{g}:lane:${name}:deadlines`,
        `{g}:lane:${name}:sequence`,
      ];
      const group = [
        "{g}:ready",
        "{g}:ready-deadlines",
        "{g}:ready-sequence",
        "{g}:active",
      ];
      const first = firstAttempts();
      const reserveGrouped = (name: string, token: string) =>
        reply(
          command(
            "EVAL",
            RESERVE_HOST_SLOT,
            "8",
            ...lane(name),
            ...group,
            token,
            "90000",
            "1",
            first(token),
          ),
        );
      const keys = ["{h}:lease", "{h}:queue", "{h}:deadlines", "{h}:sequence"];
      const reserve = (token: string) =>
        reply(
          command(
            "EVAL",
            RESERVE_HOST_SLOT,
            "4",
            ...keys,
            token,
            "90000",
            first(token),
          ),
        );

      let result: number[] = [];
      expect(
        billedCommands(command, () => (result = reserve("a"))),
      ).toBeLessThanOrEqual(3);
      expect(result).toEqual([1, 0, 0]);
      expect(reserve("b")).toEqual([0, 0, 0]);
      expect(reserve("c")).toEqual([0, 1, 0]);
      // Repolling behind another waiter.
      expect(
        billedCommands(command, () => (result = reserve("c"))),
      ).toBeLessThanOrEqual(6);
      expect(result).toEqual([0, 1, 0]);

      expect(
        billedCommands(command, () => (result = reserveGrouped("x", "x1"))),
      ).toBeLessThanOrEqual(9);
      expect(result).toEqual([1, 0, 0]);
      // The group's one place is taken: y1 and z1 wait for it in turn.
      expect(reserveGrouped("y", "y1")).toEqual([0, 0, 1]);
      expect(reserveGrouped("z", "z1")).toEqual([0, 0, 2]);
      expect(
        billedCommands(command, () => (result = reserveGrouped("z", "z1"))),
      ).toBeLessThanOrEqual(13);
      expect(result).toEqual([0, 0, 2]);
      expect(reserveGrouped("x", "x2")).toEqual([0, 0, 0]);
    }),
);

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
      const first = firstAttempts();
      const reserve = (token: string) =>
        granted(
          command(
            "EVAL",
            RESERVE_HOST_SLOT,
            "4",
            ...keys,
            token,
            "90000",
            first(token),
          ),
        );
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
      const first = firstAttempts();
      const reserve = (name: string, token: string) =>
        granted(
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
            first(token),
          ),
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
        const output = reply(command(...body.map(String)));
        // Multi-line output is a script's array reply.
        return { result: output.length === 1 ? output[0] : output };
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
        expect(await first.reserve("first-1", 90_000)).toEqual(
          HostReservation.granted,
        );
        expect(await second.reserve("second-1", 90_000)).toEqual(
          HostReservation.queued(0, 1),
        );
        expect(command("ZCARD", `${tag}:ready`)).toBe("1");
        await second.cancel("second-1");
        expect(command("ZCARD", `${tag}:ready`)).toBe("0");
        expect(command("ZCARD", `${tag}:lane:urg:second:queue`)).toBe("0");
        expect(await first.release("first-1")).toBe(true);
        expect(command("ZCARD", `${tag}:active`)).toBe("0");
        expect(await second.reserve("second-2", 90_000)).toEqual(
          HostReservation.granted,
        );
        expect(command("GET", `${tag}:lane:urg:second`)).toBe("second-2");
        // Ungrouped lanes keep their existing keys.
        const plain = redisProviderHostStore(policy, redis, "production");
        expect(await plain.reserve("plain-1", 90_000)).toEqual(
          HostReservation.granted,
        );
        expect(command("GET", "ingestion:host:offline:v1")).toBe("plain-1");
        expect(await plain.release("plain-1")).toBe(true);
      } finally {
        globalThis.fetch = passthrough;
      }
    }),
);
