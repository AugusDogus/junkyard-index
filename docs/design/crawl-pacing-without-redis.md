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
other fetching run in the lane) and one place in each capped group (URG,
Kernel, Hyperbrowser). A run reports `fetched` to the pass once it has staged,
which frees its claims; the pass then starts the next run that fits. Inside a
chunk, the existing turn and slot code keeps the gap and the group cap with an
in-process store, so no request is coordinated across processes.

- **Commands a day:** 0 for pacing. Redis is back to the limiter and the
  Hollander cache, about 1.3K a day. Turso: none added (the plan's existing
  active-run query reads two more columns). Workflow events: one `fetched`
  report step per run (about 100 a day) and a re-plan at least every 30
  minutes while the pass waits, well inside the 25,000-event run limit.
- **Finish times:** each lane still does the same requests, so most sources
  in a lane finish earlier instead of all finishing together near the lane's
  end. The lane's last source finishes about as today, later where a source's
  own client gate is longer than the host gap, since nothing fills it. A
  source spanning several lanes waits for all of them. Measured below.
- **Failure modes:**
  - A dead run holds its claims until it reports. A run whose workflow died
    is resumed by the pass's watchdog re-plan or failure re-plan, as today,
    and keeps its claims while it fetches. The watchdog is an absolute 30
    minutes from each plan, so a run whose reports go elsewhere (another
    day's pass, an older deployment) frees its claims within one interval
    of leaving the `sources` stage, however many other reports arrive.
  - A pass stops admitting at the end of its ingestion day (07:00 UTC) and
    expires at its next plan, so two days' passes never admit at once.
  - A restarted pass rebuilds its state from Turso: a run that is still in the
    `sources` stage and has an attached workflow holds its claims; one never
    started waits for admission. No lease or TTL guesses.
  - Deploys: runs and the pass are pinned to the deployment that started them.
    A new deployment's pass treats an older deployment's fetching runs as
    holding their claims, so the two never share a lane. Older runs still
    poll Redis until they finish; nothing new does.
  - A manual "Run now" for a source with claims no longer starts its workflow
    directly. It asks the day's pass to re-plan (or starts one), and the pass
    admits it, so the pass stays the only thing that starts a shared-host
    run. On a day whose pass belongs to an older deployment, that pass starts
    it with the older Redis gates.
  - The pass learns that a run it started is fetching once the run's
    workflow attaches (its first step). A pass that restarts in that window
    could admit a second run in the lane; the window is seconds, and only
    after a pass restart.
- **Size:** medium. Pure admission module, pass loop, one report, a claims
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

Queue order: runs that claim fewer lanes go first, then plan order. URG IIS
crawls nine tenant lanes, one of which (`66.42.115.19`) it shares with Pratt;
whole-run claims make it wait for Pratt (about 50 minutes) rather than make
Pratt wait about 4 hours for it.

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

Fetch finish (`ready_at`), same simulator, Redis gates against admission:

|                            | Main, Redis   | Main, (a)     | #340, Redis   | #340, (a)     |
| -------------------------- | ------------- | ------------- | ------------- | ------------- |
| URG median of 16 sources   | 07:54         | 07:44         | 08:12         | 08:02         |
| Pratt                      | 08:19         | 07:52         | 08:16         | 07:52         |
| URG AWS lane(s), last      | 09:35         | 09:00         | 09:41         | 10:02         |
| VinPlus, first / last      | 08:21 / 09:28 | 07:33 / 09:11 | 08:21 / 09:27 | 07:33 / 09:11 |
| HTP, last                  | 07:25         | 07:19         | 07:24         | 07:19         |
| Last source except URG IIS | 09:35         | 09:11         | 09:41         | 10:02         |
| URG IIS                    | 11:03         | 11:28         | 11:00         | 11:49         |

Production on Nov 25 (Redis, before #340) was slower than either model: URG
median 07:57, AWS lane last 09:03, VinPlus last 10:15, URG IIS 13:21.

Two regressions:

- With #340's client gates (1.6 to 5 s after each lease, longer than the
  3.5 s host gap for Scotts and Jim's Import), interleaved sources filled one
  source's gate with another's request. In sequence, the gate is idle lane
  time, so the `aws` lane ends 21 minutes later (Scotts, 10:02).
- URG IIS waits for Pratt on the shared `66.42.115.19` lane (until about
  07:52), then crawls about 3.6 hours alone, so it ends 25 to 49 minutes later.

Every other group finishes earlier, most by 10 to 50 minutes.

## Follow-up not done here

- URG IIS could claim only its current tenant's lane (it crawls tenants in
  order), so it starts at 07:00 and meets Pratt only on the Lambert tenant.
  That needs claims per cursor and a mid-run claim request to the pass.
- The `aws` lane could recover its gate time by letting the next source in
  the lane start while the current one waits its client gate, or by moving
  Scotts (5 s gate) to `aws-2`.
