# Ingestion run retention

Post-pass housekeeping and local ingestion prune terminal runs after 90 days.
The fixed limit is 100 runs per atomic delete, at most ten batches per pass.
Failures log the operation, cutoff, batch and error, then retry next pass.
Publication and homepage refresh do not depend on pruning succeeding.

The retention index covers `completed_at` for inactive runs. Completion, release
and last progress must precede the cutoff. Running, unknown, active, incompletely terminal
and unconfirmed-move states are excluded. An outstanding full-reindex requirement
is preserved until the existing publication recovery clears it.

## Reference audit

`git grep -n -i 'ingestion_run\|ingestionRun'` covers schema, migrations, runtime,
scripts, workflow steps and tests. Rechecked against provider main `062f20c8`,
including all registered sources. The six foreign-key children all cascade:
`ingestion_source_run`, `vehicle_snapshot`, `vehicle_observation`, `vehicle_change`
(archival), `vehicle_change_v2`, and `search_notification_intent`.

- `durable-source-validation` compares each source to its latest accepted,
  search-published count. Retain that run and the latest accepted attempt even
  if either is older than 90 days. URG and AutoRecycler also compare live yard
  inventory, which run deletion does not change. Per-source inventory publication
  baselines are retained from child rows too, including legacy all-source runs.
- `urgiis-history`, `byot-history` and `vanderhaags-history` load the latest
  successful accepted search-published source cursor. These provider-stack
  consumers retain a separate successful-source baseline even when a newer
  accepted source child failed. `urgiis-history` loads the census cursor; snapshot
  cleanup preserves its registered Blob. Retain runs with registered snapshot
  chunks, including compact Workflow cursors and provider state. Active runs
  retain all their cursors; completed cursors whose chunks were already collected
  have no live Blob reference.
- `urgiis-progress` compares retries against attempts since URG's latest accepted
  publication. Preserve that entire comparison window, including when URG has
  never published. Otherwise pruning could generate false progress heartbeats.
- `durable-ingestion-repository` checks today's schedule, retry counts, active
  commit claims, full-reindex recovery and recent source freshness. Active runs
  and today's runs remain. Old schedule keys and attempts have expired.
  Per-source commit claims, priority waits and ready-only publication guards
  retain every active run regardless of age or source count.
- Ario quarantine is stored in the active AutoRecycler cursor and snapshot state.
  Its preserved yard set still filters the source-scoped missing scan. Retention
  does not change vehicle or yard rows. Once that run is terminal, its Ario state
  is collectible only after the existing snapshot cleanup removes its registration.
- `InventoryAnnouncement` reads the commit-time anchor at or before its
  `indexnow-announcement` checkpoint. Retain the checkpoint run and every tied
  commit-time anchor until it advances. Departures only inspect recent run
  progress (three hours), already inside the retention window. Inventory rollup
  snapshots read the protected publication watermark and store their own data.
- `durable-reconciliation` allocates `max(publication_sequence) + 1`;
  `alert-config-repository` uses the same watermark for new subscriptions.
  Preserve the maximum sequence even if no search publication followed it.
- `homepage-stats`, public status and provider heartbeat reporting use the latest
  publication or an active run. Preserve each source's latest inventory-published
  and search-published run.
- `algolia-projector`, `durable-algolia-publish`, `algolia-rebuild-index`,
  `yard-checkpoint`, durable run steps and administrative run routes operate on
  active claims. Retain them, unprocessed `vehicle_change_v2` rows and pending,
  retrying, sending or claimed notification intents.
- `durable-search-alerts`, `alert-search-checkpoint`, `notification-intent-claim`
  and settled-ingestion delivery read run ownership and publication state.
  Completed delivery history is independent of run history; unfinished intents
  retain their owner. Archival changes and delivered/cancelled intents cascade.
- The local ingestion runner and Workflow post-pass housekeeping share the same
  pruning entry point. Operational scripts use these ingestion functions rather
  than introducing separate run references. Migration, reconciliation, scheduler,
  publication, alert and retention tests exercise these contracts offline.

Older retained baselines are intentional. Once replaced and no longer referenced,
they become eligible on a later pass. No vehicle, yard, arrival baseline,
departure or inventory-history record is deleted by run retention.
