# Southern provider sweep

Base: `feat/provider-coverage-launch-readiness` at
`91dcf455fa9c40f3ccb5882dfa265099d89e14e5`.
Native captures began 2026-11-18 UTC (2026-11-17 Central).

The sweep adds one enabled provider: R. Stroud's Auto Parts in Youngsville, NC.
Credits move AL 5 to 5, AR 5 to 5, LA 6 to 6, MS 7 to 7, TN 6 to 6, and NC 6 to 7.
The eight-column research artifact is [provider-coverage-south.csv](provider-coverage-south.csv).

The CSV has 1,057 records, including aliases, prior self-service screens,
existing providers, supplier-owned exclusions and directory-only leads. It is
not an exhaustive census of unique active businesses. `inventory=n` means no
qualifying inventory was established, including unresolved or blocked sites.
The result and reason columns distinguish those cases from confirmed rejects.

| State | Fresh businesses screened | Reused PR #184 records | CSV records |
| ----- | ------------------------: | ---------------------: | ----------: |
| AL    |                        53 |                     13 |         167 |
| AR    |                        46 |                     10 |         127 |
| LA    |                        47 |                     15 |         129 |
| MS    |                        45 |                      6 |         130 |
| TN    |                        90 |                     20 |         195 |
| NC    |                       151 |                     35 |         309 |

Fresh counts deduplicate native domains, individual Facebook profiles, HTP
suppliers and verified aliases. They include failed native-site attempts and
exclude inherited self-service records and supplier-directory ownership.

Discovery combined complete ARA state responses, Car-Part's names-only roster,
Atlas state/category directories, the public Carolina recycler member directory,
six 100-result state map searches, supplemental business searches, and the
complete current HeavyTruckParts and BigTruckPage seller directories. Search
errors and missing websites remain unresolved leads. Car-Part and salvage
auctions are excluded from admission.

## Qualified provider

Stroud's supplier NC62 is absent from the supplier-directory ownership list.
Its native ownership/address page, 43-make directory, 438-model graph and dated
arrivals passed the production traversal, including 45 separately requested
closing controls. All opening and closing directory labels, paths and counts
match. The 529-response replay retains 3,280 accepted donors, 296 rejected
observations, 51 duplicates and zero explicit exclusions across 3,627 records.
Its per-yard floor is 1,093. Newest accepted donor `1GCZGHFG2J1199828`, a 2018
Chevrolet Express 3500, was acquired November 13, 2026. The largest model group,
Altima, returned all 85 advertised cards.

Three platform-unreachable groups advertise 21 of 3,588 donors, within the
existing 1% allowance: Town & Country (16), Isuzu Pup (1), Lincoln & Town Car (4).
No route, rejection, duplicate or placeholder guard was relaxed. Blank VINs
remain rejected observations. The used-parts make links are normalized to their
canonical trailing-slash paths while HTTP redirect rejection stays unchanged.

WordPress database errors and timeouts interrupted the research traversal.
Committed checkpoints preserved progress; failed chunks' successful responses
are retained separately from the admitted trace. Later requests used eight-second
spacing after resting the host. The enabled tenant uses an eight-second pace and
90-second timeout. No HTTP403 or HTTP429 occurred on Stroud's host.

The [qualification summary](../../src/server/ingestion/urgiis-test-fixtures/south-qualification.json),
compressed native replay, request receipts and Census address match are committed
under `src/server/ingestion/urgiis-test-fixtures/`. Every replay body has a matching
HTTP200 receipt and SHA-256. The first 24 receipts have completion timestamps only;
505 have measured starts, including every closing request. Tests verify recorded
request gaps, closing requests after the completed opening census, unchanged
directories, freshness, yard coordinates, census accounting and one-third floor.

The existing offline runtime reporter was regenerated from saved fixtures. All
previous tenant rows remain unchanged. Stroud adds 529 full-census requests and
a 171.3-request daily average in the seven-day unchanged simulation. Aggregate
runtime scenarios, including the shared queue, rise to 42.8 full-census hours and
12.7 incremental hours. These are sizing scenarios, not measured live runtimes;
the existing first-publication monitoring risk remains documented in the
[launch runbook](provider-launch-readiness.md#first-urg-census-and-monitoring-windows).

## Near-misses

- Waugh, AL: 123 Hollander donor cards; recent acquisition unproved. Sample
  detail exposes the default date `1/1/0001`.
- Dennis Hall, TN: 1,437 Hollander donor cards; official root returned HTTP403,
  so that host was stopped. Recent acquisition unproved.
- South McCraven, MS: 44 Hollander donor cards; recent acquisition unproved.
  McRaven is the same business, not another provider.
- NLI Jasper, AL: all 28 HTP complete-vehicle entries inspected across two
  pages. Trailers and generic truck-sale stock do not prove salvage donor scope
  or a recent acquisition. `Please Call` alone was not a rejection reason.
- Moon's, LA: four donor-style WooCommerce cards. Sample detail lacks VIN and
  acquired date. Image-upload dates were not treated as acquisition dates.
- Triangle, NC: three for-parts arrival cards without VINs or a complete roster.
- Ed Jones, AR: static make/model gallery, no current VIN-qualified census.

OK Auto, MS retained its closing-audit rejection despite matching 5,679-card
totals. TNT, LA reused its prior 18.72% rejection-rate census. No admission
guard, blank-VIN policy or placeholder exclusion was relaxed.

Auto World, AL exposes recent arrivals and 370 model groups with 2,803 advertised
donors. Largest-model samples were below the 500-card cap. Of six suspect native
routes, two returned donor cards and four returned part-request fallback pages
without donor cards or an explicit empty result. Those four groups advertise 18
donors. The existing parser rejects the ambiguous response, so complete
enumeration remains unproved. No long census was attempted after that failure.

## Capture limitations

Quick Recovery's inherited homepage was inadvertently requested once before
exclusion enrichment. One Aesop/Tri-State root failed before ownership was
identified. Neither received follow-ups. Initial Auto World and Lambert roots
were not gated before their URG platform was identified. Subsequent known URG
requests use the shared flock for HTTP only, with one waiting request at most.

Early Stroud preflight filenames 0001 through 0004 were overwritten on the
canonical restart. Active qualification manifests refer to the canonical
captures. Later captures use unique filenames. Successful but uncommitted
responses from interrupted chunks are retained separately and excluded from
the committed replay trace.

Fifteen individually identified Facebook profile attempts returned HTTP400.
They remain unresolved, not evidence of absent inventories. Some association
searches returned service errors, also retained as unresolved evidence.
