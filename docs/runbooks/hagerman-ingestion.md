# Hagerman

The default-off `hagerman` source covers Hagerman, Inc.'s own Dismantled Vehicles inventory at 82891 Bud Draper Road, Umatilla OR 97882. The native operator identifies its independent family ownership and two locations. All five qualified donors bind supplier 1125862/store 1 to Umatilla. Salem and the separate 22 retail trucks add no inventory or provider credit.

The November 15, 2026 UTC census contains five native donor destinations. All primary details have literal VIN and year/make/model, with zero rejects or duplicates. The terminal category and operator closing responses match their opening bytes. Inventory, yard callbacks and accounting wait until complete detail, quality and closing proof.

The shared source floor is five donors. Existing rejection, duplicate and previous-count guards apply. Valid identities in rejected rows remain presence evidence. Individual native donor URLs remain search and alert destinations; optional metadata stays nullable.

Durable chunks allow twelve serial GETs. One module-wide gate holds through the complete request, body and transport cleanup, then a 2.5-second completed gap, including failures. Requests have a combined 20-second deadline, a 2 MiB body limit, manual redirects and zero retries. Chunks have a 90-second deadline; a run has one hour and 64 MiB. Shared wire checkpoints are bounded to 2 MiB. Failures preserve prior inventory and the last validated checkpoint.

This collector supports the published terminal single page, up to its 25-row page size. Growth into pagination fails closed until the new traversal is qualified.

The Umatilla point, 45.919115087534, -119.276244647724, is independent Census exact-address street-range interpolation (82899 through 82891), not rooftop or parcel precision.

Evidence is in `.scratchpad/provider-coverage/nov14-provider-goal/research/ak_hi/pacific-refill07/`. Root verification replays all nine dated responses through shared cursor codecs and source validation without live HTTP. See `hagerman-root-verification.json` in the goal directory.

The read-only soak counts and discards inventory:

```sh
bun run soak:sources -- --sources=hagerman --cycles=1
```
