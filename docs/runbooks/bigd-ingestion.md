# Big D Pick & Pull ingestion

See the current [source flags and census floors](provider-coverage-go-live.md).

`bigd` covers Big D Pick & Pull at 1296 E Iona Rd, Idaho Falls, ID 83401,
208-522-1100. The official contact page identifies the business as operating at
D & C Salvage's former location. Its inventory footer repeats that address and
phone. The source runs by default. `ingestion-source-bigd` pauses it when it serves false.

## Qualification and native scope

The November 16, 2026 census contains one complete server-rendered `#vehicles`
table with 295 unique native identities. Its exact DataTables initializer
paginates and searches the inline rows locally. There is no remote pagination,
AJAX inventory loading, active filter or per-donor destination. Unsupported
initializer changes, extra inventory continuations, duplicate tables, malformed
cells, ownership changes and truncated documents stop collection.

Both actual table passes agree on every row and field. Of 295 observations,
288 pass required native year/make/model and `inventoryVinWithCheckDigit`.
Seven are rejected (2.37%), with no exclusions or duplicates. Five have truncated
identities; two full VINs fail the check digit. No identity is repaired or decoded.
The two rejected full VINs remain presence evidence, yielding 290 observed
identifiers including accepted vehicles. Genuine pre-1981 serials follow the
existing shared identity rule.

The 96-vehicle floor is one third of the 288 accepted baseline. Required rejects
must remain at most 10% and identical duplicate observations at most 25% of raw
rows. Every conflicting copy of a native identity is quarantined. Final durable
source validation also requires the terminal cursor and at least 50% of the
preceding published, non-missing inventory count. The collector exposes the same
previous-count guard to count-only callers. Failed guards preserve prior inventory.

Native color and numeric yard row are optional. There is no stock number,
per-vehicle link or vehicle photograph. Those fields remain null. Native
MM/DD/YY arrivals do not establish a century or timezone and remain null in
canonical inventory. Search and alert surfaces offer a labeled manual search
of the inventory table by VIN, year/make/model and yard row.

The Census Public_AR_Current address match supplies 43.525879698073,
-112.007922057112. It is street-range interpolation on TIGER 119187563, right
side, 1220-1298 E Iona Rd. The contact page's map iframe queries **2396** rather
than the published **1296** and is deliberately not used as a yard coordinate.
The original geocoder response is saved.

## Transport and recovery

Qualification initially received Cloudflare HTTP 403 challenges. The verified
request contract is `JunkyardIndex/1.0`, `Accept: text/html`,
`Accept-Encoding: identity`, `Connection: close`, the native root Referer and
its public `__cf_bm` cookie. Browser headers and the default compression did not
qualify. Each chunk bootstraps the root once. Only that bootstrap may accept a
403 carrying both the explicit challenge header and the public session cookie.
It never supplies inventory or ownership evidence. The cookie remains in memory
and is never persisted in checkpoints or fixtures. There are no automatic retries.

A process-wide semaphore holds requests through response completion and a
four-second gap, including failures. Each request/body has a combined 25-second
deadline and 2 MiB limit. Inventory and ownership require unredirected, complete
HTTP 200 HTML at the exact requested destination. Partial content, invalid UTF-8,
Content-Length mismatch, MIME changes, redirects and blocks fail closed.

The cursor phases are `owner`, `catalog`, `closing-owner`, `closing` and
`complete`. Checkpoints bind the yard and qualification contract, preserve the
complete opening rows, enforce a 1 MiB serialized limit and verify their checksum.
No vehicle, presence, yard or accounting callback emits before the separately fetched closing owner page
and final closing table pass. Resume starts from the stored
phase, acquires a fresh public session and compares the complete retained table
before emission. Terminal resume performs no requests or callbacks.

Chunks permit 1-4 new evidence pages plus one session bootstrap, bounded to three
minutes. A normal full census costs five GETs; four one-page chunks cost eight.
`pagesProcessed` counts evidence pages, excluding the session bootstrap. A failed
transport, callback, quality or drift check returns no advanced checkpoint.
Preserve previous inventory and inspect the named page before restarting from
`BigdCursor.initial`. Never force reconciliation from a partial cursor.

## Saved evidence and verification

`src/server/ingestion/bigd-test-fixtures/native.json.gz` retains the production
collector's four separately acquired raw HTTP 200 bodies: opening owner, opening
table, closing owner and closing table. Opening responses are never substituted
for closing controls. `requests.json` records all 40 direct qualification HTTP
attempts: 25 Big D, 14 Busbee and one Census request. This includes the five-GET
production-client census and a three-GET resumed terminal check. The final saved
closing owner and table were reacquired in that order after tightening resume
freshness. One early curl attempt has only its response Date,
not a measured request interval. Requests were serial, paced at least 3.5 seconds
apart; the production collector uses a completed four-second gap.

Busbee's separate browser observation recorded one navigation and 37 resource
entries. These are browser performance observations, potentially including cache
hits, rather than a complete wire-request ledger. Browser tracking URLs, session
cookies and challenge tokens are not committed.

```sh
bun test src/server/ingestion/bigd-*.test.ts
bun run soak:sources -- --sources=bigd --cycles=1 --max-pages=4
```

The soak counts and discards inventory and writes no canonical data, database,
Blob, search or alert state. A smaller page cap returns a partial cursor without
admission. Tests run offline and cover saved replay, durable serialization,
resume and terminal idempotence, owner/table drift, strict enumeration, source
floor, rejection, duplicates, conflicting identities, previous-count retention,
optional-null fields, old serials and bounded transport.

## Busbee's Truck Parts: left out

The official account-488 TPI catalog at
<https://busbeetruckparts.com/trucks/> publishes 4107 Festival Trail Road,
Wagener, SC 29164 and 803-564-3228. The shared browser loaded it after ordinary
HTTP requests remained challenged. Its complete unfiltered single-page range is
`1-12 of 12`, with matching header/footer controls and twelve native cards.

Eight cards are `Complete` retail vehicles, excluded under the existing TPI
contract. Four are labeled `Salvage`. One of those, the 2017 Hino 338,
VIN `5PVNV8JV6H4S57197`, is explicitly a working box truck for sale at $29,800,
with a South Carolina salvage title. A salvage title alone does not make it a
dismantling donor. Only three plausible parts donors remain: the 2013 Isuzu NPR,
2014 Mitsubishi FEC92S and 2006 Hino 165. This cannot support a useful source
floor. No Busbee source or flag is registered, and the TPI parser is unchanged.
`busbee-qualification.json` preserves the page text, native card links, observed
range, condition facets and browser request counts. No missing VINs or new source
semantics were invented to admit this yard.
