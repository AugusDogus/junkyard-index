# Pausing and resuming saved-search alerts

Saved-search alerts run only while the boolean Vercel flag
`search-alerts-enabled` serves `true`. They fail closed: if the flag is
missing, can't be evaluated, or serves a non-boolean value, alerts are paused.
A newly created flag serves `false` in production.

While alerts are paused:

- **No check runs.** Pass end and the hourly deadline cron create no
  `search_alert_check` row and start no check workflow. A check workflow that
  is already running stops at its next batch, without delivering.
- **No Algolia search.** Nothing searches Algolia for alerts, and no saved
  search's `last_checked_at` window moves.
- **No delivery.** Delivery batches claim and send nothing. Pending
  notifications keep their state and go out once alerts are back on. Delivery
  is paused too because a pause should stop every alert a user could receive,
  including any a check created just before the pause.

## Relaunch without the backlog

When alerts have been paused for a while, each saved search's window still
starts at its last check. Switching the flag on would alert on everything
first seen since then. Saved searches stopped being checked on Nov 18 15:54
UTC, so that is about 10K vehicles, many of them relists re-created by the
Nov 19 mass deletes. The approved policy is to skip that backlog.

Do these steps in this order:

1. **Keep alerts paused.** Leave `search-alerts-enabled` off.
2. **Let search catch up.** Algolia must accept writes again, and a full
   rebuild must have published. No ingestion run should have
   `full_reindex_required = 1`. Until then the daily check's cutoff stays
   before those commits anyway.
3. **Advance every window to the relaunch time.** Use the current time or an
   earlier one. A future time would hold up commit claims.

   ```sh
   TURSO_AUTH_TOKEN=... bun scripts/resume-search-alerts.ts \
     --db-url libsql://<database> --relaunch-at <ISO time> --confirm
   ```

   It runs one transaction that sets `last_checked_at` to the relaunch time for
   every alert-enabled saved search, never moving a window backward. It
   refuses to run without `--confirm` and an explicit `--db-url`; it never
   reads the database from the environment. Rerunning it is harmless.

4. **Switch alerts back on.** Set `search-alerts-enabled` to `true`. The next
   pass end, or the hourly cron from 18:00 UTC, opens that day's check. The
   check matches only vehicles first seen after the relaunch.

If a check row for the day already exists from before the pause, it resumes
with its earlier cutoff. Every advanced window starts after that cutoff, so
the check searches nothing for those saved searches.

## "Alerts resumed" note (proposed, not built)

Nothing records or shows a note today. The digest and Discord payloads carry
only the matches, and the UI shows no alert status.

The smallest mechanism would be:

- **Column.** Add a nullable `saved_search.alerts_resumed_at` column. This is
  an additive migration, ordered after the open 0023.
- **Script.** The script would set it in the same transaction.
- **Digest.** The email digest and Discord message would add one line when
  any of their searches has `alerts_resumed_at` later than the recipient's
  previous delivery: "Alerts resumed on <date>. Vehicles listed while alerts
  were paused were not included."

This needs approval as a product change before it is built.
