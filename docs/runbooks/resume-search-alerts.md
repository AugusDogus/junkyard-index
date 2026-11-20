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

Do these steps in this order. Advance the windows before search catches up:
once a rebuild publishes, a workflow still running pre-flag code could match
the backlog.

1. **Keep alerts paused.** Leave `search-alerts-enabled` off.
2. **Confirm no pre-flag alert workflow is live.** Workflow runs stay pinned to
   the deployment that started them, and runs from deployments before the flag
   (#247) have no gate. A pass still running there would start an unflagged
   check and delivery at its end.
   - **Why a plain listing is not enough.** `workflow inspect runs --json`
     prints one page (20 runs, newest first) and ignores `--all`. A pass fans
     out dozens of `vehicleIngestionWorkflow` runs, so older pass runs land on
     later pages. The Vercel backend also lists only the last 24 hours unless
     `--since` is given.
   - **What the loop does.** It queries each alert-related workflow by name,
     looks back two weeks, and follows `cursor` until `hasMore` is false. It
     prints each live run's ID, workflow, status, deployment and start time.

   ```sh
   for name in vehicleIngestionPassWorkflow searchAlertCheckWorkflow \
     vehicleNotificationDeliveryWorkflow; do
     for status in running pending; do
       cursor=""
       while :; do
         page=$(npx workflow inspect runs --backend vercel --env production \
           -n "$name" --status "$status" --since 14d --limit 100 --json \
           ${cursor:+--cursor "$cursor"})
         echo "$page" | jq -r '.data[] |
           [.runId, .workflowName, .status, .deploymentId, .createdAt] | @tsv'
         [ "$(echo "$page" | jq -r .hasMore)" = true ] || break
         cursor=$(echo "$page" | jq -r .cursor)
       done
     done
   done
   ```

   - **What to look for.** Any row whose `deploymentId` is older than the
     deployment that shipped the flag. Compare against the production
     deployment in the Vercel dashboard. Source runs (`vehicleIngestionWorkflow`)
     don't matter here: no source run starts alert work.
   - **Cancelling.** Cancel only with the owner's approval, and target
     production explicitly. `workflow cancel` defaults to the local backend:

     ```sh
     npx workflow cancel <run-id> --backend vercel --env production
     ```

   - **Old passes.** A pass from an earlier day stops at its next plan, and the
     hourly cron starts the day's pass on the current deployment.

3. **Advance every window to the relaunch time.** Do this right away, even
   while Algolia is still blocked. Use the current time or an earlier one,
   with an explicit zone (`Z` or an offset). A future time would hold up commit
   claims.

   ```sh
   TURSO_AUTH_TOKEN=... bun scripts/resume-search-alerts.ts \
     --db-url libsql://<database> --relaunch-at <ISO time with Z> --confirm
   ```

   - **One transaction.** It sets `last_checked_at` to the relaunch time for
     every alert-enabled saved search, never moving a window backward.
   - **Guards.** It refuses to run without `--confirm` and an explicit
     `--db-url`, and it never reads the database from the environment.
   - **Pending notifications.** It refuses while any notification could still
     be delivered (`pending`, `retry` or `sending`), lists them, and changes
     nothing. Those may be backlog matches that would go out when alerts
     switch on. After inspecting them, rerun with `--cancel-pending` to cancel
     them in the same transaction.
   - **Reruns.** Rerunning it is harmless.

   Advancing early is safe. Each check still stops before any commit that is
   not in the search index, and a commit claim only needs to come a second
   after the newest window start.

4. **Let search catch up.** Algolia must accept writes again, and a full
   rebuild must have published. No ingestion run should have
   `full_reindex_required = 1`.
5. **Repeat step 2**, then **switch alerts back on.** Set
   `search-alerts-enabled` to `true`. The next pass end, or the hourly cron
   from 18:00 UTC, opens that day's check. The check matches only vehicles
   first seen after the relaunch.

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
