# Distance sorting without a record copy

Distance searches use the primary `vehicles` index. `vehicles_distance` remains
an InstantSearch sort alias so `?sort=distance`, `?sort=vehicles_distance`, saved
searches, and the `Distance (Nearest)` label continue to work. The search client
maps both hit and facet requests to the primary and restores the alias in hit
response metadata for InstantSearch. It makes no additional search requests.

## Ranking evidence

Before this change, `COMMON_ALGOLIA_INDEX_SETTINGS` did not set `ranking`.
The primary only overrode `customRanking` with `desc(availableDateTs)`.
The distance replica explicitly used Algolia's default ranking and an empty
`customRanking`. There were no other ranking overrides in the repository.
This is a code and documentation comparison, not a live settings audit.

[Algolia's default ranking](https://www.algolia.com/doc/api-reference/api-parameters/ranking)
is `typo, geo, words, filters, proximity, attribute, exact, custom`. The settings
plan now pins that order on the primary explicitly. With the same geo parameters,
the primary and former distance replica compare all criteria identically until
`custom`. The primary then prefers newer inventory, a useful tie-break for cars
at the same yard. Newest only breaks ties after all preceding criteria, not all
cars in the same distance bucket. Typo count still precedes distance, so neither
implementation promises strict distance ordering across different typo counts.

`SearchPageContent` only supplies `aroundLatLng` for distance, from the account,
local ZIP preference, or resolved location. Automatic location uses
`aroundLatLngViaIP` when coordinates are unavailable. The client explicitly uses
`aroundRadius: "all"` and `aroundPrecision: 10` for the alias.
[10 meters is the documented default and minimum precision](https://www.algolia.com/doc/api-reference/api-parameters/aroundPrecision),
matching the old request behavior. Other sorts receive no new geo parameters.

Virtual replicas cannot change
[`ranking`](https://www.algolia.com/doc/guides/managing-results/refine-results/sorting/in-depth/replicas#unsupported-settings).
No different ranking formula is needed here, so another virtual replica would
add configuration without helping. Date/year sorts retain their virtual replicas
with `relevancyStrictness: 0`.

Saved-search criteria still normalize the old index name to `distance`. Alert
matching already searches `vehicles`, ignores presentation sort, and sends no
geo parameters. Alerts keep scanning all matching inventory within their existing
timestamp and pagination bounds.

## Owner-run settings apply

Deploy the application first, then run this from the deployed revision with the
production environment loaded and an Algolia key with settings, deletion, and
task permissions. Coordinate with ingestion and schema migration so no older
deployment or active workflow can restore the old replica settings.

```sh
bun run algolia:settings:apply
```

This is a settings-only command. It does not reindex vehicles. It waits for each
settings task, detaches `vehicles_distance` by listing only the three virtual
replicas, configures their sorts, then deletes the retired distance index and
waits for deletion. Removing a replica from the
[`replicas` list only detaches it](https://www.algolia.com/doc/api-reference/api-parameters/replicas);
the detached index still holds billed records until explicitly deleted.
[Deleting a nonexistent index is harmless](https://www.algolia.com/doc/libraries/sdk/methods/search/delete-index),
so the apply can be retried. Failures propagate and stop subsequent operations.

Deleting the old index happens only through the settings apply, including existing
callers of `configureAlgoliaIndex` that explicitly opt into configuration. Ordinary
deployment, browser searches, and ingestion with configuration disabled do not
delete it. The schema migration exits early when already ready, so it must not be
relied on to apply this change. This change was tested without Algolia write calls.

Apply settings before the next full rebuild. The rebuild copies only settings,
synonyms, and rules to one temporary primary, then moves it over `vehicles`.
Algolia's [copy operation excludes replica links, and move updates the destination's replicas](https://www.algolia.com/doc/libraries/sdk/methods/search/operation-index).
Once applied, only virtual replicas remain, so a rebuild cannot recreate the
distance copy. Search-index validation also excludes the retired physical index.

Rolling back to code that queries `vehicles_distance` requires restoring the
standard replica before serving that code. A stale deployment that reapplies the
old settings can recreate the billed copy.

## Record estimates

At approximately 271,000 vehicles, steady billed records fall from 542,000 to
271,000 after deletion. At 380,000 to 480,000 vehicles, they fall from roughly
760,000 to 960,000 to 380,000 to 480,000. The three virtual replicas add no billed
records. Actual totals depend on inventory and any unrelated or abandoned indices.

A full rebuild still temporarily stores a second primary. With no other indices,
the projected peak falls from approximately 1.14 to 1.44 million records (three
copies) to 760,000 to 960,000 (two copies), below the stated 1 million record cap.
There is little remaining headroom at the upper bound.

At the supplied Grow rate of $0.40 per 1,000 records above 100,000, removing the
copy saves about $108/month today and $152 to $192/month at the projected inventory.
These are marginal record-cost estimates, not a plan or pricing change.
