# Skipping search publication

The boolean Vercel flag `ingestion-skip-search-publication` freezes search
while Turso ingestion keeps running, for example while Algolia rejects writes.
It is off by default. A missing flag, a failed evaluation or a non-boolean
value keeps search publication inline
([`search-publication-flag.ts`](../../src/server/ingestion/search-publication-flag.ts)).
New Vercel flags serve false in production, so creating the flag changes
nothing until it serves true.

## While it is on

Each reconciliation step reads the flag. When a run's final reconciliation
batch commits with the flag on, that one guarded UPDATE also:

- sets `status = 'success'`, `stage = 'released'`, `active_slot = null`,
  `released_at` and `completed_at`, so the shared commit is free at once;
- records `inventory_published_at`, `publication_sequence` and the published
  vehicle and yard totals, as an inline publication does;
- leaves `search_published_at` null and the run's `vehicle_change_v2` rows
  unprocessed;
- sets `full_reindex_required = 1` when the run wrote change rows or already
  carried a pending rebuild.

The workflow then reports the provider published, cleans up the run's staged
state and ends. It makes no Algolia request: no projection, no rebuild (even
one the run inherited), no alert matching and no temp-index cleanup.

A source run that is skipped this way still counts as published for the day
(`SourcePublication`), so it is not re-crawled, its freshness and status stay
green, and its connector seeds advance.

The day's pass also skips its stale temp-index sweep while the flag is on, so
a blocked Algolia cannot stop the pass from refreshing the homepage. Run
pruning still happens.

Otherwise the flag acts only at the final reconciliation batch. A run already in
`project_changes`, `full_reindex_*` or `match_alerts` when it turns on keeps
its inline path. Workflows started by an older deployment run older code and
never skip.

## Decoupled publication takes precedence

The string flag `ingestion-publication-mode` (`inline` or `decoupled`,
[`publication-mode-flag.ts`](../../src/server/ingestion/publication-mode-flag.ts))
wins over this one. Anything but the exact string `decoupled` keeps inline
publication. While it serves `decoupled`, a run's final reconciliation batch
releases the run exactly as a skipped one does, except that it records the
live totals from `yard_inventory`, sets `full_reindex_required = 0` (clearing
an inherited rebuild), and leaves its change rows for the search projector,
which reads `vehicle_change_v2` as an outbox. A run already in
`project_changes` or a `full_reindex_*` stage other than
`full_reindex_move_pending` releases at its next projection step without
calling Algolia, keeping its change rows and `full_reindex_required`; a run
moving an index finishes the move inline. A handed-off rebuild leaves its
`vehicles__rebuild_<run>` temp index for the search projector's sweep. The
pass's stale temp-index sweep does not run.

If `ingestion-publication-mode` cannot be evaluated on a deployment that
reads flags (on Vercel, or with `FLAGS` set), or serves a value other than
`inline` or `decoupled`, the mode is unknown. A run about to reconcile or
project then writes nothing and waits a minute before asking again, however
long the outage lasts; the waits never count toward abandoning it. No run is
released, handed off or marked as owing a rebuild on a guess, the pass skips
its temp-index sweep, and the search projector waits. Guessing inline while
decoupled would start an inline search writer; guessing otherwise while
inline would release a run mid-rebuild or owe a new full rebuild. A missing
flag means inline, and so does a process that cannot read flags at all
(tests, local scripts).

If decoupled publication is switched back to inline, the first inline
publisher rebuilds the index whenever a finished run left changes above the
search projector's checkpoint (`ingestion_projector_checkpoint` row
`search-projector`), so nothing the projector had not published is lost.

## Alerts while it is on

Source runs never match saved searches; the daily alert check does. A
skipped run keeps `full_reindex_required = 1`, and any run with it bounds the
check's window before that run's commit, so saved searches are not checked
against a search index that lacks the skipped vehicles, and their
`last_checked_at` windows do not advance past them. Checks resume covering
those vehicles once the rebuild publishes. Decoupled runs bound it the same
way while they have change rows above the search projector's checkpoint.

## When it turns off

1. The next run to claim the commit inherits `full_reindex_required` from the
   skipped runs (`claimCommit`). A run created while they were flagged already
   carries it.
2. Its final batch sends it to `full_reindex_prepare`. It rebuilds the index
   from the `vehicle` table, which holds every skipped change, and swaps it in.
3. Publishing that generation deletes every unprocessed change row, including
   the skipped runs', and clears the pending rebuild on every run it covers:
   runs started before it, runs released before it claimed the commit, and
   active runs that have not claimed yet. Later runs project only their own
   changes again.
4. On the current lifecycle, that run then matches alerts against the
   rebuilt index. The alert window
   still starts at each saved search's last check, so it includes every
   vehicle that arrived while search was frozen. Apply the relaunch backlog
   decision (advance saved-search watermarks) before turning the flag off if
   those alerts should not go out.

The rebuild needs Algolia to accept writes, and it briefly doubles the
record count with its temp index. Check the record cap first.

## Retention

A run with `full_reindex_required = 1` or unprocessed change rows is never
pruned, so skipped runs stay until the rebuild settles them
([`ingestion-run-retention.md`](./ingestion-run-retention.md)).
