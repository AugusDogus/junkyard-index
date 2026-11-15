# Dutcher's Heavy Truck Division

The default-off `dutchers` source covers supplier 3987345, store 1 at 4495 Cramer Road, Morrisville NY 13408. The native purchased-for-parts page directly links that store. Its Complete Vehicle category is bound to the named operator and yard on every row. The earlier Hollander catalog's quality failure remains held separately.

The November 15 UTC census reconciles 587 distinct native items using both complete year-descending and year-ascending traversals. Either order alone repeats items and omits others. Their union matches the independent store count and per-year totals. Both full orders, the store count and native scope close unchanged. Final accounting is 579 accepted donors, seven rejects and one benign duplicate. Four 2020 Freightliner M2 106 items have unresolved overlap with an explicit native retail listing. They remain rejected in the denominator, and their valid VINs remain observed presence. Three other rows have invalid VINs.

The yard point is a Census Public_AR_Current exact-address street-range interpolation, not a rooftop or parcel point. Its actual response is saved in `.scratchpad/provider-coverage/nov14-provider-goal/research/ga_fl_al/refill04/dutchers-census-geocode.*`.

Inventory and yard staging occur only after full opening and closing validation. Durable validation also requires the terminal checkpoint, a 500-donor minimum, and the existing 10% rejection, 25% duplicate and 50% previous-count guards. Optional stock, photos, color, date and position remain nullable. Destinations are native item links restricted to the exact supplier, store and category.

Native GETs have no retries, manual redirects, a 25-second response deadline and a separate 25-second body deadline. The request gate covers the full body and a 4-second completed gap. Durable chunks admit at most eight GETs within the connector's two-minute chunk and one-hour run bounds. Bodies are limited to 2 MiB and serialized checkpoints to 8 MiB. A source failure preserves the previous inventory and checkpoint.

Actual response bytes and closing proof are in `.scratchpad/provider-coverage/nov14-provider-goal/root-dutchers-htp/`. The read-only soak counts and discards inventory and preserves incomplete status at a request cap:

```sh
bun run soak:sources -- --sources=dutchers --cycles=1
```

On November 15, a three-GET check of HTP robots.txt, the store and a
`year_start=2015&year_end=2015` Complete Vehicle search confirmed that year
ranges cannot replace pagination for this supplier. The store still reports
587 vehicles. The single-year search already returns the 25-row cap and a
Next link to page 2, so narrowing the year range cannot expose the remainder.
Unlike the smaller C&S store, Dutchers needs pagination to complete its census.
Pagination is retained despite robots.txt disallowing `*?*page=*` because the
year-range route cannot enumerate the full inventory. The client now waits at
least the published four-second crawl delay after each complete response, including failures.
The three requests used the client's existing User-Agent and Accept headers,
with at least 4.1 seconds between completion and the next request. Their full
responses and receipts are replayed offline from
`src/server/ingestion/dutchers-test-fixtures/year-range.json.gz`.
