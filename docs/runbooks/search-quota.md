# Search quota alarms

The Algolia plan allows a fixed number of search requests per billing period
(10K on the free plan; periods run from the 21st to the 20th). Running out
blocks the app, so search and index writes fail for everyone. Two alarms
watch the budget. Neither spends search quota.

## Alarms

1. **PostHog alert on the browser meter.** Each page view that called Algolia
   sends one `search_queries_metered` event with `path`, `requests` and
   `queries` (`src/lib/search-query-meter.ts`, reported from
   `src/instrumentation-client.ts`). `requests` counts HTTP calls that reached
   Algolia, including retries, below the client's response cache and below
   `src/lib/search-request-memo.ts`, which answers searches the tab already
   ran. `queries` counts the searches inside those calls. Algolia bills each
   call, not each search inside it.
2. **Algolia's own usage emails** at 80% and 100% of the plan, plus the weekly
   usage report. They go to the owner's inbox and count every request:
   browsers, server renders and alert matching.

### Set up the PostHog alert (dashboard, once)

1. Create a trend insight: the sum of `requests` on `search_queries_metered`,
   for the current month, shown as a cumulative total.
2. Add alerts at 50% and 80% of the plan's monthly searches (5,000 and 8,000
   on the free plan). Update both when the plan changes.

The billing period starts on the 21st, not the 1st, so a calendar-month total
under-reads the period's first ten days. Set the insight's date range to start
on the 21st when that matters.

## Limits

- The meter sees browser calls only. Server renders and alert matching spend
  quota without events, which is why Algolia's emails stay in place.
- A page hidden before PostHog loads can lose its event.

## Why there is no usage API probe

- Algolia's Usage API (`total_search_requests`) is available only on Premium
  plans and as an Enterprise add-on, not on the free or Grow plans.
- The Analytics API (`/2/searches/count`) counts searches after Algolia merges
  each typed query's keystrokes into its final query. It would under-read
  billed requests, so an alarm on it would fire late.

Revisit this if the plan moves to Premium. A daily cron reading
`total_search_requests` minus `querysuggestions_total_search_requests` would
then give an exact count.
