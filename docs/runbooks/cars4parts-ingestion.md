# Cars4Parts ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

Cars4Parts publishes the Carz R Us 1 own-yard catalog for two distinct Illinois
locations: 1281 W Cleveland Street, Heyworth, and 614 W. 3Rd Street, Armington.
Native donor-level branch labels bind each vehicle to its yard. Independent
business markers place the branches 27.7 km apart, with no overlap in the
previously qualified 268-entry physical baseline. Footer addresses alone do
not allocate donors.

The complete retained graph has four opening result pages with 20, 20, 20 and
18 leaves. The connector reads the inventory shell, every unique detail and
all four closing pages: 87 responses across 11 serialized checkpoints.
Closing pages must match the opening population and claims. The native random
AJAX cachebuster changes, while the unfiltered request shape remains intact.

The 78 observations reconcile to 71 accepted donors, four required-field or
scope rejects and three explicit retail exclusions. Heyworth has 69 accepted
donors and Armington has two. Required title/model disagreements, conflicting
VIN claims and unresolved donor/retail scope are quarantined. Five valid
rejected VIN claims remain presence evidence, including both contradictory
Aspen VINs. Optional stock conflicts become null. No typo correction, guessed
alias, VIN decoding or arbitrary conflict winner is used.

The source minimum is 24 donors, with per-yard minima of 23 and one. Existing
10% rejection, 25% duplicate and 50% drift limits remain. Standalone connector
callers supply previous complete per-yard counts. Registered durable validation
also compares each yard with its currently persisted, non-missing Cars4Parts
inventory before reconciliation. This conservative baseline is not the exact
previous source census, since reconciliation can give another native source
ownership of a VIN and can preserve rejected identities. Completed snapshots
are cleaned up. A source-wide count cannot override a failed yard check.

Each chunk permits eight requests and three minutes. Requests have a combined
20-second header/body deadline, a 2 MiB body limit, manual redirects and no
automatic retries. The shared serial gate keeps a 1.6-second completion gap
across chunks. Whole runs permit 1,024 requests and 128 MiB, reserving the
maximum next response allowance. Strict checksummed cursors are capped at
8 MiB and bind the exact qualification contract and retained native evidence.
No vehicle batches emit before the complete graph passes validation. Durable
source validation requires an explicit complete cursor.

Saved registered-dispatcher proofs compare all 25 canonical fields of 71 donors
at emission, staging and persistence. They preserve prior metadata for five
rejected VINs, retire an absent seed and replace an AutoRecycler mirror while
keeping its first-seen date. Additional regressions reject an Armington drop
from five to two even when the total count passes, accept the exact 50% boundary
and exclude already-missing rows from the baseline.

Evidence is under `.scratchpad/coverage/parallel-al-ms-la/cars4parts-implementation48/`,
`parallel-il-mo-ks/cars4parts-shared-review10/`,
`parallel-mn-ia-ne-sd/cars4parts-review35/`,
`parallel-wa-or-id/cars4parts-saved-protocol25/` and the AK physical reviews54/55.
Saved closure is not an atomic provider snapshot or proof of remote storage
capacity. Source admission counts exclude artificial prior-preservation seeds.

The source runs unless its pause flag serves false. Qualification was local only. On request, checkpoint,
closure or quality failure, preserve previous inventory and inspect the named
operation. Resume only the last validated cursor under the unchanged contract.
Start a new run after metadata or policy changes. Never force reconciliation
from an incomplete or rejected source.
