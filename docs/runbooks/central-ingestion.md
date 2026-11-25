# Central Auto Liquidators

See the current [source flags and census floors](provider-coverage-go-live.md).

Local source `central`, yard `franklin`, supplier `DD15`. Source registration,
durable integration, enablement and admission belong to the parent workflow.
This implementation and its verification make no production writes.

## Published scope and identity

The finite source is every literal make/model control published under
`https://centralautoliq.com/used-parts/`. The saved native graph has 46 makes,
535 model controls and 6,518 raw donor cards. It produces 5,957 eligible unique
candidates, 561 required rejects and zero duplicate extras after all-occurrence
conflict quarantine. Of the rejects, 519 lack a usable native VIN or supported
older serial, and 42 are occurrences across 21 conflicting VIN groups. All
21 valid rejected VINs remain independent presence evidence. Rejection is
8.6069%, within the existing 10% limit. The accepted donor floor is 1,985.

The 2005 Chevrolet Equinox VIN `2CNDL23F556051685` appears at two distinct native
donor destinations, stocks `CA0022` and `CA0004`. Both occurrences are rejected.
There is no preferred destination, inferred stock correction or emitted winner.
All native YMM and destination conflicts are grouped before canonical make
normalization and before callbacks.

The reviewed homepage has no donor cards or published arrival feed. A newly
published homepage donor/arrival surface stops the source for classification.
The hidden `?page_id=639` inventory button is not a browse control. It is not
followed or turned into an invented feed. Native Next/Previous controls bound
to `#apsPartsGalleryCarousel` are photographs, not donor pagination. Numeric
query/path pagination and other unclassified continuation stop enumeration.

Native pages identify Central Auto Liquidators at 245 Davis Road, Franklin,
NJ 07416, phone 973-827-3696. Native alternate 973-827-6457 and fax
973-827-6798 remain separate observations. Native on-site inventory copy,
DD15 catalog declarations and saved DD15 selling-supplier examples establish
the existing own-yard catalog membership contract. Per-donor residence or
part-detail reads are not required. The named-business directory point is
41.1073, -74.61807, accuracy unstated. Saved name/address/slug evidence binds
that point, and independent comparison found zero matches against 261 accepted
physical yards.

## Runtime contract

The connector reads official homepage ownership, the make directory and all
literal make controls. Model pages go through the shared model census;
[model-census.md](model-census.md) states its rules (read reasons, short
pages, closing, coverage floors and seeding). Central reads every model page
on every run (`reuse: "never"`) and carries none forward. It used to carry a
model whose key and badge were unchanged for up to six days, reading only a
sweep slice each day, but a donor crushed and another placed under the same
model keeps the badge, so a carried page could miss both. The census still
supplies read reasons (`cold`, `gap`, `new`, `count`, `short`, otherwise
`daily`), expected cards, closing floors and coverage references. Central
keys each model by make path/label and model path/label. It has no arrival
triggers: the `/iislatestarrivals/` page omits about 38% of new donors, so it
is not read or used as a delta. Its badge floor is 95% (below). Its closing
confirms short pages. Counted from the saved graph, every run is a full read
of about 629 GETs: 583 opening pages (the root, the directory, 46 make menus
and 535 model pages), then closing reads of the root, the make directory and
any of the 44 surplus models that changed. Each short page, and each surplus
model listing less than its sticky surplus or ceiling, adds one closing
re-read. A page read daily that repeats its confirmed evidence is not re-read
(see [Model census](model-census.md)). The census contract is
`DD15/literal-premium-model-graph/all-required-destination-conflicts-quarantined/incremental-model-census-v3`;
a contract change starts a cold census. It requests only owned HTTPS
browse URLs. It does not construct aliases or request donor details, components,
images or forms. All supplier declarations must agree on DD15. Documents must
be complete HTML with the native owner and contact identity. HTTP must be
unredirected 200 `text/html` without partial-content evidence. There are no
automatic retries. The 2 MiB bound applies while streaming, before full-body
materialization. Request and body share a 20-second deadline.
Caller interruption aborts transport and waits for body-reader release. Refused
responses attempt unread-body cancellation. A cleanup failure preserves both
the original HTTP refusal and the cleanup error.

Closing controls repeat ownership, the make directory and every model read this
run whose card count differs from its badge or falls below its expected count
(`ModelCensus.closingReads`). Runs take hours at a yard that adds donors daily,
so a re-read may add cards and change optional stock or photo metadata, but
every first-read card must still be listed with the same VIN, year, title and
destination, or the run fails. A re-read that lists more cards than its badge
is then published as the union of both reads, even when the first read fell
short of the expected count: Central lists cards before its badges count them
(G6 listed 15 cards under a badge of 14), so a surplus stored from one run's
arrivals can count cards the badge has since caught up with. Such a page is
never stored as confirmed and is read as short next run while it lists less
than its expected count. A re-read at or below its badge must repeat exactly, so a
short page is confirmed only by an identical re-read. The make directory must
repeat every make path and label in the same order; a make that appears,
disappears, is relabelled or moves fails the run. Make badges may differ:
`/used-parts/` is served from more than one stale cache version and the yard
adds donors all day, and the November 22, 2026 run failed closing on moved
make badges alone. On November 21, 2026 two runs failed closing on pure arrivals (S10.S15.SONOMA went from 20 to 21 cards
with no VIN removed). A model's
expected count is its badge plus a sticky surplus (44 saved models list
surplus cards): it is lowered only after six run days of lower reads, or twelve when the badge rose by at least the missing cards during that window, which looks like arrival lag; a surplus lowered by time while the page still lists less stays as a ceiling, so closing still re-reads any read below it, see [Incremental model census](model-census.md). A page below its
badge that repeats is stored as confirmed evidence only by a normal
incremental run (not a cold, gap or outage full read). Any other page below its expected count, including a surplus
page that only fell toward its badge, is read as short next run. Other per-model
changes during a run surface as badge changes in the next run's opening menus.

Before the snapshot, the cards read this run, each model capped at its own
badge, must cover at least 95% of today's model badges, or nothing is
published. The saved census covers 100% (6,463 of 6,463 badge cards; all 44
mismatched models list surplus cards). The same cards, against the last
accepted card count of every model with a last accepted page (lowered by any
badge drop), must also cover the shared 97% replay floor while the last
accepted run is under six days old. The replay floor still matters under
daily reads: a model whose badge undercounts its surplus rows can be cut to
one card and keep badge coverage above 95%. A sixth of the models listing a
single card each (measured on the six saved key slices) drops badge coverage
to 81.9% to 89.9% and replay coverage to 81.8% to 89.9% (lightest: 87 models
and 745 cards, at 89.87% badge and 89.90% replay), while the 1,985 floor
still passes, so both checks fail the first broken day. After a missed,
failed or rejected run, the next run reads every model as `gap` and is judged
against the same last accepted census. Once that census is six or more days
old, only the badge floor applies.
Changed closing fingerprints stop emission. These controls do not establish an
atomic snapshot or stability of unrefetched pages. All old badge differences
remain diagnostics; the actual classified cards supply the quality denominator.
An empty model without a qualified native empty-result contract stops parsing.

Chunks allow one to eight serial native GETs under a three-minute deadline.
The default transport waits 1.6 seconds after complete body consumption on
success and failure, including across serialized chunks. The full-run request
ceiling is 1,600. Bounds are 64 makes, 128 models per make, 1,024 total models,
1,000 cards per model, 20,000 raw cards and a 4 MiB cursor. These source bounds
accommodate the measured graph and preserve prior inventory on excess.

`CentralCursor.initial`, `.parse` and `.serialize` validate source-tagged,
checksummed contiguous traversal prefixes. The wire bound applies before JSON
parsing. Cursors contain native compact tuples, controls and fingerprints,
without HTML or canonical vehicle arrays. Checksums detect corruption, not
malicious modification. Paused chunks emit no inventory, accounting or VIN
presence. Completion emits disjoint accounting and independent rejected VIN
presence. Callback failure never returns a completed checkpoint.

Required fields are native VIN or supported older serial, native year, explicit
native make/model and an owned year-bound donor destination. The published make
label delimits the supplied card title. LAND ROVER and SMART make-as-model
values require their real published model controls. Route tokens never fill
missing YMM. The Town & Country model directory and donor route have different
native spellings; a literal owned breadcrumb binds the model, and the card
supplies the explicit title. Both route spellings remain literal.

Stock and primary image are optional. Numeric HTML entities, including the
native `J&#038;V` stock/destination, decode without route inference. Stock binds
the native destination. Photos must bind that usable stock under the DD15
CloudFront image prefix. The primary `img.aps-la-img-premium` is a sibling of
the donor anchor; hidden galleries are not primary image assertions. Missing,
unusable or conflicting optional values become null. The saved cards supply
no dates, color or yard positions, so these remain null. Optional absence never
rejects required identity. The existing 25% duplicate and downstream 50% drift
guards remain in force.

## Saved evidence and checks

The original census and immutable history are under
`.scratchpad/coverage/parallel-mn-ia-ne-sd/central-nj-native-discovery01/recovery01/`.
`phase-b-successor02/report.json` preserves the earlier benign-duplicate
classification. It is not rewritten. The later destination-conflict correction
is recorded independently in
`parallel-mt-wy-nd/central-nj-terminal-review01/`, including the corrected native
candidate oracle SHA-256
`70aa1e595cb955481cd413c21d5dba4fd6ebc3509e36dc0c8be1da9494fa874f`.
Source and physical qualification are in
`parallel-az-nm-nv/central-nj-source-physical261-review01/`.

Application replay evidence is in
`parallel-mn-ia-ne-sd/central-implementation01/`. The real parser, connector,
client body reader, cursor serialization and soak helper replay all 583 pinned
opening bodies. Closing responses reuse saved opening captures. This verifies
local behavior and does not claim a new live closing census. All candidate
VIN/year/make/model/destination, stock, primary image and nullable optional
fields are compared against the independent native oracle. No provider HTTP
is issued by the replay.

This replay predates the incremental census. Its request and checkpoint
figures are historical: it performed 677 mocked GETs across 85 serialized
chunks, peaked at an 821,323-byte checkpoint and emitted one yard and one
terminal batch. Current cursors also hold the last accepted census. All 71,484
oracle field comparisons match, including all 5,957 stocks and 4,588 valid
primary images. The 21 quarantined VINs remain disjoint presence evidence.

```sh
bun test src/server/ingestion/central-*.test.ts
```

`scripts/soak-central.ts` counts and discards output while round-tripping
serialized checkpoints. Its caller owns transport, staging and admission.
