# Al's Auto Salvage

Enabled source `alsauto` adds one independent Wisconsin business in Franklin.
The public [parts inventory](https://www.alsautosalvagewi.com/latest-inventory)
explicitly identifies its donors as dismantled for parts, not complete vehicles
for sale. The owner page publishes the yard's street address and telephone.
Coordinates come from an exact-address Census geocoder match, saved with the fixtures.

## Qualification

The November 17, 2026 full census contains 703 native lots, 694 distinct
check-digit-valid VINs and **693 accepted vehicles**. Eight donors have no VIN,
one trailer has a 16-character VIN, and one motorcycle has the make `OTHER`.
All ten remain required-field rejects. The valid rejected motorcycle VIN remains
observed presence evidence. No valid duplicates were found. Newest accepted
acquisition: **November 6, 2026**. The fixed floor is **231**, one third of 693.
The 10% rejection, 25% duplicate and 50% previous-run drift guards still apply.

The complete read-only connector crawl passed with 693 accepted, ten rejected,
zero duplicates and no errors. Its 62 actual opening/closing bodies and receipts
are committed in `src/server/ingestion/alsauto-test-fixtures/`. The fixture is
compressed without removing native records. No database or index was written.

## Public protocol and budget

The widget's `data-ajax-url` publishes:

```text
https://www.alsautosalvagewi.com/index.php?route=extension/module/als_vehicles_widget/filter&page=1
```

The response is JSON containing the complete widget HTML. Each page publishes
its current page, active vehicle total, literal make directory and next page.
There are 24 cards per nonterminal page. The current inventory has 30 pages.
The ordinary HTML route ignores `?page=2` and repeats page one, so it is never
used to enumerate donors.

A run requests the owner document, all API pages, a second actual traversal of
all API pages, then the owner document again. Every parsed record, record order,
total, make selector and pagination control must match the opening traversal.
Repeated native lots, incomplete pages, changed controls or closing drift stop
the run before either canonical callback. No partial snapshot is published.

Current budget: **62 GETs/run**, 2 owner controls plus 30 opening and 30 closing
API pages. Hard bounds: 40 pages, 960 native rows, **82 GETs/run**, 256 KiB/body,
16 MiB serialized checkpoint, eight requests/chunk and three minutes/chunk.
The HTTP client is serial with 1.8 seconds after each completed request/body,
uses a normal browser User-Agent, rejects redirects and unexpected MIME/status,
and performs no retries. A request/body has a combined 20-second deadline.

Checkpoints bind the evidence prefix, protocol scope and prior count with a
checksum. Resume replays the prefix to derive its next exact native URL.
An accepted snapshot must also contain an acquisition within about 60 days.

## Search and operations

The make directory disambiguates multiword makes. Two native Nissan titles use
`NISS`; that explicit native abbreviation normalizes to Nissan. Models preserve
the native trim wording. Acquisition dates are calendar dates. Native lot numbers
are stock numbers. The provider's published Copart acquisition images are preserved from the matching inventory card. They do not establish the vehicle's current condition. The destination opens manual inventory search by VIN or lot number,
with instructions to confirm availability with Al's.

The source uses the normal default-enabled ingestion flag and durable pipeline.
For a read-only census, use `bun run soak:sources --help` and select `alsauto`.
A capped soak preserves its incomplete checkpoint. A failed native control
preserves prior inventory; inspect the captured response before restarting.
