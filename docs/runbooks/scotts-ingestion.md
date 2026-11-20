# Scott's Used Parts

See the current [source flags and census floors](provider-coverage-go-live.md).

The `scotts` source covers Scott's Used Parts / Scott's Auto Recyclers at 938 West Willox Lane, Fort Collins CO 80524. Native contact and operational pages, CC68 donor photos and VIN-matching component destinations bind the catalog to this Colorado provider. An unrelated Mark's template footer is retained in evidence. Wyoming delivery marketing adds no state credit.

The November 15 UTC census follows all 34 makes and 221 model controls: 1,064 cards, 976 accepted donors, 88 required rejects and zero duplicates or identity conflicts. Badges total 1,058. The six differing model memberships stayed unchanged on closing. The 44 closing controls include ownership, makes, every model directory, first/last model memberships and all six discrepancies. The historical arrivals timeout remains unresolved and was never retried. Qualification covers the independently published make/model catalog.

Required fields use existing VIN/serial and year/make/model validation. Optional stock, images, color, dates and position remain nullable. Valid rejected identities remain presence evidence, and required identity/destination conflicts are quarantined. Shared validation retains the 325-donor minimum, 10% rejection, 25% duplicate and 50% previous-count drift guards.

The collector uses serial requests with five-second completed spacing, no retries, six GETs per chunk, a three-minute chunk deadline and a 2 MiB serialized checkpoint bound. Closing repeats ownership, the make directory and every model read this run whose card count differs from its badge, so a short page that does not repeat is never carried forward; carried models are not re-read. Before anything is published, read and carried cards (each model capped at its badge) must cover at least 95% of today's model badges. The Nov 15 census covered 1,058 of 1,058, while a broken day's sweep slice (9.8% to 23.4% of badges) leaves at most 90.2% covered, or 93.5% if each of its pages still lists one card. It emits inventory and yard metadata only after closing and quality checks. Failed callbacks cannot return terminal completion. Shared durable validation checks previous inventory before reconciliation. Nothing is enabled or published.

Actual receipts and complete offline replay are under `.scratchpad/provider-coverage/nov14-provider-goal/research/mt_wy_id_ut_co/refill-02/`. The read-only soak discards inventory callbacks and retains incomplete status at a request cap:

```sh
bun run soak:sources -- --sources=scotts --cycles=1
```
