# Search index migrations

VIN pattern search and strict Boolean OR search use additive Algolia schema
migrations. The application and its durable workflows ship together in the
Vercel deployment.

## One-time setup

Add `CRON_SECRET` to the Vercel project for the production environment. Use a
random value with at least 16 characters. Vercel sends it as a bearer token when
it invokes configured cron routes.

The production Vercel environment must also contain the Turso, Algolia, and
other server variables used by ingestion and alert delivery.

## Trigger.dev cutover

Complete this cutover before merging the Vercel Workflow deployment:

1. In the Trigger.dev production dashboard, pause the schedule for
   `vehicle-ingestion-daily`.
2. Confirm the schedule is inactive and no Trigger.dev ingestion run is active.
3. Merge and deploy the Vercel Workflow version.
4. Confirm only Vercel owns the 07:00 UTC ingestion schedule.

Removing the Trigger.dev task from this repository does not deactivate its
already deployed schedule. Never leave both schedulers enabled. The database
run lock prevents most duplicate writes, but the retired task can still project
to Algolia or deliver alerts after losing the lock.

## Normal deployment

1. Merge the PR to `main`.
2. Vercel deploys the application and Workflow SDK entry points together.
3. Vercel Cron starts `searchIndexMigrationWorkflow` at 06:00 UTC each day. The
   migration exits immediately after schema version `10` is ready.
4. The migration configures Algolia, backfills one durable vehicle batch per
   Workflow step, validates exact VIN and Boolean token filters, then writes
   search schema version `10` to the index settings. A retried batch safely
   rewrites the same object IDs before advancing its VIN cursor.
5. The production UI reads readiness on load. VIN patterns stay inactive until version
   `3`; Boolean OR queries stay inactive until version `4`. Each capability
   enables automatically after its required version is confirmed.

The daily ingestion workflow starts at 07:00 UTC. Workflow hook tokens prevent
duplicate active runs and serialize the migration with the ingestion projector,
so only one workflow writes to Algolia at a time. PR preview deployments do not
run Vercel Cron jobs.

Each provider runs as resumable, bounded chunks. A chunk writes vehicles to the
run-scoped `vehicle_snapshot` table and advances its source cursor in the same
transaction. Reconciliation starts only after every source reaches a terminal
state, then snapshots are removed after the system-of-record update commits.
Failed runs remove their snapshots while recording failure. A later run also
removes terminal snapshots and snapshots from abandoned runs older than seven
days.

## Observe and verify

1. Open the production project in Vercel and select the Workflows tab.
2. Confirm `searchIndexMigrationWorkflow` completed. Its steps report batch and
   record progress.
3. Enter a complete VIN in the production search bar and confirm it is detected
   as an exact VIN.
4. Search a known exact VIN, then test a pattern such as
   `YV4C*85**********`.
5. Starting from a known matching VIN, replace one position with a character
   set containing its original character, then with a range containing its
   original character. Confirm both patterns return the vehicle.
6. Confirm ordinary text search and each sort still return results.
7. Search `Honda OR Toyota`, confirm every result matches at least one
   alternative, and confirm the displayed result count is smaller than the full
   inventory count.

For local inspection, use `bun run workflow:inspect` or
`bun run workflow:web` while the development server is running.

## Failure and retry

If deployment or migration fails, ordinary production search continues. VIN
patterns and Boolean OR search remain inactive until their schema versions can
be confirmed.

Workflow steps retry transient failures twice with exponential backoff, for
three total attempts. Validation failures are fatal because retrying cannot fix
invalid indexed data. To start another run immediately, invoke the protected
production route:

```bash
curl --fail \
  --header "Authorization: Bearer $CRON_SECRET" \
  https://YOUR_PRODUCTION_DOMAIN/api/cron/search-index-migration
```

Starting the route more than once is safe. A second active run deduplicates to
the first, and a completed migration exits after reading schema version `10`.

## Rollback

Roll back the Vercel deployment normally. Running workflows remain pinned to the
deployment version that started them. The added Algolia record attribute, facet,
and version marker are backward compatible, so no destructive index rollback is
needed. Do not delete or replace the production index during rollback. Do not
reactivate the Trigger.dev schedule until the Vercel cron is inactive and any
Vercel ingestion run has completed or failed.

## Schema 8: chronological date sorts

`vehicles_newest` is a virtual replica with `relevancyStrictness: 0`, matching
`vehicles_oldest`. Both compare `desc(arrivalDateKnown)` first, then
`desc(availableDateTs)` for newest or `asc(availableDateTs)` for oldest. Yard
arrival dates and first-observed arrival dates share the timestamp projection;
unknown arrivals stay last in both orders. Model spelling and proximity no
longer outrank arrival dates in these explicit date sorts.

The primary keeps its default ranking, including geo before custom ranking.
It serves the honestly labelled Relevance sort and the existing distance alias.
Moving custom ranking ahead of textual relevance on the primary would change
relevance ordering and distance tie-breaking. The new virtual replica adds no billed record copy.
Projection leaves redundant make-in-model text unchanged because the sort fix
does not require guessing at vehicle identity.

After deployment, the existing schema migration applies settings in place,
backfills records, validates every selectable index, and advances the marker to 8. A separate `bun run algolia:settings:apply` is **not required** when that
migration runs successfully. The command can apply settings sooner, but does
not advance readiness or replace the migration. Newest stays unavailable until
the marker reaches 8; during rollout the default is labelled Relevance. Reload
a search after the migration completes to load the updated capability. The
public search key must allow searches on `vehicles_newest`, as on the other
virtual replicas.

New filter URLs use repeated array parameters, such as
`yards[]=RTP Pick-A-Part - Hebron, KY&yards[]=Another Yard`, encoded by
`URLSearchParams`. All multi-value filters, including yard types, use the same
format. Legacy comma-delimited values remain readable. For legacy yards, the
search page supplies known published comma-containing names, and parsing takes
the longest matching name before treating a comma as a separator. Unknown or
renamed legacy names remain best effort because the old encoding is ambiguous.
Saved filters and alerts retain JSON arrays, and links generated from them use
the new URL encoding.

## Schema 9: numeric query precision

`allowTyposOnNumericTokens: false` prevents typo matching on years and model
numbers. The primary forwards this setting to every virtual replica, including
`vehicles_newest` and `vehicles_oldest`; their sort overrides preserve it.
Word typo tolerance and prefix-matching configuration are unchanged. Models
with digits and wildcard VIN filters continue working. Plain typed year ranges
are unchanged.

After deployment, the existing in-place migration applies these settings,
backfills records, validates the indices, and advances the marker from 8 to 9.
A separate `bun run algolia:settings:apply` is **not required** after a
successful migration. Until the scheduled migration runs, searches continue
using the previous numeric typo behavior.

## Schema 10: bare VIN prefixes

Bare VIN searches match the first **8 through 16 characters**, without a
wildcard. Eight characters cover the manufacturer/type positions (1-3) and
vehicle-attribute positions (4-8) described in
[49 CFR 565.15(a)-(b)](https://www.law.cornell.edu/cfr/text/49/565.15).
This provides a useful descriptor-level search without matching broad, shorter
manufacturer prefixes. Matching is case-insensitive. Full VIN searches and
position-based wildcard filters continue working.

Projection now includes the full `vin` plus at most nine `vinPrefixes` tokens
(lengths 8-16) on the existing record. Both fields follow make, model, year,
and color in `searchableAttributes`. `disablePrefixOnAttributes` prevents
Algolia from expanding these tokens below eight characters, and
`disableTypoToleranceOnAttributes` prevents mistyped VIN matches. Other fields
retain prefix matching and word typo tolerance, while numeric typo protection
from schema 9 and chronological replica settings from schema 8 are preserved.
Legacy serials remain searchable in full, even when shorter than eight characters.

The new fields add at most 180 serialized JSON bytes per modern VIN (covered
by a projection regression, including a representative record under 10 KB).
There are no new records, indices, or replicas. Existing records already close
to the free plan's 10 KB record limit still need that headroom; the size check
is a representative fixture, not a production-wide size audit.

After deployment, the existing in-place migration applies settings, rewrites
the same object IDs, validates an eight-character prefix query together with
exact VIN and Boolean token filters on every selectable index, and advances
the marker from 9 to 10. A separate `bun run algolia:settings:apply` is
**not required** after a successful migration. Applying settings alone cannot
populate either new field on existing records. Before the backfill runs, bare VIN prefixes still
lack matching indexed tokens.

After migration, search a known VIN's first 8, 9, 10, 11, and 16 characters and
confirm the vehicle appears under Relevance, Newest, and Oldest. Check its full
VIN and wildcard filter too. A seven-character prefix, a non-prefix substring,
or a single-character mutation must not match through either VIN field.

## Schema 12: VIN make/model identities

Deployment applies `0026_vin_canonical_models` through the normal Drizzle chain.
Before acquiring the shared Algolia writer lock, the scheduled workflow fills
only the VIN pattern cache in bounded 100-vehicle steps. It stops the decode
pass when a vPIC batch exhausts its retries, returns an invalid service body
or requests a long cooldown. No shared publication or ingestion commit lock
is held during network enrichment. Cache errors also defer the optional phase.

The migration then acquires the writer, reads only cached decodes, and walks
existing vehicles in 100-row steps. It updates make/model/source-name/trim,
rewrites the same object IDs, refreshes snapshots and advances readiness to 12.
Daily ingestion and index projection never call vPIC. Until readiness is
confirmed, ingestion still applies existing string normalization and defers
VIN enrichment. Search filters bridge the existing make facet with exact
make tokens in the already-filterable searchTokens field. Each rewritten
record includes those tokens with its changed make, so saved filters and
alerts keep matching throughout the in-place migration, even with cached
pre-readiness capabilities.
No owner-run step is needed for the initial backfill or outage recovery.

Keys include VIN positions 1-8, 10-11 and the explicit vehicle year. Low-volume
WMIs (position 3 is 9) also retain positions 12-14. Plant codes are always kept.
Pre-1981 serials, forbidden characters and inconsistent year codes never request
vPIC. Only error codes 0 and 1 (check digit), with a matching model year and
nonempty make/model, produce canonical identity. Source names stay in
`source_make`/`source_model`; source trim takes precedence over vPIC trim.

Each cache-warming step requests at most 100 new patterns. Requests are serial,
50 VINs per POST, with a one-second minimum delay, eight-second timeout and
three attempts for network failures, 429 and 5xx. Backoff and Retry-After apply.
A failed request batch opens the circuit for the rest of the decode pass.
Failed/untrusted patterns retain source fallbacks and a 24-hour cooldown.
The next scheduled pass retries them. Newly accepted identities trigger a
cache-only re-projection automatically, including observation-only records.
The authenticated hosted `?force=true` endpoint is an optional explicit replay.
Requests use a generic User-Agent with no project or owner identity.

Consumer models combine vPIC Model with explicit Series/Series2 ratings,
DriveType and Civic variants. Silverado 1500/2500, C1500/K1500, Civic Hybrid
and Super Duty stay distinct. More specific source family variants, including
Classic and HD, remain when vPIC cannot explain the distinction. The small,
make-scoped alias table and the refreshed facet counts are in the
[recorded report](../reports/vin-canonicalization.md). Cache keys are versioned
so old flattened identities cannot suppress the richer decode metadata.

Before changing vehicles, the search migration retains preferred make/model
URLs from every retained inventory snapshot version. Missing unique model
URLs 308 to the canonical model; ambiguous labels 308 to a live make page,
and retired makes to `/cars`. Known URLs cannot disappear into a 404. The
migration result reports the final retired-alias count in `redirects`.

Existing saved model and make queries and alerts need no user action. The
original source model remains searchable for ordinary queries and Boolean
tokens. A searchable/filterable `makeAliases` array retains canonical and
source makes per record. Saved refinements and alert expressions use it after
schema readiness; before readiness they accept either the old make or exact
make tokens. Visible make facets remain canonical. Consumer brands such
as Scion retain their own make, and redirect lookup preserves make aliases,
case and model identity variants. Recorded regressions cover `SILVRDO15` and
`F150NEW`. This preserves the matching scope of a yard-specific keyword;
it does not globally expand it into every equivalent provider's vehicle.

A read-only census and resumable live sample can be repeated with:

```sh
bun scripts/report-vin-canonicalization.ts --credentials=/path/to/production/.env
```

It only executes SELECTs and calls public vPIC. Local reports and decode
checkpoints go under `.scratchpad/vin-dry-run/`. Delete that directory for a new
sample. See [the recorded sample](../reports/vin-canonicalization.md) for facet
counts, mismatches, coverage and the cold-cache request estimate.
