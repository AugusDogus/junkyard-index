# Speedys donor inventory

Source `speedys` reads the source-owned PARTING OUT catalog at
`https://parts.speedysgroup.com/partingout/`. The source remains disabled by
default. This leaf does not admit a yard or change source flags.

The native catalog and donor address identify Speedy's Transmission at
5300 Midlothian Turnpike, Richmond, VA 23225. The exact named Google business
point `ChIJLdNenW8TsYkRiDiqH2AIVPA` supplies latitude
`37.507737999999996`, longitude `-77.4950018`. The catalog phone
`804-999-1845` differs from the Maps phone. The catalog phone is retained.
AL93's native address/owned-host join and root's saved Maps result supply
provenance; no coordinates are inferred from the donor VIN or a map viewport.

## Completeness contract

Each run reads the default listing, its literal ALL control, and every
published make-category control. It validates the complete make directory,
counts, exact category union and donor identity membership. Donors and category
IDs are enumerated dynamically. The captured donor ID `1` is not a hardcoded
inventory universe.

The leaf currently supports complete unpaginated server HTML. A nonempty
native pagination control, HTTP pagination relation, unknown filter, extra
scope link, changed category count or unsupported destination fails the run
before completion. Inspect a saved complete response and extend the contract
before handling a new pagination mechanism. Do not treat the first page as a
complete census.

After reading each enumerated donor detail, the connector rereads every catalog
control and every donor detail. All opening and closing rosters, labels, counts,
native inventory joins and required identity claims must agree. Nothing is
emitted before these checks pass. Cosmetic asset query changes and unrelated
optional gallery changes are outside required identity comparison.

## Identity and optional fields

The card and primary detail headings both assert native year, make and model.
The literal detail VIN supplies identity. The native `Inventory #` label must
join the enumerated donor ID and supplies the stock number. Missing or
conflicting required claims reject the donor. Blank auxiliary Manufacturer and
Model labels do not erase usable headings. Nonempty contradictory auxiliary
claims remain rejection evidence. No NHTSA lookup, VIN inference or VIN repair
is performed.

The saved detail contains 1,640 gallery URLs across 504 other filename prefixes,
with no safe join to this donor. `imageUrl` is therefore null. Those gallery
prefixes do not establish more donors. Displacement `2.5` has no published units
and is not converted into an invented engine description. Other absent optional
vehicle fields stay null. Required-field and duplicate limits remain 10% and
25%, respectively.

## Durable execution

`streamSpeedysInventoryWithRequestGate(options, gate)` accepts the shared HTTP
gate. `streamSpeedysInventory(options)` creates a serial 1.6-second limiter.
`maxPages` is a serial GET-unit budget, default 8 and bounded from 1 to 32.
The current single-donor census needs eight units: default, ALL, Nissan, donor,
then the same four closing controls.

`SpeedysCursor` exposes `initial`, `checkpoint`, `parse` and `serialize`.
Strict versioned checkpoints retain native control and detail prefixes, response
hashes/bytes and a checksum bound to the metadata and parsing contract. The
checksum detects corruption, not malicious authentication. Every checkpoint
revalidates the full trusted prefix, category counts, donor order, closure and
quality. Limits are 256 donors, 32 categories, 2 MiB per complete response,
128 MiB per run, 1 MiB per serialized cursor and one hour per run. Capacity
changes require explicit contract review.

HTTP reads require complete, unredirected HTTP 200 HTML, a bounded full body,
and no range or pagination headers. Requests do not retry automatically. A
failed read, parse, closure or callback returns no advanced checkpoint. Existing
published inventory remains preserved by the parent orchestrator.

## Saved validation

`speedys-test-fixtures/` retains AL93 native default, ALL, Nissan and detail
responses, plus the closing ALL and detail. `provenance.json` pins exact native
body bytes. The leaf tests use saved responses only:

```sh
bun test src/server/ingestion/speedys-*.test.ts
bun run typecheck
```

Tests cover blank auxiliary labels, true required-claim conflicts, invalid VINs,
non-default donor IDs, strict cursor resumes, malformed or skipped prefixes,
unsupported filters/pagination, incomplete HTTP scope, closing drift and failed
callbacks.

Local admission on 2026-11-13 passed the actual durable dispatcher, source
validation, commit claim and reconciliation in an in-memory database. The
independent helper and root's unchanged rerun matched all 25 canonical fields
at emission, staging and persistence. Four serialized two-request chunks
completed the eight-request traversal and accepted one donor. Native ownership
replaced a seeded AutoRecycler mirror while retaining its first-seen date.
Five failure controls preserved prior inventory, including unsupported paging,
incomplete completion evidence, identity drift and the existing count-drift gate.

The saved application replay reuses the opening default/category bodies for
their closing reads. ALL and donor detail use independent closing captures.
This proves application behavior on saved responses, not a fresh live crawl.
Evidence is in `.scratchpad/coverage/parent-speedys-independent01/`, with the
admission receipt at `.scratchpad/coverage/speedys-local-admission.json`.
All 3,502 tests, lint, typecheck and scoped formatting passed. This admission
adds one local Virginia yard; the source remains disabled by default.
