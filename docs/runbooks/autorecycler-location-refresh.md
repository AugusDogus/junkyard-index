# AutoRecycler owned location refresh

Yard geography must come from the yard's own organization or website record.
Inventory GPS can name the requested organization while pointing to its parent
yard. Parent and partner relationships do not establish physical-yard ownership.

Organization references have the form `<digits>__LOOKUP__<digits>x<digits>`.
The resolver requests the bare record ID after `__LOOKUP__` with `mget`, then
checks the returned organization identity and type. Bare and full lookup IDs
are accepted in responses. If needed, an exactly owned website address or an
exact organization row in details `init/data` can supply the location. Inventory
GPS and vehicle SEO descriptions are never used for yard geography or names.

## Source ownership

Pull-A-Part and U-Pull-&-Pay inventory comes from the direct `pullapart` connector.
AutoRecycler's mirrored operator is organization `1761169592468x394558876247902400`.
The connector checks each organization's current parent reference before using
cached geography. That organization and its children emit neither canonical
vehicles, yard metadata, nor observed VINs. Names and partner lists do not establish
ownership. Ownership decisions are cached within a chunk and rechecked next chunk.
Missing organization records remain unresolved; failed or malformed ownership
responses fail the page without emitting its inventory.

The September 19 audit found all 35 direct operator locations already published.
For six audited yards, all 6,964 live direct VINs matched published inventory.
Only one of 4,879 AutoRecycler mirror VINs remained in the live direct feed, and
none of the mirrors was published under AutoRecycler. All 35 mirrored organizations'
latest arrivals were October 21–22, 2025. Do not recover coordinates for these stale
copies or let their observations keep vehicles available after the direct feed
removes them.

Migration `0009_autorecycler_geo_provenance.sql` adds `resolution_version` with
default `0`, leaving existing data intact. The resolver rechecks every legacy
cache row, including those with populated cities. Only an owned address with a
non-placeholder city is persisted at version `1`. Subsequent resolver instances
reuse that verified cache. Blank or `Unknown` cities are refreshed at any version.

City comes from structured geographic components or the organization's city
field, never the first segment of a street address. A successful refresh replaces
the cached name with the owned record's name, so prior wrong-branch names can also
be corrected. Normal ingestion updates yard metadata and reconciles vehicle
geography into the search index. Apply the migration before running the repaired
ingestion code. No direct production data patch or hardcoded yard list is needed.

An unresolved location skips only that organization's canonical vehicle updates.
Its valid observed VINs preserve existing inventory through checkpoint and
reconciliation; known yards continue, and warnings identify unresolved yards.
The unresolved result is cached only within the chunk and retried next chunk/run.
Existing geographic and yard metadata is not overwritten by an unresolved result.

Malformed AutoRecycler responses, identity mismatches, source transport failures,
and persistence failures still fail the chunk. These failures never mark cached
geography verified. Previously published inventory is preserved.

The public catalog also contains identifiable inventory entries without VINs
(confirmed in both search and inventory-detail records). The VIN-keyed catalog
cannot represent them, so they are counted as explicit exclusions and emit no
observations. Nonempty invalid VINs and malformed records remain rejections.
Minimum inventory, drift, duplicate, and rejection limits remain unchanged.

Validation must traverse the complete provider feed and run source validation,
not start from the organizations already published in the homepage directory.

## Reproduction receipt

Confirmed on Linux, Bun 1.4.1, against `origin/main` at
`103e7487f8601d600d1114f04de3882e66decc7e` using public provider reads:

- Organization: `1348695171700984260__LOOKUP__1726602417880x199387504054651780`
- Inventory seed: `1787737161109x728407258643232400`
- Seed `mget`: `custom.inventory`, organization parser returned `null`.
- Details fallback: Columbus name, Atlanta city, `(33.7877874, -84.4842809)`,
  `1172 Field Rd NW, Atlanta, GA 30318, USA`.
- Bare organization `mget`: `custom.organization`, Columbus city,
  `(32.44405100000001, -84.9404565)`, `3843 Aldridge Rd, Columbus, GA 31903, USA`.

The focused ownership regression failed four tests before the repair: bare ID
without self-partner membership, parent ownership, partner ownership, and
inventory GPS rejection. All five ownership tests pass after the repair. Cache
tests decrypt the actual outgoing request to assert the bare organization ID,
then verify legacy populated-city repair, persisted provenance, cache reuse,
fallback shapes, migration preservation, and provider/write failure preservation.

```sh
bun test src/server/ingestion/autorecycler-geo-ownership.test.ts src/server/ingestion/autorecycler-geo-cache.test.ts src/server/ingestion/autorecycler-geo.test.ts
bun test src/server/migration-chain.test.ts
bun run check
bun test src
```
