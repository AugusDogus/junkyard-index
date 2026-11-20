# Scott's Used Parts

See the current [source flags and census floors](provider-coverage-go-live.md).

The `scotts` source covers Scott's Used Parts / Scott's Auto Recyclers at 938 West Willox Lane, Fort Collins CO 80524. Native contact and operational pages, CC68 donor photos and VIN-matching component destinations bind the catalog to this Colorado provider. An unrelated Mark's template footer is retained in evidence. Wyoming delivery marketing adds no state credit.

The November 15 UTC census follows all 34 makes and 221 model controls: 1,064 cards, 976 accepted donors, 88 required rejects and zero duplicates or identity conflicts. Badges total 1,058. The six differing model memberships stayed unchanged on closing. That run used the historical closing design: 44 closing controls covering ownership, makes, every model directory, first/last model memberships and all six discrepancies. Current closing is described below. The historical arrivals timeout remains unresolved and was never retried. Qualification covers the independently published make/model catalog.

Required fields use existing VIN/serial and year/make/model validation. Optional stock, images, color, dates and position remain nullable. Valid rejected identities remain presence evidence, and required identity/destination conflicts are quarantined. Shared validation retains the 325-donor minimum, 10% rejection, 25% duplicate and 50% previous-count drift guards.

The collector uses serial requests with five-second completed spacing, no retries, six GETs per chunk, a three-minute chunk deadline and a 2 MiB serialized checkpoint bound. It emits inventory and yard metadata only after closing and quality checks. Failed callbacks cannot return terminal completion. Shared durable validation checks previous inventory before reconciliation. Nothing is enabled or published.

Model pages follow the shared [incremental model census](model-census.md) (contract `incremental-model-census-v3`): gap full reads, short-page confirmation, the badge floor plus the 97% replay floor against every model's last accepted page, the six-day outage path and seeding from the newest accepted publication. Scott's specifics:

- No model is triggered by arrivals, because the arrivals route times out.
- Closing repeats ownership, the make directory and every model read this run whose cards differ from its badge or fall below its expected cards, and fails the run on any change. Short pages are therefore confirmed at closing. A page that keeps its NOF placeholder but loses a donor still falls below its expected cards, so it is re-read at closing and again on the next run instead of being carried. Carried models are not re-read.
- The badge floor is 95%. The Nov 15 census covered 1,058 of 1,058 badges and the four pages re-read on Nov 19 matched their new badges, so the 5% margin (about 53 cards) far exceeds the observed 0.8 card changes a day. The smallest sweep slice holds 9.8% of badges (35 models, 104 badges): breaking it leaves at most 90.2% covered, or 93.5% if each of its pages still lists one card. Against the 1,064 Nov 15 cards that cut leaves 93.4%, below the replay floor too.

Actual receipts and complete offline replay are under `.scratchpad/provider-coverage/nov14-provider-goal/research/mt_wy_id_ut_co/refill-02/`. The read-only soak discards inventory callbacks and retains incomplete status at a request cap:

```sh
bun run soak:sources -- --sources=scotts --cycles=1
```
