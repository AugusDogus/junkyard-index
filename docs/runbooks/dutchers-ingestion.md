# Dutcher's Heavy Truck Division

The default-off `dutchers` source covers supplier 3987345, store 1 at 4495 Cramer Road, Morrisville NY 13408. The native purchased-for-parts page directly links that store. Its Complete Vehicle category is bound to the named operator and yard on every row. The earlier Hollander catalog's quality failure remains held separately.

The November 15 UTC census reconciles 587 distinct native items using both complete year-descending and year-ascending traversals. Either order alone repeats items and omits others. Their union matches the independent store count and per-year totals. Both full orders, the store count and native scope close unchanged. Final accounting is 579 accepted donors, seven rejects and one benign duplicate. Four 2020 Freightliner M2 106 items have unresolved overlap with an explicit native retail listing. They remain rejected in the denominator, and their valid VINs remain observed presence. Three other rows have invalid VINs.

The yard point is a Census Public_AR_Current exact-address street-range interpolation, not a rooftop or parcel point. Its actual response is saved in `.scratchpad/provider-coverage/nov14-provider-goal/research/ga_fl_al/refill04/dutchers-census-geocode.*`.

Inventory and yard staging occur only after full opening and closing validation. Durable validation also requires the terminal checkpoint, a 500-donor minimum, and the existing 10% rejection, 25% duplicate and 50% previous-count guards. Optional stock, photos, color, date and position remain nullable. Destinations are native item links restricted to the exact supplier, store and category.

Native GETs have no retries, manual redirects, a 25-second response deadline and a separate 25-second body deadline. The request gate covers the full body and a 2.5-second completed gap. Durable chunks admit at most eight GETs within the connector's two-minute chunk and one-hour run bounds. Bodies are limited to 2 MiB and serialized checkpoints to 8 MiB. A source failure preserves the previous inventory and checkpoint.

Actual response bytes and closing proof are in `.scratchpad/provider-coverage/nov14-provider-goal/root-dutchers-htp/`. The read-only soak counts and discards inventory and preserves incomplete status at a request cap:

```sh
bun run soak:sources -- --sources=dutchers --cycles=1
```
