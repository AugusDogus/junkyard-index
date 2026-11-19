# VIN canonicalization dry run

Read-only production snapshot, 2026-11-18. No production database or Algolia
writes were performed. Before/after counts below describe the same sample
cohort, including source-string fallbacks for rejected decodes.

| Make      | Vehicles in sampled patterns | Model facets before | Model facets after |
| --------- | ---------------------------: | ------------------: | -----------------: |
| Ford      |                        3,793 |                 177 |                 54 |
| Chevrolet |                        4,161 |                 231 |                 56 |
| Toyota    |                        6,027 |                 133 |                 48 |
| Honda     |                        5,483 |                  82 |                 26 |

The census found **403,663 stored vehicles**, **396,695 live vehicles**, and
**46,617 eligible distinct patterns** across all stored vehicles. Eligibility
uses the implementation's VIN shape, year-code validation and low-volume WMI
extension. Packing every distinct pattern into full batches gives an ideal lower bound
of **933 requests**. A second read-only query simulated the actual 100-row,
VIN-ordered migration: **3,319 requests** across 3,215 nonempty request steps,
excluding retries, with at most 89 new patterns per step. Smaller partially
filled batches explain the difference. Subsequent runs only request new or
failed patterns whose cooldown has elapsed.

The live run attempted **2,000 distinct patterns**, broadly 500 per requested
make, selected evenly across sorted pattern keys with a small top-up for
invalid-year/cross-make duplicate patterns. It accepted **1,947 patterns**
(97.35%). Those patterns and rejected-pattern fallbacks cover **19,464 live
vehicles** across the four source makes. **19,393** of those vehicles received
trusted decodes; 71 retained source normalization. Requests were serial,
50 VINs per batch, with a one-second minimum pause and generic User-Agent.
There were 43 HTTP attempts including one transport retry and top-up batches.

These are sample-cohort facet reductions, not a claim that all production
facets have already changed. The whole production read-only inventory still
has 553 Ford, 684 Chevrolet, 287 Toyota and 194 Honda raw model values under
those make spellings. The production inventory has grown since the task's
450-value Ford observation. No sampled identities were written to production.

## Source/vPIC mismatches

Ignoring differences already handled by the site's make/model identity rules,
the sample had **410 distinct source/canonical pairs**, covering **2,032
vehicles**. These include source errors and legitimate differences in vPIC's
model taxonomy. Largest examples:

| Source make | Source model   | vPIC make/model       | Vehicles |
| ----------- | -------------- | --------------------- | -------: |
| Chevrolet   | SILVRDO15      | Chevrolet Silverado   |      130 |
| Chevrolet   | SILVERADO 1500 | Chevrolet Silverado   |       67 |
| Chevrolet   | TCHEV1500      | Chevrolet GMT-400     |       51 |
| Toyota      | MATRIX         | Toyota Corolla Matrix |       51 |
| Chevrolet   | K1500          | Chevrolet GMT-400     |       49 |
| Chevrolet   | TRAILBLAZ      | Chevrolet Trailblazer |       46 |
| Toyota      | SOLARA         | Toyota Camry Solara   |       39 |
| Chevrolet   | SILVRDO25      | Chevrolet Silverado   |       34 |
| Chevrolet   | S10            | Chevrolet S-10 Pickup |       34 |
| Toyota      | HIGHLANDR      | Toyota Highlander     |       34 |
| Ford        | F250SD         | Ford F-250            |       32 |
| Chevrolet   | C1500          | Chevrolet GMT-400     |       32 |
| Honda       | Civic Hybrid   | Honda Civic           |       31 |
| Chevrolet   | ASTRO          | Chevrolet Astro Van   |       26 |
| Chevrolet   | C/K 1500       | Chevrolet GMT-400     |       26 |
| Ford        | EXPEDITON      | Ford Expedition       |       25 |

Cross-make corrections included Chevrolet SONOMA to GMC Sonoma (6 vehicles),
Ford E150 to Chevrolet Express (1), Ford KONA to Hyundai Kona (1), and several
Chevrolet labels to GMC or Geo (1 each). A clean VIN decode takes precedence;
the source model is retained as secondary display data rather than discarded.

vPIC's Model field intentionally merges some commercially distinct names:
Silverado 1500/2500 become Silverado; Matrix becomes Corolla Matrix; Solara
becomes Camry Solara. Source trim is preserved, including useful XLT and King
Ranch values, and the source model still explains the yard's original label.
The recorded fixture contains unchanged public vPIC result rows for Ford,
Chevrolet, Toyota and Honda. Unit tests mutate those fixture-shaped inputs
only to exercise rejection cases; tests never call the live API.

## Rollout and replay

No initial owner-run step is required. Deployment runs the normal Drizzle
migration, then the existing scheduled search migration performs the bounded
schema-12 backfill and inventory refresh. Failed patterns do not block it.
Daily ingestion retries eligible patterns after 24 hours. An optional hosted,
authenticated `?force=true` migration rerun revisits observation-only records
after an outage. Existing saved filters and alerts that use retired raw model
labels require reselecting the canonical model.

To repeat the census and sample, run
`bun scripts/report-vin-canonicalization.ts --credentials=/path/to/.env`.
The script performs SELECTs only and stores public inventory/decode checkpoints
under `.scratchpad/vin-dry-run/`. It uses the final production-safe pattern key
and samples valid candidates directly, so a fresh run can select slightly
different patterns from this initial recorded run. Its checkpoint avoids
repeating successful live requests.
