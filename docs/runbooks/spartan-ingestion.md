# Spartan Auto & Heavy Truck Parts inventory

`spartan` runs by default and adds the physical Inman SC yard at 1555 Bishop
Rd, Inman SC 29349, 864-529-9400. The native catalog's Google business marker
supplies `(35.0532148, -82.0641628)`. Its November 17, 2026 complete census has
981 donors: 945 autos and 36 trucks. The existing identity and quality checks
accept 969, reject 12, observe 975 alphabet-valid identities and find no
duplicates. The source and yard floor is 323, one third of accepted inventory.
Serving false from `ingestion-source-spartan` pauses the source. No production
flag was created or changed.

The native [auto catalog](https://www.spartanauto.parts/auto-catalog) and
[truck catalog](https://www.spartanauto.parts/truck-catalog) expose the public
JSON base `https://api.spartanauto.parts/api` in their Next.js scripts. Read
`/vehicles?type=auto&page=N` and `/vehicles?type=truck&page=N`, twelve donors per
page. Both partitions are required. The accepted capture has 79 auto pages
and three truck pages in each independent pass. The API's pagination links
omit `type`; the connector reconstructs the typed query from validated page
metadata instead of following those links.

A run makes **166 GETs** at this census: opening owner, all 82 opening API
pages, all 82 closing API pages, closing owner. No donor-detail or photo crawl
is needed at runtime. Details are native `/<type>-catalog/<id>` destinations;
saved auto and truck details independently establish VIN and parts-donor
semantics. Each complete opening/closing pass must have identical typed donor
claims before anything publishes. Every page must establish its offset, total,
size and partition. Repeated IDs, missing pages, inconsistent totals and schema
drift fail closed. Checkpoints retain only the typed public donor fields,
including at most the first image. Description and unrelated feed fields do
not enter durable state. The cursor limits each partition to 200 pages and
serialized state to 2 MiB. Source growth beyond these bounds needs requalification.

The newest auto's native image returned HTTP 200 with Last-Modified
`Fri, 16 Oct 2026 16:21:06 GMT`, within about 60 days of qualification. Its
stock `1026-05` agrees with October publication. This is evidence of recent
vehicle publication, not a documented arrival date. `availableDate` stays null.
All accepted VINs pass the existing check-digit validation. Optional fields
remain optional. No vPIC decoding is needed.

The connector reuses the shared Shopify reader and donor-quality snapshot,
whose transport and identity checks are platform-independent. It uses exact
allowlisted URLs, a normal browser User-Agent, serial requests, a twelve-second
completion gap, manual redirects, bounded bodies and typed failures. Four
GETs fit each durable chunk; both censuses must finish within two hours.
An expired or changed census preserves prior inventory and requires a restart.
Rejection, duplicate, floor and 50% previous-run drift guards are unchanged.

Exact bodies and SHA-256 receipts for both passes, both owner checks and two
native details are in `spartan-test-fixtures/`. The photo HEAD receipt is saved
separately. The qualification crawl also read an intermediate owner page before
the closing census; the committed closing-owner receipt was fetched after its
last API page. These discovery requests are additional to the runtime budget.

```sh
bun test src/server/ingestion/spartan.test.ts
bun run soak:sources -- --sources=spartan --max-pages=166 --cycles=1
```

The soak writes local state only. Retain failed captures and the last valid
checkpoint. Do not publish partial inventory or lower quality guards to accept it.
