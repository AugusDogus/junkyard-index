# BigTruckPage ingestion

The local source covers Misiuk Motors LLC at 101 E Monticello ST, Strafford
MO 65757, phone 5037805340. The native seller profile establishes ownership.
An independent exact business, address and phone Google Maps match supplies
the point 37.2761689, -93.1189117. The source defaults disabled.

## Inventory and identity

Only the seller's `dismantling-trucks` catalog is ingested. Retail trucks and
individual parts are outside this source. Every donor card must bind both its
literal donor URL and the trusted seller. The native search and VIN filters
must be empty, and the make and model filters must both be `ALL`.

The final saved census has 50 donors across three pages of 20, 20 and ten.
Forty-eight satisfy required identity. Two have conflicting native titles and
are rejected by a general consistency rule, with their valid observed VINs
retained for reconciliation. There are no duplicate VINs or donor URLs.
The earlier 49-row catalog remains separate historical evidence.

Year, make, model and VIN come from native cards. React text-node boundaries
separate multiword makes from models. No VIN enrichment or rewriting is used.
A stale URL slug does not override matching primary identity and native image
titles. The exact original donor URL is retained for the outgoing car link.
Color, stock, photographs, inventory date and position are optional. Listing
IDs do not become stock numbers. Unsafe optional image URLs become null.

## Checkpoints and recovery

The first request verifies the full trusted seller name, address, phone and
catalog link. The connector then opens every catalog page and rereads every
page in order. Opening and closing bodies must match byte for byte. Native
counts, contiguous pagination, unique donor URLs and unique valid VINs are
checked before the complete cursor can be returned.

Durable chunks contain two request units. Cursor phases are `profile`,
`catalog`, `verify` and `complete`. Batches stage during opening traversal;
only explicit complete status permits source validation and reconciliation.
The accepted minimum is 40 donors. Existing 10% rejection, 25% duplicate and
50% previous-run retention limits remain unchanged.

Requests use a 1.6-second pacing interval, a 25-second timeout and bounded
response reading, with no automatic redirects or retries. Each chunk has a
two-minute timeout. A changed closing page blocks completion. Preserve prior
published inventory and inspect the saved failure before restarting a fresh
census. Resume only a validated unchanged checkpoint.

## Evidence

- Native capture: `.scratchpad/coverage/parallel-il-mo-ks/mo-specialty-rv56/capture-manifest-final.json`.
- Independent source and physical review: `.scratchpad/coverage/parallel-pa-md-wv/misiuk-source-review67/report.json`.
- Independent canonical reference: `.scratchpad/coverage/parallel-ny-nj-de/misiuk-canonical45/closing-oracle/canonical-reference.json`.
- Actual application replay: `.scratchpad/coverage/parent-bigtruckpage-local01/replay.ts`.
- Independent unchanged replay and admission authority: `.scratchpad/coverage/parent-bigtruckpage-independent01/application-validation.json` and `.scratchpad/coverage/bigtruckpage-local-admission.json`.

Run `bun test src/server/ingestion/bigtruckpage-*.test.ts` and the shared
durable-source, source-validation, default-off and reconciliation tests after
changes. The application proof uses saved responses and in-memory libSQL,
refuses unmatched requests and preconnects, compares all 25 canonical fields,
and exercises actual source validation, commit claiming and reconciliation.
Seed records test rejected-VIN metadata preservation, absent-donor retirement
and replacement of an AutoRecycler mirror. Seeds do not add admission credit.

The final independent replay passes seven saved requests in four serialized
chunks, 3,600 field comparisons, all three negative terminal/minimum/drift
controls and actual reconciliation. All 3,471 tests across 336 files pass,
alongside lint, typecheck and scoped formatting. The admitted local count is
48 donors at one physical yard. The two prior rejected-VIN seeds remain
separate from that count.

Saved-response and in-memory proofs do not establish a fresh live census or
hosted database behavior. Deployment and production enablement remain outside
this local work.
