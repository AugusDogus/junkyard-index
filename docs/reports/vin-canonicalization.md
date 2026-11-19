# VIN canonicalization dry run

Read-only production sample captured 2026-11-18, replayed with consumer-name
rules on 2026-11-19. No production database or Algolia writes were performed.
Before/after counts describe the same cohort, including source fallbacks for
rejected decodes. These are consumer models, preserving ratings and variants.

| Make      | Vehicles in sampled patterns | Model facets before | Model facets after |
| --------- | ---------------------------: | ------------------: | -----------------: |
| Ford      |                        3,793 |                 177 |                 92 |
| Chevrolet |                        4,161 |                 231 |                122 |
| Toyota    |                        6,027 |                 133 |                 75 |
| Honda     |                        5,483 |                  82 |                 60 |

The census found **403,663 stored vehicles**, **396,695 live vehicles**, and
**46,617 eligible distinct patterns** across all stored vehicles. Eligibility
uses the implementation's VIN shape, year-code validation and low-volume WMI
extension. Full 50-pattern batches give an ideal lower bound of **933 requests**.
A second read-only query simulated the actual 100-row, VIN-ordered migration:
**3,319 requests** across 3,215 nonempty request steps, excluding retries, with
at most 89 new patterns per step. Partially filled batches explain the difference.
Later ingestion requests only new patterns or failed patterns past cooldown.

The live sample attempted **2,000 distinct patterns**, broadly 500 per requested
make, selected evenly across sorted pattern keys with a small top-up for
invalid-year/cross-make duplicate patterns. It accepted **1,947 patterns**
(97.35%). Accepted decodes and rejected-pattern fallbacks cover **19,464 live
vehicles** across the four source makes. **19,393** received trusted decodes;
71 retained source normalization. Requests were serial, at most 50 VINs per
batch, with a one-second minimum pause and a generic User-Agent. The initial
sample used 43 HTTP attempts including one retry and top-up batches. The
consumer-name replay reused those public responses, with one additional serial
request to recover a missing recording. Tests make no live calls.

These are sample-cohort results, not a full-production projection. The larger
facet counts compared with the first PR report are intentional: Silverado
1500/2500, C1500/K1500, Civic Hybrid/Si and Super Duty remain distinct.

## Explicit consumer-name aliases

Rules are make-scoped and tested in `src/lib/consumer-model.test.ts`. Series,
Series2, Trim, DriveType and ElectrificationLevel are retained in the pattern
cache. Source-specific decisions are resolved per vehicle, never cached as a
single pattern-wide source label.

| Make / decoded family                                                | Evidence                                                               | Consumer model                                                              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Chevrolet/GMC GMT-400 or C/K Pickup                                  | Series 1500, 2500 or 3500                                              | C/K 1500, C/K 2500 or C/K 3500                                              |
| Same                                                                 | DriveType 4x2                                                          | C1500, C2500 or C3500                                                       |
| Same                                                                 | DriveType 4WD/4-Wheel Drive/4x4 or 4x4                                 | K1500, K2500 or K3500                                                       |
| Same                                                                 | Drive unknown, source explicitly C1500/K1500/etc. with matching rating | Keep source C/K distinction                                                 |
| Chevrolet/GMC Silverado, Sierra, Suburban, Express, Savana, Yukon XL | Explicit Series/Series2 rating                                         | Append 1500, 2500, 3500 or explicit HD rating                               |
| Chevrolet/GMC Silverado HD, Sierra HD                                | Explicit rating, or source rating when Series lacks one                | Silverado/Sierra 2500HD or 3500HD                                           |
| Chevrolet/GMC R Conventional, V Conventional                         | Source consumer label                                                  | Keep source, e.g. R10 or V20; do not infer Chevrolet/GMC rating equivalence |
| Ford F-250/350/450/550                                               | Series/Series2 contains Super Duty                                     | F-250 Super Duty, etc.                                                      |
| Honda Civic                                                          | Exact Series/Series2/Trim variant or specific source suffix            | Civic Hybrid, Si, SiR, Type R, GX or Natural Gas                            |
| Honda Civic                                                          | HEV/PHEV/hybrid ElectrificationLevel                                   | Civic Hybrid                                                                |
| Chevrolet S-10 Pickup                                                | Exact model alias                                                      | S-10                                                                        |
| Chevrolet Astro Van                                                  | Exact model alias                                                      | Astro                                                                       |
| Toyota Corolla Matrix                                                | Exact model alias                                                      | Matrix                                                                      |
| Toyota Camry Solara                                                  | Exact model alias                                                      | Solara                                                                      |
| Ford F-150                                                           | Source F150NEW, F150OLD, TFORD150, VFORD150, TRUCK-F150 or PICKUP F150 | F-150                                                                       |
| Chevrolet Silverado                                                  | Source SILVRDO15, SILVRDO25 or SILVRDO35 and no decoded rating         | Silverado 1500, 2500 or 3500                                                |

The explicit rating spellings are `1500`, `1500 (1/2 Ton)`, `1/2 Ton`,
`1/2 Ton Nominal`, and corresponding `2500`/`3/4 Ton` and `3500`/`1 Ton`
forms, plus `1500HD`, `2500HD`, `3500HD`. Matching ignores punctuation and
case. Unknown rating labels are not guessed. A more specific source label in
the same family is preserved when the decoder does not explain its suffix,
including Classic, HD and unknown variants. Reordered labels such as
Silverado Classic 1500 retain that distinction. A clean, explicit decoded
rating or drive type overrides a conflicting source rating or drive label;
the raw source remains visible. Trailing years from 1981 through 2100 are not
model variants. Source trim takes precedence over decoded trim.

## Source/canonical mismatches

Ignoring differences already handled by the site's identity rules, the sample
has **275 distinct source/canonical pairs**, covering **1,419
vehicles**. Largest examples:

| Source make | Source model | Consumer model           | Vehicles |
| ----------- | ------------ | ------------------------ | -------: |
| Chevrolet   | SILVRDO15    | Chevrolet Silverado 1500 |      130 |
| Honda       | CIVIC        | Honda Civic Hybrid       |       72 |
| Chevrolet   | SILVERADO    | Chevrolet Silverado 1500 |       61 |
| Chevrolet   | TRAILBLAZ    | Chevrolet Trailblazer    |       46 |
| Toyota      | HIGHLANDR    | Toyota Highlander        |       34 |
| Chevrolet   | TCHEV1500    | Chevrolet K1500          |       31 |
| Chevrolet   | Silverado    | Chevrolet Silverado 1500 |       29 |
| Chevrolet   | SILVRDO25    | Chevrolet Silverado 2500 |       27 |
| Ford        | EXPEDITON    | Ford Expedition          |       25 |
| Toyota      | CAMRY SOLARA | Toyota Solara            |       25 |
| Honda       | Civic        | Honda Civic Hybrid       |       22 |
| Chevrolet   | EXPRESS      | Chevrolet Express 1500   |       21 |
| Chevrolet   | K1500        | Chevrolet C1500          |       21 |
| Chevrolet   | SUBURBAN     | Chevrolet Suburban 1500  |       21 |
| Chevrolet   | TCHEV1500    | Chevrolet C1500          |       20 |

The K1500-to-C1500 mismatch reflects a clean VIN with 4x2 drive metadata,
not a rule merging K and C parts. Source labels can be incorrect. Recorded
public fixtures cover clean C1500/K1500, Silverado 1500/2500, Civic Hybrid,
Super Duty, S-10 and Astro identities.

## Saved searches and alerts

This app stores model choices in keyword queries and Boolean expressions,
not a persisted `models` filter array. A read-only aggregate found 17 saved
searches and zero model arrays. Original source model values remain in
Algolia's searchable attributes and Boolean `searchTokens`, alongside the
canonical identity. Existing saved searches and alert expressions therefore
keep matching the same source-labeled vehicles automatically, including
`SILVRDO15` and `F150NEW`. No user must reselect a model. This preserves prior
keyword semantics; it does not expand a yard-specific label to all equivalent
vehicles from other providers. Regression tests exercise projection, saved
filter parsing, query compilation and alert matching.

## URL coverage

The read-only audit captured **5,306 model URLs** from all retained
production snapshot versions, including **979 indexable model URLs**. Overlaying
the accepted sample onto the full live catalog leaves **5,265 URLs unchanged**
and requires **41 redirects**: **39 to canonical model pages**, **2 to
live make pages** for ambiguous labels. There are **0 unresolved destinations**
and **0 disappearing indexed URLs** in this partial sample. The complete
redirect list is in [vin-model-redirects.json](vin-model-redirects.json).

Before the backfill changes any vehicle, it retains every preferred make/model
URL from every retained snapshot version. Missing unique model URLs return 308
to the live canonical model. Ambiguous labels return 308 to the make page;
retired makes return 308 to `/cars`. Unknown URLs still return 404. A current
page remains available while any of its source vehicles remain. When its last
vehicle moves, the retained mapping handles that URL. Tests verify retained
versions, indexed URL coverage, ambiguity and Next's 308 redirect status.

The **41 redirects are a sample-overlay count**, not a forecast for all 46,617
patterns. The full hosted migration returns the actual retired-alias count as
`redirects` after rebuilding inventory snapshots.

## Rollout and replay

No initial owner-run step is required. Deployment runs the normal Drizzle
migration, then the existing scheduled search migration performs the bounded
schema-12 backfill and inventory refresh. Failed patterns do not block it.
Daily ingestion retries eligible patterns after 24 hours. An optional hosted,
authenticated `?force=true` migration rerun revisits observation-only records
after an outage. Cache keys are versioned so decodes without series metadata
cannot keep flattened identities.

To repeat the census, sample and URL audit:

```sh
bun scripts/report-vin-canonicalization.ts --credentials=/path/to/.env
```

The script performs SELECTs only and stores public inventory/decode checkpoints
under `.scratchpad/vin-dry-run/`. `report.json` includes facets, mismatches and
`modelUrls`, including the redirect list. It uses the final production-safe
pattern key and samples valid candidates directly, so a fresh run can select
slightly different patterns from this initial recorded run. Its versioned
checkpoint avoids repeating successful live requests. Delete that directory
to start a new sample.
