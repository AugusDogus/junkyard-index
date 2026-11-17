# Provider coverage launch readiness

This change targets the six runtime problems in the November 15 launch analysis
(runtime and providers sections of `launch-readiness-parts.json`). That analysis
used older stack refs. The implementation starts at PR #174, where all registered
sources run unless their flag pauses them. No flags, accounts, deployments,
production data, or live provider endpoints were changed or queried.

## Publication and alerts

VIN ownership priority is unchanged. A direct native feed still outranks its
marketplace copy, including AutoRecycler. Restoring AutoRecycler's former ordinal
position would change ownership, so that alternative was rejected.

A ready run waits for higher-priority **ready or committing** runs. It does not
wait for a run still fetching. One run still holds the shared commit through
reconciliation, search publication, and alert matching. A lower-priority source
can publish while Pontiac or URG fetches. If a native feed later lists the same
VIN, reconciliation transfers ownership and preserves `firstSeenAt`.

Earlier publications release without matching saved searches or advancing their
alert windows. The final run matches the settled daily index once every registered
source has published, hit a deterministic validation rejection, or exhausted its
three transient attempts, with no other active ingestion run. A transient retry
keeps this gate closed. Runs from an expired ingestion day cannot begin matching;
matching already checkpointed under the shared commit remains resumable. Local
unscheduled runs match only when no other ingestion run is active.

This deliberately delays alerts, while inventory itself can become searchable
earlier. Source-filtered alerts see the final native owner rather than a temporary
marketplace listing. Grace-period inventory with a nonzero `missingRunCount` is
excluded from alert counts and previews during the paginated scan, preventing a vehicle already observed missing during the
pass from entering the digest. The scan uses existing record metadata, so it also
works with deployed numeric-filter settings. A failed crawl cannot prove a removal, so its prior
inventory remains governed by existing missing/delete rules. This does not add
an independent end-of-day alert job; a pass that never settles leaves alert
windows intact for a subsequent settled pass.

Evidence and policy: [`reconciliation-policy.ts`](../../src/server/ingestion/reconciliation-policy.ts),
`keptByHigherPriorityOwner`, the guarded commit claim, and
[`settled-ingestion-alerts.ts`](../../src/server/alerts/settled-ingestion-alerts.ts).
Tests cover a lower publication during a native fetch, ready-source precedence,
source-filtered final ownership with preserved first-seen time, missing inventory,
transient retries, deterministic rejection, exhaustion, and expired days.

## Shared backend pacing

All configured URG IIS tenant origins and the native IIS catalogs of Aviation,
Chaz, A Plus, Central, Northwest, Pratt, Calton, Denton, OEM, Jim's Import, Scotts,
Pick-A-Part VA, All-N-1, Grandpa John's, Midway, Indian River, Allied and I-Pull use
one Redis-backed host queue. Distinct website origins do not receive separate
backend budgets. This is conservative grouping, not a claim that DNS proves one
server. Qualification explicitly treated the tenant origins as shared capacity:
[URG IIS pacing](urgiis-ingestion.md#live-qualification-requests) and
[batch B](urgiis-batch-b.md) document shared cross-process acquisition gates.
The native IIS catalogs share the same URG/IIS page and supplier infrastructure;
they are included conservatively rather than assuming independent capacity.

URG holds an exclusive lease through the entire response and an additional
3.5-second gap, including failures. All six VinPlus API clients share the
`inventory-search-api-581547763015.us-central1.run.app` lease with a 1.6-second gap.
Their independent website hosts are not grouped into that API budget. Existing
per-client pacing is retained, so some paths are slower than the shared minimum.
The complete configured membership is in
[`shared-provider-host.ts`](../../src/server/ingestion/shared-provider-host.ts).

HTP, C&S Truck and Big Truck Page now acquire their shared lease FIFO. A busy
source cannot reacquire ahead of queued requests. Polling renews a waiter's
30-second deadline without changing its order; crashed waiters expire, and
interrupted or timed-out waiters remove their queue entries. HTP's existing lease
key is retained for rolling-deployment compatibility. Its wait budget increases
to five minutes so two bounded requests can complete ahead of a third source.

Redis configuration, reservation, timeout and release failures remain failures.
There is no deployed in-process fallback. An uncertain acquired lease expires
rather than being unsafely removed. Local development keeps the existing HTP
bypass. URG waits at most 30 minutes and VinPlus ten minutes for a turn. This can
increase crawl duration under contention; the qualification time estimates are
not capacity guarantees with every source running together.

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
