# Jim's Import Auto Salvage

See the current [source flags and census floors](provider-coverage-go-live.md).

The `jimsimport` source covers Jim's Import Auto Salvage, 3636 DeSoto Rd, Sebring FL 33870, native supplier NN38. Its dismantling area and own inventory are published by the operator. Domestic partner Jim's Auto Salvage belongs to the same canonical family and adds no separate Florida credit.

The November 15, 2026 UTC opening and independently dated closing traverse all 33 makes and 334 model leaves. All 4,016 raw cards reconcile: 3,649 accepted donors, 367 rejects, zero exclusions and duplicates. The 9.1384% rejection rate includes 355 missing or invalid identities and 12 rows in six connected identity-conflict groups. All 3,655 valid observed identities protect presence. The supported 1980 Mercedes serial remains accepted. Native badge totals are diagnostic, as in the Pratt collector; all published controls and raw cards remain accounted for.

The collector emits one validated batch and one yard after complete closing. Each checkpoint validates native membership, required identities, YMM, stock-bound destinations, ownership and whole-run limits. Closing re-reads the make directory, every model page read this run whose card count differs from its badge or falls below its expected count (its badge, or its last accepted card count when that was higher and the badge is unchanged), and the owner page; model pages carried from the last accepted census are not re-read. A page below its badge is carried only after its closing re-read confirmed it; a page that only fell below a higher last accepted card count is never confirmed, and the next run reads it again. Before closing, read and carried cards, each model capped at its badge, must cover at least 95% of today's model badges (99.97% on the November 15 census), and cards of models whose badge is unchanged must cover at least 97% of their last accepted cards, or the run fails with nothing published. On the November 15 census a sweep slice cut to one card per model leaves at most 88.1% badge coverage and 88.1% replay coverage (lightest slice, 54 models); an empty slice leaves at most 86.7%. Required opening/closing drift stops before callbacks. Optional images may change to null; 2,055 source-bound photos survived this census. A terminal resume emits nothing. Shared source validation enforces the 1,216-donor floor and existing rejection, duplicate and previous-count guards. Search and alerts use individual native donor URLs.

Chunks allow eight serial GETs and have a three-minute deadline. One module-wide gate holds through request, body and actual transport cleanup plus a completed 2.5-second gap, including failures. Requests have a combined 20-second deadline, a 2 MiB body limit, manual redirects and zero retries. Whole-run limits are 1,024 GETs and 128 MiB. Validated serialized checkpoints are bounded to 8 MiB. Failures preserve prior inventory and the last validated checkpoint.

The Sebring point, 27.471305405823, -81.429188442867, is independent Census exact-address street-range interpolation (3600 through 3698), without rooftop or parcel precision.

Evidence is in `.scratchpad/provider-coverage/nov14-provider-goal/research/ga_fl_al/refill05/`. Root independently replayed all 738 saved response bodies through the production client, module-wide gate, shared durable dispatcher and checked codecs in 93 chunks. Only completed gap sleeps were virtualized for the offline replay; no live HTTP ran. See `jimsimport-root-verification.json` in the goal directory.

The read-only soak counts and discards inventory:

```sh
bun run soak:sources -- --sources=jimsimport --cycles=1
```
