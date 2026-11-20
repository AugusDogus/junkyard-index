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
literal make controls. Model pages go through the shared incremental census
(`model-census.ts`): a model page is read when it is new, its badge changed
since the last accepted run, its evidence is six run days old, or it falls in
today's one-sixth sweep slice. Every other model carries its last accepted
page forward at zero request cost, keyed by make path/label and model
path/label. The terminal cursor stores that census; a missing, unreadable or
incompatible one starts a cold census that reads every model. The
`/iislatestarrivals/` page omits about 38% of new donors, so it is not read or
used as a delta. It requests only owned HTTPS
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
run whose card count differs from its badge, so a short page that does not
repeat is never carried forward. A short page that repeats is stored as
confirmed evidence and may be carried. Other per-model changes during a run
surface as badge changes in the next run's opening menus.

Before the snapshot, the union of read and carried cards, each model capped at
its own badge, must cover at least 95% of today's model badges, or nothing is
published. The saved census covers 100% (6,463 of 6,463 badge cards; all 44
mismatched models list surplus cards). One sweep slice of models listing a
single card each drops coverage to 81.9% to 89.9%, while the 1,985 floor
still passes, so this check fails the first broken day.
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

The replay performs 677 mocked GETs across 85 serialized chunks, peaks at an
821,323-byte checkpoint and emits one yard and one terminal batch. All 71,484
oracle field comparisons match, including all 5,957 stocks and 4,588 valid
primary images. The 21 quarantined VINs remain disjoint presence evidence.

```sh
bun test src/server/ingestion/central-*.test.ts
```

`scripts/soak-central.ts` counts and discards output while round-tripping
serialized checkpoints. Its caller owns transport, staging and admission.
