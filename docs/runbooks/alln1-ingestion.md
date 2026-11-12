# All-N-1 Auto Parts ingestion

Status on November 12, 2026: saved-only production connector replays accept
1,093 unique vehicles from 1,158 native rows, with 65 rejected and zero
duplicates. Budgets 1, 2, 3 and 32 produce identical canonical output through
the actual shared durable cursor codec. No production inventory was written;
the source remains disabled by default.

The source is `alln1`, yard `MO42`, All-N-1 U Pull & Metals Recycling,
operated by All-N-1 Auto Parts at 2408 Blue Ridge Blvd, Kansas City MO 64129,
phone 816-252-3930. The official [root](https://alln1kc.com/) publishes the
matching address, phone and self-service junkyard description. Native inventory
pages publish `var iisupullurgid = 'MO42';` in an inline script.
Scope requires the complete native flat block of quoted variable declarations
in an executable inline JavaScript element. Comments, quoted source text,
deferred function bodies, external fallback text, inert script types and inert
HTML containers cannot supply that proof.

Coordinates 39.07918, -94.471004 come from the separately labelled UPullScan
exact-address LocalBusiness point saved at
`.scratchpad/coverage/new-leads/priority2-profile-all-n-1-auto-parts-kansas-city-mo.html`.
The native map publishes a viewport center rather than a separately verified
rooftop marker. The directory point must retain its third-party provenance.

## Native traversal and destinations

The unfiltered native first page is
`https://alln1kc.com/inventory/ANY/ANY/?k=1&view=table`.
The connector follows the actual same-origin Next link, adding `&pagenum=2`
and `&pagenum=3` in the saved source. It never adds a Midway `id=MO42`
selector. Every page must publish the exact nine columns Image, Year, Make,
Model, Row, Date, Vin, Stock # and Fresh Set. Each donor has one image `th`
followed by eight `td` cells.

Both native pagination controls must agree on a complete sequential numbered
directory, one active page, exact Previous/Next targets and terminal absence
of Next. Nonterminal pages contain exactly 500 rows. The source is bounded to
20 pages and 10,000 rows. The native inventory statement, inline yard scope,
unfiltered GET form and table configuration must remain verified. Empty,
truncated, duplicate, malformed, filtered or foreign continuations block the
snapshot. Complete trailing CMS cache comments after `</html>` are accepted.

The saved traversal has 500, 500 and 158 rows. Canonical `detailsUrl` uses
the native GET search form with `k=1`, `view=table` and
`search=<validated native VIN or supported serial>`. The exact published
control was verified with
`https://alln1kc.com/inventory/ANY/ANY/?k=1&view=table&search=2GNALCEK8F6347168`.
Other donor destinations follow that same form contract without individual
requests, image requests, login, cart or inquiry submission.

## Identity, availability and optional metadata

Admission requires a native modern VIN or supported pre-1981 serial and
usable native year, make and model under the shared `inventoryVin` contract.
Two supported legacy serials survive in the saved source. Native model labels
remain complete, including labels such as `FORD F150 PICKUP`; no VIN-derived
year or guessed model correction is substituted.

Literal row positions `HOLD`, `YARD VAN` and `REBUILDER` have unproven donor
availability. The connector quarantines them without assigning native status
meanings. All 50 HOLD, three YARD VAN and four REBUILDER rows count toward
rejection, together with eight invalid required identities. Their 57 valid
identities remain presence-only evidence, preserving known inventory during
reconciliation. None are ordinary outside-scope exclusions.

Color is absent and remains null. Missing or unusable stock, row, source date
or photo becomes null without rejecting an otherwise valid donor. Genuine
stock and row values remain native, including internal row spacing such as
`V V-11`. The source's seven-digit stock `2692320` belongs to a quarantined
HOLD row and remains unchanged in evidence and checkpoints. It is not
truncated or repaired.

Valid source dates remain exact calendar strings such as `2026-11-04`.
No source timezone or UTC instant is inferred. Invalid calendar dates become
null. Fresh Set is retained in the native record fingerprint and does not
replace the published Date field.

Photos survive only when one native main image and its anchor publish the
same HTTPS URL at `da8h1v3w8q6n5.cloudfront.net`, with both path stock values
matching that donor's native stock under
`/mo42/images/<stock>/<stock>_<digits>.jpg`. Placeholders, mismatched or
malformed media become null. Published `_0.jpg` references remain source
references without guessed placeholder semantics. Current table media wins
over older grid evidence. Accepted output contains 654 photo references and
439 null photos. No image bytes are fetched.

## Checkpoints, quality and recovery

The strict cursor phases are `start`, `pages` and `complete`. A paused cursor
stores owner/scope and first-page anchor hashes, last/next page, exact Next
URL, sequential per-page receipts and cumulative available, incomplete or
quarantined donor states. Each state retains its native record fingerprint,
usable stock, valid identity or presence, first page and ambiguous position
where applicable. A checksum binds every resume-relevant field and is
validated before HTTP, alongside accounting and unique stock/identity guards.
This detects corruption in trusted internal durable state; it is not
authentication against coordinated arbitrary cursor rewrites.

Every chunk opens the official root and first-page inventory anchor. Resumes
must match the prior owner, scope, anchor and page directory. Terminal
completion rereads the root and first page. All chunk validation finishes
before callbacks. Callback failure returns no advanced checkpoint; a complete
cursor makes no requests or callbacks. The default chunk has three pages,
and connector budgets range from 1 through 32.

The unchanged 10% rejection cap applies to the complete yard, not a partial
page or checkpoint. Page one legitimately pauses at 58 rejected of 500 rows
(11.6%). Complete accounting is 1,158 processed, zero excluded, 65 rejected
(5.61%), zero duplicates and 1,093 accepted. Shared admission requires at
least 900 accepted unique donors and retains the 50% prior-count drift limit
and duplicate/reconciliation guards. Partial or failed snapshots cannot
reconcile inventory.

Requests use the shared 1.6-second gate, no retries, 25-second request/body
limits and a three-minute chunk deadline. Only complete unredirected HTTP 200
`text/html` from the verified destination is accepted. Partial ranges, length
mismatches, invalid UTF-8 and bodies over 4 MiB fail closed. Preserve prior
accepted inventory on failure, inspect native ownership, scope and pagination,
then retry from the last validated checkpoint. A changed anchor requires a
fresh complete crawl.

The native source exposes no transaction token or independent total count.
Complete ordered continuation, first-page anchors and duplicate guards cannot
prove atomicity against every interior-only concurrent edit. These limits
remain explicit when interpreting a completed snapshot.

`scripts/soak-alln1.ts` is a count-and-discard driver. The caller supplies the
connector and callbacks; it does not write inventory. Its total page budget is
1 through 20. Production enablement is a separate decision.

## Saved verification

Native table pages, receipts, verified VIN search, donor outcomes and metadata
are under `.scratchpad/coverage/parallel-al-ms-la/alln1-requalification/`.
The independent source review is
`.scratchpad/coverage/parallel-mn-ia-ne-sd/alln1-source-review/final-source-review.json`.
The frozen independent canonical oracle and 57 presence identities are under
`.scratchpad/coverage/parallel-mn-ia-ne-sd/alln1-code-review/`.

The saved-only replay driver is
`.scratchpad/coverage/parallel-az-nm-nv/alln1-plan/replay-alln1.ts`.
It refuses unsaved requests and round-trips every chunk through
`serializeDurableSourceCursor` and `parseDurableSourceCursor`. Reports,
canonical output, input hashes and largest serialized checkpoints are in its
`evidence/` directory. Budgets 1, 2, 3 and 32 use 10, eight, six and six
cached calls, with zero live calls, photo calls or production writes. The
largest paused serialized checkpoint is 155,548 bytes.

Every replay matches the independent oracle on all canonical fields and all
57 presence identities. Canonical SHA-256 is
`a6e7693dd9427b062cd3c20a31696d30d7e2d8ef0467dbaab2e4d8cb51c75c64`.
Independent canonical and physical-overlap verification is recorded in
`.scratchpad/coverage/parallel-ky-tn-ar/evidence/alln1-overlap-verification.json`.
Saved opening and closing reads reuse captured bodies; focused negative
controls separately exercise scope drift, corruption and callback failure.
