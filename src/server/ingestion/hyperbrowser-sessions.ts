import type {
  CreateSessionParams,
  SessionDetail,
} from "@hyperbrowser/sdk/types";
import { Effect, type Scope } from "effect";
import { BrowserSessionError } from "./errors";
import {
  ProviderCapacityDeferred,
  ProviderTurnDeferred,
} from "./provider-chunk-clock";
import {
  providerHostLease,
  type ProviderHostGroup,
  type ProviderLeasePolicy,
} from "./provider-host-slot";

/** Sessions the Hyperbrowser plan lets the team keep open at once: 1 on the
 * Free plan, 25 on Startup. Change it with the plan. */
export const HYPERBROWSER_CONCURRENT_SESSIONS = 1;

/** Every ingestion source that may open Hyperbrowser sessions when
 * `BROWSER_PROVIDERS` chooses Hyperbrowser for it. A source must be listed to
 * take the session lease, so this stays a superset of the sources set to
 * Hyperbrowser, keeping the one-line fallback available to every source. */
export const HYPERBROWSER_SOURCES = [
  "upullitdavie",
  "upullrparts",
  "vanderhaags",
  "bigd",
  "northwest",
  "six03",
  "michigantruck",
] as const;
export type HyperbrowserSource = (typeof HYPERBROWSER_SOURCES)[number];

/** Hyperbrowser stops every session this long after creation, even when its
 * stop call fails or the process that opened it dies. Chunks end within the
 * six-minute chunk wall limit. */
export const HYPERBROWSER_SESSION_TIMEOUT_MINUTES = 10;

/** What callers use of a created session. */
type SessionHandle = Pick<SessionDetail, "id" | "wsEndpoint">;

const SESSION_GROUP: ProviderHostGroup = {
  key: "hyperbrowser",
  activeLanes: HYPERBROWSER_CONCURRENT_SESSIONS,
};

/** One lane per source, since a source runs one chunk at a time, under one
 * group whose places are the plan's concurrent sessions. */
const policy = (source: HyperbrowserSource): ProviderLeasePolicy => ({
  key: "hyperbrowser:" + source,
  label: "Hyperbrowser session for " + source,
  // A lease whose holder died outlives the session Hyperbrowser still bills,
  // so the next holder does not hit the plan's limit.
  leaseMs: (HYPERBROWSER_SESSION_TIMEOUT_MINUTES + 1) * 60_000,
  waitMs: 5 * 60_000,
  pollMs: 1_000,
  group: SESSION_GROUP,
});

/**
 * Coordinates Hyperbrowser sessions across sources and workflow runs, so no
 * more than `HYPERBROWSER_CONCURRENT_SESSIONS` are open at once.
 *
 * Lock order: a chunk takes its session lease before any shared host turn and
 * keeps it until the chunk ends, and opens its session only after taking it.
 * Northwest takes the lease before its one URG turn per chunk and opens the
 * session inside that turn; the other sources take no shared host turns. No turn
 * holder ever waits for this lease (`withProviderHostLease` refuses), so a
 * lease holder waiting for a turn cannot deadlock.
 */
export const HyperbrowserSessions = {
  policy,

  /**
   * Holds `source`'s place among the plan's concurrent sessions for the
   * enclosing scope, without opening a session. Take it before creating a
   * session in the same scope: scope finalizers run in reverse, so the
   * session stops before the place is released. A busy lease is waited for
   * in FIFO order, then fails with `ProviderTurnDeferred` so the chunk is
   * deferred; a waiting chunk holds no session. Locally there is no lease.
   */
  lease: (
    source: HyperbrowserSource,
  ): Effect.Effect<
    void,
    ProviderTurnDeferred | BrowserSessionError,
    Scope.Scope
  > =>
    providerHostLease(policy(source)).pipe(
      Effect.mapError((cause) =>
        cause instanceof ProviderTurnDeferred
          ? cause
          : new BrowserSessionError({ phase: "lease", cause }),
      ),
    ),

  /** Creates a session that Hyperbrowser stops after the session timeout. */
  create: (
    client: {
      readonly sessions: {
        create(params: CreateSessionParams): Promise<SessionHandle>;
      };
    },
    params: CreateSessionParams,
  ): Promise<SessionHandle> =>
    client.sessions.create({
      ...params,
      timeoutMinutes: HYPERBROWSER_SESSION_TIMEOUT_MINUTES,
    }),

  /** The deferral for a session create that the plan refused because its
   * concurrent sessions are in use, or null for any other failure. The SDK's
   * `HyperbrowserError` class is not exported at runtime, so it is matched by
   * name. */
  capacityDeferral: (cause: unknown): ProviderCapacityDeferred | null =>
    cause instanceof Error &&
    cause.name === "HyperbrowserError" &&
    /maximum number of active sessions/i.test(cause.message)
      ? new ProviderCapacityDeferred({
          provider: "Hyperbrowser",
          detail: `${cause.message} A session is open outside the session lease: a soak or manual session, one whose stop failed (Hyperbrowser ends it ${HYPERBROWSER_SESSION_TIMEOUT_MINUTES} minutes after it started), or a plan with fewer sessions than HYPERBROWSER_CONCURRENT_SESSIONS (${HYPERBROWSER_CONCURRENT_SESSIONS}). Check active sessions in the Hyperbrowser dashboard if this repeats.`,
        })
      : null,
} as const;
