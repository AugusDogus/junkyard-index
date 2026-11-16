# OEM Auto Recyclers

See the current [source flags and census floors](provider-coverage-go-live.md).

The `oem` source covers the OH40 operation at 481 Township Road 27, Bluffton OH 45817. Native ownership, full-service inventory and two VIN-matching donor destinations bind the catalog to OEM Auto Recyclers. Partner parts sourcing adds no provider or yard credit. The saved published-yard roster and local qualified register have no matching operator, address or phone.

The November 15 UTC census follows 45 makes, 342 model controls and 60 arrivals. All 24 homepage-carousel stocks occur in arrivals. The alternate published arrivals page has the same 60 ordered records. The complete union has 2,227 observations: 2,158 accepted donors, 43 rejects or quarantines and 26 duplicate extras. Three conflicting VIN groups remain quarantined. Five valid rejected VINs remain presence evidence for reconciliation. All 152 closing controls pass, including every directory and first/last or badge-mismatched model membership.

The yard point comes from a Census Public_AR_Current exact-address match. It is a street-range interpolation, not rooftop or parcel verification. Native Google viewport coordinates are not used. Actual geocode bytes and the receipt are in `.scratchpad/provider-coverage/nov14-provider-goal/research/ga_fl_al/refill04/oem-census-geocode.*`.

Requests are serial, with a 1.6-second completed gap, no retries, a 40-second request/body deadline and eight GETs per three-minute chunk. Bodies and serialized cursors are limited to 4 MiB. Inventory emits only after complete closing and quality checks. Durable validation requires terminal cursor evidence and retains the 719-donor minimum, 10% rejection, 25% duplicate and 50% previous-count drift guards. Optional stock, photos, color, dates and position remain nullable.

Actual census responses and the separate offline replay are in `.scratchpad/provider-coverage/nov14-provider-goal/research/oh_mi_wi/refill02/`. The read-only soak discards inventory callbacks and retains incomplete status at a request cap:

```sh
bun run soak:sources -- --sources=oem --cycles=1
```
