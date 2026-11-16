# Beaver's Car Salvage

See the current [source flags and census floors](provider-coverage-go-live.md).

The `beavers` source covers one North Carolina provider family: Beaver's Car Salvage, Beaver's Garage and Beaver's Honda Country. The official parts business identifies 9455 Smith Road, Kannapolis NC 28081, and links its tenant 503 donor inventory. Its related Mooresville sales business adds no provider credit. Canonical coordinates come from the address-bound map marker linked by the parts site.

The November 15 UTC census traversed all 15 roster pages, all 290 published donor redirects and details, and all 15 closing roster pages. All 610 responses replay through the collector. There are 278 accepted donors, 12 missing-make rejects and zero duplicates. All 290 valid VINs remain represented by accepted vehicles or rejected presence observations. Optional photos, color, dates and yard position remain null. Abbreviated years are expanded only when unambiguous within the provider's published 1985-onward scope.

Collection emits only after required roster membership, order, totals and continuations close. Durable checkpoints preserve exact prefixes and joins, with eight physical GETs per chunk and a 2 MiB serialized limit. The client manually validates the published tenant/donor-bound redirect, makes no retries, and serializes requests with a 1.6-second completed-request gap. Unresolved original card-view POST evidence remains preserved; qualification used the independent public GET traversal.

The source retains the 10% rejection, 25% duplicate and 50% previous-count guards, with a census-grounded 92-donor minimum. Durable validation checks prior published counts before reconciliation. The source runs unless its pause flag serves false.

Research, native responses and the complete replay are in `.scratchpad/provider-coverage/nov14-provider-goal/research/va_nc_sc/`. Shared validation is recorded in `beavers-indianriver-application-tests.log` at the goal evidence root. A read-only full-census check is available without publication:

```sh
bun run soak:sources -- --sources=beavers --cycles=1
```
