# Denton Auto Parts

See the current [source flags and census floors](provider-coverage-go-live.md).

The `denton` source covers one Kansas provider family, Denton and its Autoland alias. Native ownership and contact documents bind all inventory to 14580 South Topeka Ave, Carbondale KS 66414, supplier KS12. Coordinates come from the named native contact-map embed.

The November 15 UTC qualification combines 377 opening GETs with 377 separately dated closing GETs. All 338 logical controls close, including every make, model and arrivals page. The complete union has 2,382 observations: 2,297 accepted donors, 83 rejects or quarantines and two duplicates. Small badge discrepancies remained diagnostics. Published membership, donor fields and supplier ownership must reconcile.

The preserved AD80068 destination failure remains quarantined and was never retried. Its valid VIN and both conflicting VIN groups remain presence evidence, protecting prior records during reconciliation. Missing optional metadata remains null. The source retains the 10% rejection, 25% duplicate, 50% previous-count and 765-donor minimum guards. They run over read and carried pages, so carried pages can keep them satisfied while live model pages break. The read plus carried model cards, each model counted only up to its own badge, must therefore cover at least 95% of the opening model badge sum, or the run stages nothing and keeps the last accepted census. The qualification graph covered 99.5% (no page exceeded its badge), and emptying any one of its six sweep slices drops coverage to between 77% and 87%, so one broken day fails.

Each run reads the about, contact and make directory pages, every make menu at its slash URL (one GET instead of the native 301 plus 200), and the arrivals page. It then reads a model page only when the model is new, its menu badge changed, an arrival under it is missing from its carried page, its evidence is six run days old, or it falls in that day's one-sixth sweep slice. Every other model carries its last accepted page. Closing re-reads about, contact, the make directory and every model read this run whose card count differs from its badge, and stops the run if any of them changed, so a short page that does not repeat is never carried forward, and a short page from a census without that confirmation is read again. Carried models are not re-read; other per-model changes during a run surface as badge changes in the next run's opening. A missing, unreadable or incompatible previous census reads every model page. A normal day is about 110 GETs; a cold census is about 341.

Durable traversal still handles any other explicit slash redirect as a separate physical request, with eight GETs per chunk, a 20-second request deadline, a three-minute chunk deadline and a 16 MiB serialized checkpoint bound. It stages vehicles and the yard only after complete closing and quality checks over the union of read and carried pages. Failed callbacks cannot return terminal proof. Durable validation checks prior published counts before reconciliation. The source runs unless its pause flag serves false.

Actual response receipts, the genuine closing proof and the separately labeled offline replay are under `.scratchpad/provider-coverage/nov14-provider-goal/research/ks_ok_nm_tx/`. Shared checks are recorded in `denton-sg-application-tests.log` at the goal evidence root. A read-only census is available without publication:

```sh
bun run soak:sources -- --sources=denton --cycles=1
```
