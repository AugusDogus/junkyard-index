import type {
  HostReservation,
  ProviderHostStore,
  ProviderLeasePolicy,
} from "./provider-host-slot";

/** A waiter is dropped once it has not asked for this long. */
const WAITER_DEADLINE_MS = 30_000;

/** Waiters in the order they first asked, with each one's deadline. */
type Queue = Map<string, number>;

interface Lane {
  holder: { token: string; expiresAt: number } | null;
  queue: Queue;
}

interface Group {
  /** Lane holders with a place, with each lease's expiry. */
  active: Map<string, number>;
  /** Waiters at the front of a free lane, in the order they got there. */
  ready: Queue;
}

/** Leases held in this process, by lane and group key. */
export interface ProcessHostLeases {
  readonly lanes: Map<string, Lane>;
  readonly groups: Map<string, Group>;
}

export const ProcessHostLeases = {
  create(): ProcessHostLeases {
    return { lanes: new Map(), groups: new Map() };
  },
} as const;

/** This process's leases, shared by every chunk it runs. */
const PROCESS_LEASES = ProcessHostLeases.create();

const GRANTED: HostReservation = { _tag: "Granted" };
const queued = (laneAhead: number, readyAhead: number): HostReservation => ({
  _tag: "Queued",
  laneAhead,
  readyAhead,
});

/** Renews `token`'s place in `queue` and returns how many waiters are ahead. */
function position(queue: Queue, token: string, now: number): number {
  for (const [waiter, deadline] of queue)
    if (deadline <= now) queue.delete(waiter);
  queue.set(token, now + WAITER_DEADLINE_MS);
  return [...queue.keys()].indexOf(token);
}

function laneOf(leases: ProcessHostLeases, key: string): Lane {
  const lane = leases.lanes.get(key) ?? { holder: null, queue: new Map() };
  leases.lanes.set(key, lane);
  return lane;
}

function groupOf(leases: ProcessHostLeases, key: string): Group {
  const group = leases.groups.get(key) ?? {
    active: new Map(),
    ready: new Map(),
  };
  leases.groups.set(key, group);
  return group;
}

/**
 * Shared host leases kept in this process, with the same rules as the Redis
 * gate they replace: FIFO per lane, one holder per lane, at most a group's
 * `activeLanes` holders with places taken in the order lanes became ready,
 * and expiry of holders and silent waiters.
 *
 * Nothing is shared across processes. The daily pass starts at most one
 * fetching run per lane and no more runs in a group than its places
 * (`HostClaims`), so a lane's requests come from one chunk at a time. This
 * store paces that chunk's requests and caps a group when one process runs
 * chunks of several runs.
 */
export function processProviderHostStore(
  policy: ProviderLeasePolicy,
  leases: ProcessHostLeases = PROCESS_LEASES,
  clock: () => number = Date.now,
): ProviderHostStore {
  const lane = laneOf(leases, policy.key);
  const group = policy.group ? groupOf(leases, policy.group.key) : null;
  const free = (now: number) =>
    lane.holder === null || lane.holder.expiresAt <= now;
  return {
    reserve: async (token, leaseMs) => {
      const now = clock();
      const laneAhead = position(lane.queue, token, now);
      if (laneAhead > 0) return queued(laneAhead, 0);
      if (!free(now)) return queued(0, 0);
      if (group && policy.group) {
        for (const [holder, expiresAt] of group.active)
          if (expiresAt <= now) group.active.delete(holder);
        const readyAhead = position(group.ready, token, now);
        const places = policy.group.activeLanes - group.active.size;
        // Like the Redis script, count the release a full group waits for.
        if (readyAhead >= places)
          return queued(0, readyAhead + (places <= 0 ? 1 : 0));
        group.active.set(token, now + leaseMs);
        group.ready.delete(token);
      }
      lane.holder = { token, expiresAt: now + leaseMs };
      lane.queue.delete(token);
      return GRANTED;
    },
    release: async (token) => {
      group?.active.delete(token);
      if (lane.holder?.token !== token) return false;
      const owned = lane.holder.expiresAt > clock();
      lane.holder = null;
      return owned;
    },
    cancel: async (token) => {
      lane.queue.delete(token);
      group?.ready.delete(token);
      return true;
    },
  };
}
