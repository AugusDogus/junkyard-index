# Hyperbrowser sessions

U Pull It Davie, Vander Haags, Big D, Northwest, 603 Auto Salvage, Michigan
Truck Parts and the URG IIS tenants whose `transport` is `browser` load
documents through Hyperbrowser sessions (`HYPERBROWSER_SOURCES` in
`src/server/ingestion/hyperbrowser-sessions.ts`; the URG tenants are listed in
[urgiis-ingestion.md](urgiis-ingestion.md#transport)). The Hyperbrowser plan
caps how many sessions the team may keep open at once: 1 on Free, 25 on
Startup. The `HYPERBROWSER_CONCURRENT_SESSIONS` environment variable holds that
cap (unset means 1); set it in Vercel when the plan changes and redeploy, with
no code change. A value that is not a whole number from 1 to 999 fails the
build. A value above the plan's limit only makes chunks defer on the plan's
refusal (below).

## Session lease

Every session is opened under a lease in the deployment's Upstash Redis, so at
most `HYPERBROWSER_CONCURRENT_SESSIONS` sessions are open across all sources and
workflow runs. Each source has its own lane in the `hyperbrowser` lane group,
whose active places are the plan cap, and waiters take free places in FIFO
order. Local processes, including soaks, take no lease; the soak script runs
these sources one at a time instead.

- A chunk takes the lease with its first request and only then creates its
  session. When the chunk ends, the session stops first and the lease is
  released after it, on success, failure or interruption. A session whose
  connection fails is stopped at once, before a retry creates another, so a
  chunk never holds more than one session.
- Waiting holds no session. It is queue time, so it does not spend the chunk's
  work deadline. It lasts only while the chunk's remaining work allowance still
  fits before its turn horizon; then the chunk is deferred and retried five
  minutes later from the same cursor. A URG IIS chunk's eight-minute work
  allowance never fits its six-minute wall limit, so it never waits: it takes a
  free place at once or defers. A source that defers for three hours without
  advancing fails for that attempt.
- A session that cannot be created for any other reason (an invalid key, no
  credits left, an outage) fails the chunk's read. For URG IIS that is the
  tenant's page failure: after three reads in separate chunks only that tenant
  blocks, and the other tenants publish.
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
opens its session inside that turn, so its session never waits for a turn. A
URG IIS browser tenant takes a URG turn per request: its chunk takes the lease
before the first turn, opens the session inside that turn, and keeps both
through the chunk's later turns, so the session is billed while those turns
queue. The other sources take no shared host turns. No shared host turn holder ever waits
for the session lease, and waiting for a scoped lease inside a held turn fails,
so the two cannot deadlock.

While a Northwest chunk waits for its URG turn it holds the lease without a
session. That wait is not billed, but under URG contention it keeps the other
Hyperbrowser sources waiting for the lease, for at most the chunk's turn
horizon.

## Credits

Hyperbrowser bills session time per second, 100 credits per browser-hour, with
no per-session minimum. The sources other than URG IIS used 199 credits on
November 22, 2026 (190 sessions, 120 minutes, 07:00 to 09:13 UTC). The 11 URG
IIS browser tenants measured 0.179 credits per request at three pages per
session (dings) and 0.279 where every model page opens its own session (mars,
one of the seven 90-second tenants). Together that is about 690 sessions and
304 to 347 credits a day incremental, and 3,890 sessions and 1,680 credits for
a full census; the [URG IIS measured cost](urgiis-ingestion.md#measured-cost)
has the per-class projection, its upper bound and the Free and Startup plan
math. Read the
balance with `team.getCreditInfo()` and per-session use with `sessions.list`
(`creditsUsed`), or on the admin budgets page.
