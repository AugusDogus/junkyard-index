# Ingestion run retention

Post-pass housekeeping and local ingestion prune terminal runs after 90 days.
The fixed limit is 100 runs per atomic delete, at most ten batches per pass.
Failures log the operation, cutoff, batch and error, then retry next pass.
Publication and homepage refresh do not depend on pruning succeeding.

The retention index covers `completed_at` for inactive runs. Both completion and
release must precede the cutoff. Running, unknown, active, incompletely terminal
and unconfirmed-move states are excluded. An outstanding full-reindex requirement
is preserved until the existing publication recovery clears it.

## Reference audit

`git grep -n -i 'ingestion_run\|ingestionRun'` covers schema, migrations, runtime,
scripts, workflow steps and tests. The six foreign-key children all cascade:
`ingestion_source_run`, `vehicle_snapshot`, `vehicle_observation`, `vehicle_change`
(archival), `vehicle_change_v2`, and `search_notification_intent`.

- `durable-source-validation` compares each source to its latest accepted,
  search-published count. Retain that run and the latest accepted attempt even
  if either is older than 90 days. URG and AutoRecycler also compare live yard
  inventory, which run deletion does not change.
- `urgiis-history` loads the latest accepted published census cursor. Snapshot
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
- `durable-reconciliation` allocates `max(publication_sequence) + 1`;
  `alert-config-repository` uses the same watermark for new subscriptions.
  Preserve the maximum sequence even if no search publication followed it.
- `homepage-stats`, public status and provider heartbeat reporting use the latest
  publication or an active run. Preserve each source's latest published run.
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
