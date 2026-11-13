# Pratt's Auto Salvage ingestion

Pratt's Auto Salvage is one full-service donor yard at 170 Industrial Dr,
Hoxie, Arkansas 72433. Native AR18 inventory, the published address and embedded
business feature bind the catalog to the independently verified business point.
Its identity and coordinates have no overlap in the saved 267-site baseline.
The native phone is 800-348-6680. Different directory phone values remain
documented in the physical review rather than silently substituted.

The connector follows the native root, latest arrivals, make directory,
47 make controls and all 468 published model controls. The complete retained
model/arrival union contains 6,589 observations: 5,931 accepted unique donors,
603 required rejects and 55 benign duplicates. The rejects include 546 intrinsic
identity failures and 57 observations across 27 conflicting VIN groups.
All 27 rejected valid VINs remain presence evidence for reconciliation.
One donor appears only in arrivals. Native badges are diagnostic and do not
replace enumeration of the published graph.

Native VIN or supported older serial, year, make/model and owned destination
are required. Native title, inquiry and literal published parent/leaf controls
must agree. Conflicting VIN/destination observations are quarantined together.
Stock, photos and dates are optional; conflicting optional values become null.
No VIN decoding, guessed aliases or image-prefix ownership inference is used.

The source minimum is 5,000 unique donors. Existing 10% rejection, 25% duplicate
and 50% previous-inventory drift limits remain. The connector stages the entire
graph and emits only after complete-source validation. Durable validation also
requires an explicit complete cursor. Initial and tampered cursors cannot
authorize reconciliation.

Each chunk permits at most eight requests and three minutes. Requests use a
combined 20-second request/body deadline, complete owned HTTP 200 HTML, a 2 MiB
body limit, manual redirects and no automatic retries. A shared serial gate
preserves a 1.6-second completion gap across chunks. Whole runs permit at most
1,024 requests and 128 MiB, reserving one maximum-sized document before each
request. Validated serialized cursors are capped at 8 MiB and bind the exact
qualification contract, native control prefix and retained evidence.

The independent saved replay used 518 responses and 65 serialized chunks.
All 25 fields of 5,931 vehicles match the independent native reference in
emitted batches, staged snapshots and reconciled in-memory database rows.
The proof preserves prior metadata for 27 rejected VINs, retires an absent
seed and replaces an AutoRecycler mirror while preserving its first-seen time.
The saved documents were collected at different times. This does not establish
an atomic provider snapshot or production storage capacity.

Receipts are under `.scratchpad/coverage/parent-pratt-final01/`,
`parallel-al-ms-la/pratt-implementation44/`,
`parallel-il-mo-ks/pratt-independent-review01/`,
`parallel-ut-co-ok/pratt-native-canonical25-oracle20/` and
`parallel-ak-hi/pratt-physical267-review47/`.

The source stays disabled by default and all work stays local. No production
write, deployment or source enablement is authorized. On a failed request or
invalid checkpoint, preserve prior inventory and inspect the named operation.
Resume only the last validated checkpoint under the unchanged contract.
Start a new run after a policy or metadata change. Never force reconciliation
from an incomplete or rejected run.
