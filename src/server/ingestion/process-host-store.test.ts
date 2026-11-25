import { describe, expect, test } from "bun:test";
import {
  ProcessHostLeases,
  processProviderHostStore,
} from "./process-host-store";
import type {
  ProviderHostStore,
  ProviderLeasePolicy,
} from "./provider-host-slot";

const lane = (key: string, activeLanes?: number): ProviderLeasePolicy => ({
  key,
  label: key,
  leaseMs: 10_000,
  waitMs: 60_000,
  pollMs: 1_000,
  ...(activeLanes === undefined ? {} : { group: { key: "urg", activeLanes } }),
});

const granted = async (
  store: ProviderHostStore,
  token: string,
  leaseMs: number,
) => (await store.reserve(token, leaseMs))._tag === "Granted";

function setup() {
  let now = 0;
  const leases = ProcessHostLeases.create();
  const store = (policy: ProviderLeasePolicy) =>
    processProviderHostStore(policy, leases, () => now);
  return {
    store,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("processProviderHostStore", () => {
  test("says how many waiters are ahead in the lane and the group", async () => {
    const { store } = setup();
    const aws = store(lane("urg:aws", 1));
    const pratt = store(lane("urg:pratt", 1));
    await aws.reserve("a", 10_000);
    await aws.reserve("b", 10_000);
    expect(await aws.reserve("c", 10_000)).toEqual({
      _tag: "Queued",
      laneAhead: 1,
      readyAhead: 0,
    });
    expect(await pratt.reserve("p", 10_000)).toEqual({
      _tag: "Queued",
      laneAhead: 0,
      readyAhead: 1,
    });
  });

  test("grants a free lane and holds it until released", async () => {
    const { store } = setup();
    const aws = store(lane("urg:aws"));
    expect(await granted(aws, "a", 10_000)).toBe(true);
    expect(await granted(aws, "b", 10_000)).toBe(false);
    expect(await aws.release("a")).toBe(true);
    expect(await granted(aws, "b", 10_000)).toBe(true);
  });

  test("grants waiters in the order they first asked", async () => {
    const { store } = setup();
    const aws = store(lane("urg:aws"));
    await aws.reserve("a", 10_000);
    expect(await granted(aws, "b", 10_000)).toBe(false);
    expect(await granted(aws, "c", 10_000)).toBe(false);
    await aws.release("a");
    expect(await granted(aws, "c", 10_000)).toBe(false);
    expect(await granted(aws, "b", 10_000)).toBe(true);
  });

  test("gives up the lane of a holder whose lease expired", async () => {
    const { store, advance } = setup();
    const aws = store(lane("urg:aws"));
    await aws.reserve("a", 10_000);
    advance(10_001);
    expect(await granted(aws, "b", 10_000)).toBe(true);
    expect(await aws.release("a")).toBe(false);
  });

  test("drops a waiter that stopped asking", async () => {
    const { store, advance } = setup();
    const aws = store(lane("urg:aws"));
    await aws.reserve("a", 60_000);
    await aws.reserve("b", 60_000);
    advance(31_000);
    await aws.reserve("c", 60_000);
    await aws.release("a");
    expect(await granted(aws, "c", 60_000)).toBe(true);
  });

  test("cancels a waiter's place", async () => {
    const { store } = setup();
    const aws = store(lane("urg:aws"));
    await aws.reserve("a", 10_000);
    await aws.reserve("b", 10_000);
    await aws.reserve("c", 10_000);
    await aws.cancel("b");
    await aws.release("a");
    expect(await granted(aws, "c", 10_000)).toBe(true);
  });

  test("caps a group's lanes and frees a place on release", async () => {
    const { store } = setup();
    const aws = store(lane("urg:aws", 1));
    const pratt = store(lane("urg:pratt", 1));
    expect(await granted(aws, "a", 10_000)).toBe(true);
    expect(await granted(pratt, "p", 10_000)).toBe(false);
    await aws.release("a");
    expect(await granted(pratt, "p", 10_000)).toBe(true);
  });

  test("gives a group's free places in the order lanes became ready", async () => {
    const { store } = setup();
    const aws = store(lane("urg:aws", 1));
    const pratt = store(lane("urg:pratt", 1));
    const chaz = store(lane("urg:chaz", 1));
    await aws.reserve("a", 10_000);
    await pratt.reserve("p", 10_000);
    await chaz.reserve("c", 10_000);
    await aws.release("a");
    expect(await granted(chaz, "c", 10_000)).toBe(false);
    expect(await granted(pratt, "p", 10_000)).toBe(true);
  });
});
