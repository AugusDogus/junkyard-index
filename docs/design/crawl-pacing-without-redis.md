# Crawl pacing without Redis

Nov 25, 2026.

## Problem

Since Nov 17, sources that share a backend take a Redis lease for every
request (`provider-host-slot.ts`, `shared-provider-host.ts`). Every waiter
polls a Lua script about once a second, and Upstash bills each `EVAL` as 1
plus every inner `redis.call`. The 07:00 UTC crawl costs about 1.06M commands
a day (about $64 a month on pay as you go). PR #342 cuts that to about 0.38M
(0.51M with PR #340). Before Nov 17, Redis served only the page rate limiter
and the Hollander VIN cache, about 1.3K commands a day.

Goal: under about 15K commands a day (Upstash's free 500K a month), with the
same protections:

- one request at a time, with the policy gap, per shared origin: URG lanes
  (one lane per server, gated only on URG hosts and only during the request),
  VinPlus and Heavy Truck Parts (HTP);
- at most `URG_HOST_GROUP.activeLanes` URG lanes active at once;
- Kernel and Hyperbrowser concurrent session limits;
- no new load on Turso, whose reads and writes are billed with no overage.

## What the leases actually coordinate

Each source runs as its own workflow (`vehicleIngestionWorkflow`), started by
the day's pass (`vehicleIngestionPassWorkflow`). Two runs only need to
coordinate when they share a lane or a capped group. All of those runs are
started by one workflow: the pass, which is unique per day across deployments
(its hook token deduplicates it) and already hears from every run it starts.

Shared-host traffic per day (Nov 19 to 25 pages, `sim/pages-per-day.json`):
about 6.1K URG turns in about 1.4K chunks, 2.9K VinPlus turns in 360 chunks,
110 HTP turns, and about 100 browser chunks. Each lane is serialized today
anyway, so a lane's busy time is the sum of its sources' requests and gaps
whichever way they interleave.

## Options

### (a) Schedule host groups at the pass, pace inside the process

The pass admits a fetching run only when its claims are free: its lanes (no
other fetching run in the lane) and one place in each capped group (URG). A
run reports `fetched` to the pass once it has staged, which frees its claims;
the pass then starts the next run that fits. Inside a chunk, the existing turn
and slot code keeps the gap and the group cap with an in-process store, so no
request is coordinated across processes.

Browser sources (Kernel, Hyperbrowser) claim no place. A browser run sleeps
for most of its day with no browser open (U Pull R Parts block waits, City
Motors cooldowns, the Kernel budget deferral), so a whole-run place kept 6 to
7 Kernel sources queued behind 5 places for hours. The provider refuses a
browser past the plan's limit, and that refusal already defers the chunk
(`KernelSessions.capacityDeferral`, `HyperbrowserSessions.capacityDeferral`).

URG IIS reads its nine tenants in order, one per chunk, and claims only the
lane of the tenant it reads next (`SourceHostClaims.next`). When a chunk
finishes a tenant and the next one is on another lane, the chunk step returns
`needsClaims`, the run detaches its workflow, releases its run token and
reports `yielded` with the new claims. The pass queues it first and starts it
again once those claims are free; a restarted workflow resumes from the
checkpoint. So URG IIS starts at 07:00, and Pratt waits for it only while it
reads Lambert (`66.42.115.19`), and Lambert waits only while Pratt fetches.

The pass starts every run with the claims it may fetch with (a workflow
argument). The chunk step checks them before it fetches and after every
chunk, including a stored checkpoint that a resumed workflow replays, so a run
never fetches from a lane it was not admitted for, whatever state its
workflow was restarted in. A run this pass admitted gets the claims it was
admitted with. A run it found already started (after a pass restart) may
fetch only from its lanes that no other fetching run holds; anywhere else it
hands back.

- **Commands a day:** 0 for pacing. Redis is back to the limiter and the
  Hollander cache, about 1.3K a day. Measured costs elsewhere are under
  "Cost of the pass" below.
- **Finish times:** each lane still does the same requests, so most sources
  in a lane finish earlier instead of all finishing together near the lane's
  end. The lane's last source finishes about as today, later where a source's
  own client gate is longer than the host gap, since nothing fills it.
  Measured below.
- **Failure modes:**
  - A dead run holds its claims until it reports. A run whose workflow died
    is resumed by the pass's watchdog re-plan or failure re-plan, as today,
    and keeps its claims while it fetches. A run that reports `failed` keeps
    its claims until the plan that resumes it. While a run waits for claims, the
    watchdog is an absolute 30 minutes from each plan, so a run whose
    reports go elsewhere (an older deployment) frees its claims within one
    interval of leaving the `sources` stage, however many other reports
    arrive. With nothing waiting it is 30 minutes of silence, as on main.
  - Runs report to the pass of the current ingestion day, not the day that
    started them, so a run that crosses 07:00 (a cold URG IIS census) still
    reaches a listening pass. With no pass listening the report is dropped
    and the next pass plans from Turso; any other delivery failure retries
    the report step, and a report still undelivered after its retries is
    logged without failing the run.
  - A pass stops admitting at the end of its ingestion day (07:00 UTC) and
    expires at its next plan, so two days' passes never admit at once. Its
    day end wins over a report already waiting.
  - A failed plan or start step (a Turso or Workflow API blip) does not fail
    the pass: it waits 5 minutes, or until a re-plan request, and plans
    again. An admitted run whose start failed keeps its claims, so the next
    plan starts it.
  - A restarted pass rebuilds its state from Turso: a run that is still in the
    `sources` stage and has an attached workflow holds its claims; one never
    started, or one that yielded, waits for admission with the claims its
    cursor names. An attached URG IIS run that this pass did not admit holds
    every unfinished tenant's lane (`SourceHostClaims.held`), since its
    workflow may be on a deployment that does not yield. One this pass
    admitted keeps the claims it was admitted with. No lease or TTL guesses.
  - Each start is guarded (`startGuarded`). The start step marks the run as
    starting (a compare-and-set on `workflow_run_id`), then checks that its
    pass still admits: its ingestion day has not ended and it was not
    cancelled by a Run now hand-off. A pass that replaces it plans after the
    mark and holds the run's claims; a pass that lost its day clears the mark
    and starts nothing. The new workflow's id then replaces the mark. The
    mark names its pass: to that pass it never counts as a live start, so a
    retried start step starts the run again; another pass's mark older than
    2 minutes is a start that never finished.
  - A run stopped while fetching (admin Stop, or Stop and run) keeps its
    whole-run claims for `STOPPED_CHUNK_MS` (6 minutes, the chunk wall
    limit) after `released_at`: its workflow is cancelled, but a chunk step
    already running keeps sending requests on its own instance. The plan
    re-plans when that window ends.
  - Deploys: runs and the pass are pinned to the deployment that started them.
    A new deployment's pass treats an older deployment's fetching runs as
    holding their claims, so the two never share a lane. Older runs still
    poll Redis until they finish; nothing new does.
  - A manual "Run now" for a source with claims no longer starts its workflow
    directly. It asks the day's pass to re-plan (or starts one), and the pass
    admits it, so the pass stays the only thing that starts a shared-host
    run. A re-plan request ends any wait of the pass at once, including its
    sleep until a retry and its pause after a failure. If the listening pass
    is on another deployment than the one serving Run now, that pass is
    cancelled and a pass on current code is started (`PassHandoff`), so the
    run starts on current code, as on main; the admin message says so.
  - A run that yields names the claims its workflow was started with. The
    pass trusts a `yielded` report only from the workflow it admitted: one
    from a workflow it already replaced is ignored, and one for a run it did
    not admit makes it plan again from Turso, since another pass may have
    started a later workflow. The run releases its token before it detaches,
    so its next workflow cannot deduplicate against it.
  - Remaining window: a pass on the deployment before this design starts
    runs without the mark, so on merge day a Run now that replaces it within
    seconds of one of its starts could admit a second run on that lane.
- **Size:** medium. Pure admission module, pass loop, two reports, a claims
  table per source, store swap. Connectors do not change.

### (b) Workflow hooks or Vercel Queues hand off turns

Hooks are awaitable only in workflow functions, not inside a step, so a turn
handoff can be no finer than a chunk: the chunk step returns "needs lane X",
the run waits on its own hook, and the releasing run resumes the next waiter.
The waiter list still needs a store (Redis at 2 to 4 commands per chunk, about
4K to 8K a day, or Turso writes, which are off the table), or waiters poll hook
conflicts like the `algolia-writes` lock does (30 s), which spends workflow
events (the run limit is 25,000) and time.

- **Commands a day:** about 4K to 8K, plus fallback re-checks.
- **Finish times:** chunk-sized interleaving keeps today's pattern: every
  source in a lane finishes near the lane's end.
- **Failure modes:** a hook token is released when its run ends, which is
  better than a TTL, but a hung or suspended holder keeps it with no expiry;
  waiters need a fallback timer. Hook tokens are shared across deployments,
  so mixed deployments interlock.
- **Size:** large. Waiting moves from inside steps to every source workflow,
  and chunk results must carry the next lanes. Vercel Queues would move the
  fetch work itself into queue consumers, a larger change still.

### (c) Lease a host per chunk, pace in-process inside the chunk

One Redis lease per chunk instead of per request.

- **Commands a day:** acquire plus release is about 12 to 14 commands with
  PR #342's scripts, so about 20K to 25K a day with no waiting at all. With
  in-step polling PR #342 modelled about 233K a day. Deferring and sleeping in
  the workflow until the lease's expiry adds one or more polls per handoff,
  about 30K to 40K. Over budget either way.
- **Finish times:** as (b).
- **Failure modes:** today's TTL leases: a dead holder blocks a lane for the
  lease time; mixed deployments share keys.
- **Size:** medium. Every connector's turn sites change to one chunk turn.

## Decision

(a). It is the only option with zero pacing commands, it moves no cost to
Turso, it needs no TTLs, and it publishes most sources earlier. (b) and (c)
still coordinate at chunk granularity across processes, which costs either
Redis commands or workflow events, and keeps every source in a lane finishing
together.

Queue order: runs that claim fewer lanes go first, then plan order; a run
that yielded goes first, since it is mid-crawl.

## Measured with the Redis simulator

The Redis simulator (`redis-usage/sim`, adapted as `crawl-pacing/redis-sim.ts`)
replays the Nov 19 to 25 pages per source against a local Redis with the real
lanes, gaps, caps, chunk horizons and deferrals. `ADMIT` schedules the chosen
groups with the real `HostClaims.admit` and keeps their leases in the real
`processProviderHostStore`.

| Pacing                             | Billed commands a day | With #340 |
| ---------------------------------- | --------------------: | --------: |
| Before #342                        |             1,106,674 |           |
| Main with #342                     |               478,105 |   590,629 |
| URG admitted (first slice)         |               121,060 |           |
| Every group admitted (this change) |                     0 |         0 |

The yard-request rate limiter and the Hollander VIN cache add about 1.3K a
day. The #340 column uses a 1 s URG poll, not #340's 2 s, so it overstates
#340 somewhat.

Fetch finish (`ready_at`), same simulator, Redis gates against admission.
"Whole run" is the first version of (a), where URG IIS claimed all nine
tenant lanes and browser sources a place; "per tenant" is this design.

|                            | Main, Redis   | Main, whole run | Main, per tenant | #340, Redis   | #340, whole run | #340, per tenant |
| -------------------------- | ------------- | --------------- | ---------------- | ------------- | --------------- | ---------------- |
| URG median of 16 sources   | 07:54         | 07:44           | 07:44            | 08:12         | 08:02           | 08:02            |
| Pratt                      | 08:19         | 07:52           | 07:52            | 08:16         | 07:52           | 07:52            |
| URG AWS lane(s), last      | 09:35         | 09:00           | 09:00            | 09:41         | 10:02           | 10:01            |
| VinPlus, first / last      | 08:21 / 09:28 | 07:33 / 09:11   | 07:33 / 09:11    | 08:21 / 09:27 | 07:33 / 09:11   | 07:33 / 09:11    |
| HTP, last                  | 07:25         | 07:19           | 07:19            | 07:24         | 07:19           | 07:19            |
| Kernel, last               | 08:23         | 08:25           | 08:24            | 08:28         | 08:25           | 08:33            |
| Last source except URG IIS | 09:35         | 09:11           | 09:11            | 09:41         | 10:02           | 10:01            |
| URG IIS                    | 11:03         | 11:28           | 11:20            | 11:00         | 11:49           | 11:37            |

The per-tenant model splits URG IIS's pages across its tenants by their
inventory floors, puts Lambert on Pratt's lane, and hands back at each of the
8 lane changes; it does not model the seconds each hand-back takes (a detach,
a report and a workflow start). Kernel sources keep their in-process leases
but no pass place. Kernel's last source is Northwest, whose URG place now
competes with URG IIS from 07:00.

Production on Nov 25 (Redis, before #340) was slower than either model: URG
median 07:57, AWS lane last 09:03, VinPlus last 10:15, URG IIS 13:21.

Remaining regression: with #340's client gates (1.6 to 5 s after each lease,
longer than the 3.5 s host gap for Scotts and Jim's Import), interleaved
sources filled one source's gate with another's request. In sequence, the gate
is idle lane time, so the `aws` lane ends about 20 minutes later (Scotts,
10:01). URG IIS no longer waits for Pratt; it still ends 17 to 37 minutes
after main's Redis model, which let other URG sources start beside it.

What the model does not show: Pratt's same-day retries. With whole-run
claims they waited until URG IIS staged, 6 to 13 hours late in production.
Now a retry waits only while URG IIS reads Lambert (about a quarter of its
pages, roughly an hour).

## Cost of the pass

Each plan (`prepareWakeup`) reads about 15.8K Turso rows in production (Nov
25, read-only measurement of each statement, the commit lease UPDATEs measured
as SELECTs over the same WHERE). 15.2K of them are the pre-existing
recent-failures query; this design adds 1 row (the tenant read, by primary key) and 1 row
(stopped runs, through the retention index). A plan writes no rows unless a
commit lease expires or a slot is released.

Plans added over main: the absolute watchdog runs only while a run waits for
claims, about 07:00 to 09:00 (to 09:45 with #340), when reports already come
more often than every 30 minutes, so about 4 to 6 plans; plus one per Run now.
Hand-backs re-plan nothing: the pass admits the yielded run from the report.

| Added per day                          | Turso rows read | Turso rows written | Workflow events |
| -------------------------------------- | --------------: | -----------------: | --------------: |
| 4 to 6 watchdog plans, 0 to 4 Run nows |     80K to 160K |                  0 |        40 to 80 |
| 8 URG IIS hand-backs                   |       about 100 |                 16 |       about 190 |
| Kernel capacity deferrals              |               0 |                  0 |          5 each |
| `fetched` reports (about 100 runs)     |               0 |                  0 |       about 300 |

Monthly: about 2.4M to 4.8M rows read (0.1 to 0.2% of the Developer plan's
2.5B), under 1K rows written, and about 20K Workflow events, $0.40 a month at
$20 per million events. Redis pacing: 0 commands.

## Follow-up not done here

- The `aws` lane could recover its gate time by letting the next source in
  the lane start while the current one waits its client gate, or by moving
  Scotts (5 s gate) to `aws-2`.
- The plan's recent-failures query reads about 15K rows each time; an index
  on `ingestion_run.completed_at` that the join can use would cut every
  plan's cost.
