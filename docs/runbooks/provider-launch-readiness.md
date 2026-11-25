# Provider coverage launch readiness

This change targets the six runtime problems in the November 15 launch analysis
(runtime and providers sections of `launch-readiness-parts.json`). That analysis
used older stack refs. The implementation starts at PR #174, where all registered
sources run unless their flag pauses them. No flags, accounts, deployments or production data were changed. The follow-up
URG coverage repair used the serial public read-only probes documented in the
[URG runbook](urgiis-ingestion.md#offline-request-and-runtime-estimate).

## Publication and alerts

VIN ownership priority is unchanged. A direct native feed still outranks its
marketplace copy, including AutoRecycler. Restoring AutoRecycler's former ordinal
position would change ownership, so that alternative was rejected.

Ready runs claim the shared commit first-in, first-out by `ready_at`, the time
validation staged them; source priority decides VIN ownership only. A ready run
does not wait for a run still fetching. One run still holds the shared commit
through reconciliation and search publication, then releases. A lower-priority
source can publish while Pontiac or URG fetches. If a native feed later lists the
same VIN, reconciliation transfers ownership and preserves `firstSeenAt`.

### Commit lease

[`commit-lease.ts`](../../src/server/ingestion/commit-lease.ts) holds the rules:

- Every claim attempt records `last_progress_at`, and waiters retry at least
  every 5 minutes. A waiter silent for 15 minutes is skipped, so a dead head of
  the queue blocks nobody. It keeps its place if its workflow resumes.
- A claim is stamped in a later whole second than every earlier holder, every
  saved-search check time and every daily alert check's `checked_through`, so
  its vehicles never fall inside a window already matched. It is never delayed
  for spacing.
- A run with no accepted source (every source failed or was rejected) never
  joins the queue. Validation ends it and frees its source's slot, so the
  source retries on schedule while another run holds the commit.
- Every claim attempt and every pass plan releases waiters staged more than
  24 hours ago. Their accepted sources become `expired`, nothing is reconciled,
  the prior inventory stays live, and each source re-crawls within its daily
  attempts. A pass plans when it starts (the hourly cron starts one when none
  is running), after its runs report, when a retry falls due, and at least
  every 30 minutes.
- A pass plan also releases waiters that were already queued when the current
  ingestion day began, marking their sources `superseded`, so the new day's
  crawl of that source starts on time. A crawl that validates after 07:00 UTC
  keeps its place. A released snapshot was a complete crawl, not a failure, so
  it starts no retry cooldown.
- `GET /api/admin/ingestion/lease` (cron secret) reports the holder and the
  oldest waiter. The oldest waiter's `waitingMs` is the starvation signal.

Workflows pinned to deployments from before the lease keep the source-priority
claim. Both claims are one guarded UPDATE that requires no other active run with
`commit_started_at` set, so exactly one run holds the commit across versions.
A pinned waiter never records progress, so FIFO claims skip it 15 minutes after
validation. Its own claim still waits for higher-priority ready runs, and it can
take a free commit out of order. FIFO claim attempts expire its snapshot after
24 hours, but it can publish a stale snapshot if it claims first. After the
deploy, list the live `vehicleIngestionWorkflow` and `vehicleIngestionPassWorkflow`
runs from earlier deployments and cancel them. Their runs stay active, and the
next hourly pass on the current deployment restarts them; it starts a workflow
only for a run whose attached workflow is not live.

Source runs never match saved searches. One daily alert check
([`search-alert-check.ts`](../../src/server/alerts/search-alert-check.ts)) matches
each alert-enabled saved search once against the vehicles first seen since its
last check. It starts when the day's pass ends (every registered source has
published, hit a deterministic validation rejection, or exhausted its three
attempts). A provider marks a rejection transient (`transientRejection` in
[`ingestion-validation.ts`](../../src/server/ingestion/ingestion-validation.ts))
when a later crawl can pass, such as a host that kept rate-limiting or a
catalog that changed during the crawl; it retries after the usual delay. From 18:00 UTC an hourly cron (at :40) starts it anyway, so a stuck
or abandoned source cannot hold back everyone's alerts.

The check fixes a bound when it starts: the second before any commit still in
progress or abandoned and awaiting a rebuild, and at least a minute in the past.
Vehicles first seen through the bound are searchable; later ones wait for the
next day's check, whose window starts at the bound. A claim stamped inside the
window waits, and a commit that publishes inside the window while a batch reads
Algolia makes the batch retry.

When the pass ends, inventory itself can be searchable earlier than alerts.
Source-filtered alerts see the final native owner rather than a temporary
marketplace listing, unless the deadline check runs while the native source is
still stuck. Grace-period inventory with a nonzero `missingRunCount` is
excluded from alert counts and previews during the paginated scan, preventing a vehicle already observed missing during the
pass from entering the digest. The scan uses existing record metadata, so it also
works with deployed numeric-filter settings. A failed crawl cannot prove a removal, so its prior
inventory remains governed by existing missing/delete rules.

Evidence and policy: [`reconciliation-policy.ts`](../../src/server/ingestion/reconciliation-policy.ts),
`keptByHigherPriorityOwner`, the guarded commit claim, and
[`search-alert-check.ts`](../../src/server/alerts/search-alert-check.ts).
Tests cover a lower publication during a native fetch, ready-source precedence,
source-filtered final ownership with preserved first-seen time, missing inventory,
and the alert check's bound, windows, and fences.
The first-deploy regression starts all 90 registered sources together: AutoRecycler,
Harry's and Budget each claim the commit five minutes later while URG and every
other higher-priority source remain in `sources`. Restoring the old claim condition
makes all three cases return `busy`.

### First URG census and monitoring windows

Ready-only publication removes URG's fetch from other sources' publication and
heartbeat critical paths. The publication lifecycle reports each released source's
health. URG's own cold census now has
bounded progress heartbeats while it completes its much larger first graph.

The [URG runbook](urgiis-ingestion.md#offline-request-and-runtime-estimate)
estimates all 20 publishing tenants with 74,217 donors, 12,339 full-census
requests and 3,627.3 mean incremental requests/day. At six seconds per response
plus existing local gaps, that is 1,847.3 minutes (30.8 hours) for a full census
and 549.4 minutes (9.2 hours) for a mean incremental day. Eagle, Ace St. Paul
and Norb's now publish under the unchanged 1% rule. Their daily shares are 131,
143.9 and 229.4 requests; the original 16 tenants still total 2,951.7. Neither
route substitution nor monitoring adds per-tenant URG requests.

These estimates exclude the shared queue. URG retains its local post-response
gap outside the shared lease, so the additional 3.5-second shared gap adds
12.00 full-census hours or 3.53 incremental hours: approximately **42.8 hours**
and **12.7 hours**, respectively. Even removing the duplicate local gap would
leave 32.56 hours for 12,339 responses at six seconds plus the shared gap.
Retries, storage/orchestration overhead and competing native IIS sources add
more time. These are explicit sizing scenarios, not measured live runtimes or
upper bounds. A cold census has a three-day deadline with the usual final-chunk
reserve and no model carry or deferral. Incremental runs keep their one-day
limit and unchanged carry/sweep rules.

Repository freshness lasts 36 hours after the last accepted inventory publication
([`durable-health.ts`](../../src/server/ingestion/durable-health.ts)); starting or
progressing a crawl does not refresh inventory freshness. A source with no
accepted publication remains stale immediately. Its `/api/status/<source>`
monitor returns 503 until publication, with a ten-minute freshness cache and
the documented three-minute monitor polling. Monitor activation remains a
rollout decision; no deployed settings were queried or changed.

For the configured heartbeat, each newly validated cold-census tenant pings only
after its complete graph, closing and admission checks have passed and its
checkpoint is durably saved. This does not clear delayed status reports or claim
fresh publication. Pages, cooldowns, failed/blocked tenants and replayed
checkpoints do not ping. A tenant already completed in an earlier failed run
with the same scope cannot ping again before another accepted inventory publication,
so repeatedly restarting a failing crawl cannot hide that failure. The existing
30-hour missing-progress window remains intact. Final accepted publication still
pings and resolves reports as before. A later full census within an incremental
run retains its existing one-day failure bound.

A census crossing the ingestion-day boundary does not delay alerts: that day's
check ran at its pass end or deadline, and the census's vehicles are matched by
the next check after they publish.

## Shared backend pacing

The configured URG IIS tenant origins and the native IIS catalogs of Aviation,
Chaz, A Plus, Central, Northwest, Pratt, Calton, Denton, OEM, Jim's Import, Scotts,
Pick-A-Part VA, All-N-1, Grandpa John's, Midway and Allied use Redis-backed host
queues, one per verified origin server:

- URG's own AWS load balancer (six shared IPs, `x-urg-storage` header), as
  two queues: Aviation, Calton and Scotts (`urg:aws`); Central and Jim's
  Import (`urg:aws-2`);
- Vultr 66.42.115.19: Lambert and Pratt;
- Vultr 149.28.120.41: Chaz (Metro also lives there but is not a source);
- every other host, including those behind Cloudflare, has its own queue.

A November 2026 study of about 17,800 saved URG requests found that response
times correlate within one origin server (r about 0.5 to 0.9) but barely across
servers (about 0.01 to 0.11), with no HTTP 429. The WordPress plugin on every
site does call a central URG API, so at most six URG queues may hold a lease at
once. Queues that are ready for a lease take free places in the order they
became ready. I-Pull (ifipull.com) and Indian River are not URG sites and keep
only their own client pacing.

The per-server queues replaced the single `ingestion:host:urg-iis:v1` lease
without a rolling-deployment interlock. Workflow runs stay pinned to the
deployment that started them, so a URG run started before the change keeps the
old lease and does not see the new queues or their cap. Until such runs finish,
one origin server can receive a request from each scheme at once. Deploy the
change when no URG source run is in flight, or accept that overlap.

The AWS split kept the single AWS queue's key, `urg:aws`, for Aviation, Calton
and Scotts, and added `urg:aws-2` for Central and Jim's Import. During a rolling
deploy, runs on the older deployment still queue all five sources on
`urg:aws`, so the balancer sees at most two of our requests at once (one per
key), the same as after the deploy. Renaming both keys would have let it see
three.

Each URG queue holds an exclusive lease through the entire response and an
additional 3.5-second gap, including failures. A client's own pacing gate (1.6
seconds on most connectors, 2.5 on Jim's Import, 5 on Scotts) runs after the
lease is released, so the source still waits it before its next request while
the queue serves other sources. Aviation, Calton, Central, Chaz, Denton, Jim's
Import and Scotts do this. A Plus, Northwest and OEM still pace inside their
turn; each has its own queue. All six VinPlus API clients share the
`inventory-search-api-581547763015.us-central1.run.app` lease with a 1.6-second gap.
Their independent website hosts are not grouped into that API budget. Existing
per-client pacing is retained, so some paths are slower than the shared minimum.
The complete configured membership is in
[`shared-provider-host.ts`](../../src/server/ingestion/shared-provider-host.ts).

### Morning timing of the URG model-page sources (November 25, 2026)

The ten model-page connectors read every model page daily (about 5,150 GETs).
Measured in production on November 22, the full-read day, the single AWS queue
moved about 2,400 GETs from 07:00 to 13:11 UTC, about 9.25 seconds per GET.
Live AWS pages answer in about 1.5 to 2.5 seconds, so most of each GET's queue
time was our own spacing: the 3.5-second gap plus the client gate inside the
lease. At 07:00 about a dozen URG queues also competed for four places, one of
them held by URG IIS all morning.

Three changes, modeled against November 22 (the model reproduces that day's
finishes within minutes), bring the last of the ten crawls from about 14:10 to
about 10:00 UTC:

- the AWS load balancer gets two queues of about 1,400 GETs each, so it sees at
  most two of our requests at once, each queue still with its 3.5-second gap;
- the URG group cap rises from four to six places;
- client gates run after the lease (above).

Start times stay at 07:00 UTC. On November 21, when Aplus, Chaz, Denton and
Calton each ran once overnight and again after 07:00, the later run found 6,
13, 4 and 15 new cars; most of the dated ones carry the previous day's date.
These sites keep adding cars late in the US evening or overnight, so an earlier
start would push those cars to the next day. No cheaper complete signal
exists: the November 19 URG study found no API or bulk export, Central's
arrivals listing missed about 38% of new cars, Northwest's had been stale since
October 9, and badges lag cards (see [model census](model-census.md) for why
badges cannot stand in for reads). A run also publishes as one snapshot, so
reading changed pages first would not publish anything sooner.

A failed run retries two hours after it stops. Run alone, a full read takes
about 55 minutes (A Plus, Chaz) to about two hours (Jim's Import, Denton).

HTP, C&S Truck and Big Truck Page now acquire their shared lease FIFO. A busy
source cannot reacquire ahead of queued requests. Polling renews a waiter's
30-second deadline without changing its order; crashed waiters expire, and
interrupted or timed-out waiters remove their queue entries. HTP's existing lease
key is retained for rolling-deployment compatibility. Its wait budget increases
to five minutes so two bounded requests can complete ahead of a third source.

Upstash bills every command a reservation script runs, so waiting is what the
Redis bill pays for. A reservation replies with how many waiters stand ahead in
the lane and how many ready lanes stand ahead for a group place. A waiter at the
front polls every `pollMs`. One further back sleeps `pollMs` plus one turn per
waiter ahead, where a turn is the larger of `pollMs` and the policy gap, since
each holder keeps the lease for at least the gap. A ready lane waits a turn
divided by the group's active lanes per ready lane ahead, since the group's
places free up in parallel. Sleeps stop at 10 seconds, so every live waiter
renews its 30-second deadline in time. A request that finds no queue and a free
lane (and, for a group, a free place) takes the lease without joining a queue.
In a model of the Nov 19 to 25 load, these rules cut billed commands from about
1.1 million a day to about 0.38 million, with the same crawl length.

Expected Redis cost of the daily model-page reads (Upstash pay-as-you-go, $0.20
per 100,000 commands, counting every command a script runs): under the
reservation script before the polling above, each URG GET cost about 40
commands, and 75 to 110 on the contended AWS queues with one-second polls, so
the about 4,000 extra GETs a day came to about 250,000 to 300,000 commands a
day, $14 to $18 a month. Two changes lower that: the position-based polling
above, and a two-second `pollMs` on URG queues, which halves how often a waiter
at the front of its lane repolls (about 6 to 16 commands each). The longer poll
adds about half a second of idle queue time per contended turn, up to about 12
minutes a day on the busier AWS queue's ~1,465 GETs. The combined cost has not
been remodeled: check the Upstash daily command count in the first week after
deploy.

Redis configuration, reservation, timeout and release failures remain failures.
There is no deployed in-process fallback. An uncertain acquired lease expires
rather than being unsafely removed. Local development keeps the existing HTP
bypass. URG waits at most 30 minutes and VinPlus ten minutes for a turn. This can
increase crawl duration under contention; the qualification time estimates are
not capacity guarantees with every source running together.

Connector chunk deadlines measure provider work, not queue time. On 2026-11-18
and 2026-11-19 about 20 sources joined the URG queue at 07:00. Each request then
waited roughly two to three minutes for a turn (measured 16 to 42 seconds per
request even after most sources had failed). Every new URG and VinPlus native
connector failed its first chunk at its wall-clock three-minute deadline, while
local soaks, which bypass the queue, took under a minute.
[`provider-chunk-clock.ts`](../../src/server/ingestion/provider-chunk-clock.ts)
now excludes time spent waiting for a shared turn from those deadlines.

Every connector on these queues takes a shared host turn
(`sharedProviderHostTurn`) at each request site. A turn holds one lease for a
unit of sequential requests, each still followed by the policy gap. Requests
that only together let a chunk advance share one turn: a context or owner fetch
with the chunk's first data request, and a last page with the closing reads its
cursor cannot hold separately. Pick-A-Part VA crawls atomically, so its whole
crawl is one turn. A chunk therefore advances with a single turn. Every request
inside a turn still takes a host slot (`sharedProviderHostSlot`), which waits
out the gap after the turn's previous request and records its own end; a client
that makes one raw request per turn uses `sharedProviderHostRequest`.

A chunk ends within six minutes of wall time: 800 seconds of function, less a
step that can start inline five minutes into its invocation, less 140 seconds
for the cursor and checkpoint writes around it. A turn waits only while its
estimated requests still fit before that limit, and work still running at the
limit is interrupted. Such a turn is deferred: nothing from it is accepted and
its lease is released. A chunk that already advanced returns its validated
checkpoint. One that has not is deferred as a whole: nothing is checkpointed,
and the source workflow retries the same cursor after a five-minute durable
pause. A source with no chunk advancing for three hours fails with a clear
message; its prior inventory stays published and it retries after the usual
two-hour delay.

The production Lua is exercised against an isolated local Redis Unix socket:

```sh
nix shell nixpkgs#redis --command bun test --timeout 15000 \
  src/server/ingestion/provider-host-slot.test.ts \
  src/server/ingestion/shared-provider-host.test.ts \
  src/server/ingestion/heavytruckparts-host-slot.test.ts
```

No deployed Redis or provider is contacted. Without a local Redis executable,
the ordinary unit suite skips only the Lua integration case. Effect-clock tests
still check request lifetime, failure gaps, cancellation and fail-closed behavior.

## Retry and yard isolation

Deterministic source validation failures stop automatic retries for that ingestion
day. Synchronous validation boundaries retain their original provider error types
and carry an in-process marker to the durable fetch boundary before Workflow
serialization. Rejection ratio, floor, previous-count drift, duplicate and closing
census failures persist as validation errors. HTTP status/body, Redis and other
transient fetch failures retain retries. A failed run waits two hours after its
completion, even if fetching already took longer than two hours or crossed the
07:00 UTC ingestion-day boundary. An explicit manual repair remains possible.

An Ario yard above 10% rejection or 25% duplicates is quarantined before source
accounting. Its rows do not contaminate AutoRecycler's source-wide ratio. Other
yards can publish. The yard cannot silently fall back to the legacy copy, and its
previous inventory and existing missing/delete counters stay unchanged. It is
excluded from baseline shrinkage calculations. Existing freshness and inventory
floors are retained; an aggregate source floor can still reject a truly undersized
snapshot. Tests exercise the per-yard threshold and preservation during actual
reconciliation.

## Workflow payload measurements

[`provider-cursor-payloads.json`](provider-cursor-payloads.json) records offline
measurements. Bytes below use Workflow's `devalue` representation, before any
platform compression. Inputs contain a representative run ID and cursor. Results
contain the actual cursor plus the normal scalar chunk metadata; they do not
claim to include Workflow's private event envelope.

| Source            | Canonical cursor bytes | Step input before | Step result before | Input after | Result after |
| ----------------- | ---------------------: | ----------------: | -----------------: | ----------: | -----------: |
| Brandywine        |              4,172,508 |         2,797,461 |          2,797,493 |         264 |          313 |
| Weber Brothers    |              6,284,993 |         5,259,401 |          5,258,813 |         270 |          319 |
| Lone Star Imports |                999,969 |           974,427 |            974,485 |         274 |          323 |
| OEM               |              1,649,882 |         1,422,148 |          1,422,140 |         250 |          299 |
| Denton            |              1,998,384 |         1,774,405 |          1,774,451 |         256 |          305 |
| URG IIS           |              4,308,110 |         4,975,985 |          4,976,044 |         256 |          305 |

Brandywine uses its complete saved census. Lone Star measures all 33 checkpoints
across 264 saved bodies and reports the largest. Weber/OEM/Denton use saved
qualification cursors. Denton's historical graph is unchanged but rebound to the
current contract hash solely for offline sizing and then fully revalidated. URG
reconstructs every configured tenant's complete opening graph and reports the
largest current-tenant checkpoint. Prior completed-prefix counts use qualified
floors, so its exact byte count is a sizing scenario rather than a captured wire
receipt. The full census state was already externalized by the incremental stack.

All sources now externalize canonical cursors above 256 KiB at the Workflow step
boundary, including future large intermediate states. Registered snapshot paths
and SHA-256 checksums bind references to their run/source. The normal snapshot
cleanup owns those blobs. Losing registrations delete staged blobs. Provider
cursor formats and canonical database checkpoints stay intact; this change
reduces Workflow event payloads rather than database cursor writes. Lone Star is
below 1 MB in this replay but also uses a reference for headroom.

Reproduce Brandywine, Lone Star and URG from repository fixtures:

```sh
bun scripts/report-provider-cursor-payloads.ts
```

Pass the November 14 qualification evidence directory as the first argument to
include the three archived cursors. No network is used. This is a targeted audit
of the named sources and other known large-state providers, not a measured census
of every possible cursor from all 90 sources.

## Chesterfield photographs and unchanged scope

A verified private Blob reference maps the exact provider image URL to preserved
photo content. An unchanged URL reuses the independently verified image without
requesting Chesterfield again. Changed URLs or missing images trigger normal
preservation. Corrupt storage fails closed. This follows the immutable-URL cache
choice; it does not detect replacement bytes served at the identical URL.

Account plans, pricing, abandoned Algolia rebuild cleanup, missing-scan indexes,
run-history pruning, Sentry sampling, alert request batching, and flag rollout are
outside these six fixes. They remain launch-analysis follow-ups. No production
verification or live load qualification was performed.

## Offline replay timing

(Fixture removed in the November 23 cut; history only.)

The Lentini replay injects saved responses and a fixed run clock. It never enters
the provider client, shared host lease or real-time pacing. Its former 600-second
timeout came from repeatedly validating, deriving and encoding multi-MiB
checkpoints. Validated evidence and complete seller-task graphs now reuse only
identical immutable objects. New wire input still receives full validation. Entry fingerprints and exact
encoded byte sizes are cached only for immutable validated entries. The new
entry-receipt checksum accepts legacy full-payload checksums on input. Mutation,
legacy resume and escaped Unicode byte-limit regressions pass.
The large replay keeps three-page chunks, wire resumes at phase transitions and
every 96 requests, and every existing donor, yard, destination and accounting
assertion. Small fixtures retain wire roundtrips at every individual checkpoint.
Complete saved Lentini replays passed all 16,777 assertions in 97.37 to 150.43
seconds on Bun 1.4.4 under concurrent CPU load (137.16 seconds with the final
validation cache), versus the reproduced 600-second timeout.
This is CPU work, so a fake lease cannot remove the remaining runtime.

Beaver's grouped negative replay also exceeded its 15-second deadline under
concurrent full-suite load. Closing drift, rejection-rate failure and previous-run
collapse now have independent 15-second deadlines, with identical inputs and
assertions. All 13 Beaver's/Lone Star tests pass together in 40.86 seconds under
load; Lone Star's complete 264-request wire-resume replay remains unchanged and
passed in 15.46 seconds against its existing 30-second limit.
