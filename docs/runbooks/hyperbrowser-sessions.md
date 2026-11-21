# Hyperbrowser sessions

U Pull It Davie, Vander Haags, Big D, Northwest and 603 Auto Salvage load
documents through Hyperbrowser sessions (`HYPERBROWSER_SOURCES` in
`src/server/ingestion/hyperbrowser-sessions.ts`). The Hyperbrowser plan caps
how many sessions the team may keep open at once: 1 on Free, 25 on Startup.
`HYPERBROWSER_CONCURRENT_SESSIONS` holds that cap; change it with the plan.

## Session lease

Every session is opened under a lease in the deployment's Upstash Redis, so at
most `HYPERBROWSER_CONCURRENT_SESSIONS` sessions are open across all sources and
workflow runs. Each source has its own lane in the `hyperbrowser` lane group,
whose active places are the plan cap, and waiters take free places in FIFO
order. Local processes, including soaks, take no lease; the soak script runs
these sources one at a time instead.

- A chunk takes the lease with its first request and only then creates its
  session. When the chunk ends, the session stops first and the lease is
  released after it, on success, failure or interruption.
- Waiting holds no session. It is queue time, so it does not spend the chunk's
  work deadline. It lasts only while the chunk's remaining work allowance still
  fits before its turn horizon; then the chunk is deferred and retried five
  minutes later from the same cursor.
- A holder that dies keeps its place until the lease expires, one minute after
  Hyperbrowser stops the session it opened (sessions end
  `HYPERBROWSER_SESSION_TIMEOUT_MINUTES` after creation).
- If Hyperbrowser still refuses a session with "Maximum number of active
  sessions", the chunk is deferred, not failed. That means a session is open
  outside the lease: a soak or manual session, one whose stop failed, or a plan
  smaller than `HYPERBROWSER_CONCURRENT_SESSIONS`. Check active sessions in the
  Hyperbrowser dashboard if it repeats.
- Preview deployments keep their own lease keys but share the account, so a
  preview run can make production chunks defer on the plan refusal.

## Lock order

A chunk takes its session lease before any shared host turn and keeps it until
the chunk ends. Northwest takes the lease before its one URG turn per chunk and
opens its session inside that turn, so its session never waits for a turn; the
other sources take no shared host turns. No shared host turn holder ever waits
for the session lease, and waiting for a scoped lease inside a held turn fails,
so the two cannot deadlock.

While a Northwest chunk waits for its URG turn it holds the lease without a
session. That wait is not billed, but under URG contention it keeps the other
Hyperbrowser sources waiting for the lease, for at most the chunk's turn
horizon.
