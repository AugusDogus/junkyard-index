# Idaho Falls iPull qualification

See the current [source flags and census floors](provider-coverage-go-live.md).

`idipull` is the self-service iPull by Intermountain Auto at 3015 N 15th E,
Idaho Falls, ID 83401, 208-524-4461. It is distinct from Intermountain's excluded
full-service URG catalog. Its existing registry, durable cursor, manual-search
destination and `ingestion-source-idipull` flag are retained. The source defaults
off. No production inventory, source flags or deployment changed.

## Fresh qualification

The November 16, 2026 census contains 568 unique stocks and 565 unique VIN strings.
The connector accepts 535 unique donors and rejects 33 observations (5.81%):
25 invalid VINs (seven fail only the modern check digit), two missing models and
all six rows in three conflicting repeated-VIN groups. No rows are excluded and
no identical duplicates occur. Valid structural VINs rejected for check digits,
incomplete metadata or ambiguity remain presence evidence only.

The existing duplicate policy rejects every conflicting copy of a VIN, including
copies with agreeing year/make/model but different stocks or rows. Stock numbers
never choose a winner. Exact repeated rows deduplicate subject to the unchanged
25% duplicate limit. Different VINs claiming one usable stock fail the snapshot.
Modern VINs must pass ISO 3779 check digits. The accepted 1973 Ford Mustang keeps
its native serial `8532970167`; no identity or missing model is reconstructed.

Three serial public GETs captured a fresh root, an opening inventory and an
independently fetched closing inventory. Acquisition used the same cross-process
`flock /tmp/jyi-urg-gate.lock` gate and timestamp `/tmp/jyi-urg-gate.last` as the URG
qualification, with at least 3.1 seconds between request starts. All three return
HTTP 200. Both inventory controls show `Updated: 11/16/26`; every parsed field and
row multiplicity agrees. The latest admitted arrival is November 13, 2026.

The prior November 11 census (555 accepted of 583 rows) is historical evidence.
The fresh saved replay supersedes its totals and applies check-digit validation.

## Ownership, enumeration and destinations

The official [root](https://ifipull.com/) calls the linked catalog its in-stock
vehicles, updated daily, and describes bringing tools to pull parts. Root and
inventory pages independently retain the yard's address, phone and exact native
Google Maps address link. The link's `!3d` / `!4d` business point is
43.523078, -112.006206. Its `@` viewport center is not the yard location.

One unfiltered [inventory GET](https://ifipull.com/inventory/) contains all nine
columns and every row. The inspected DataTables initializer paginates that HTML
locally, with no AJAX or server-side source. Changed initialization, filters,
pagination links, columns, labels or incomplete structure fail closed. The row
cap is 10,000 and the document/body bound is 4 MB.

No donor permalink is published. The destination remains the inventory page,
presented as a manual search by VIN or stock. No search parameters or donor URLs
are fabricated. Photos are absent and remain null. Native color, stock and row
are retained when usable. Qualification confirms arrival dates use MM/DD/YY in
the 2000s; valid dates at or before the report date become calendar-only
`availableDate` values. Invalid or future optional arrival dates remain null.

## Connector guards

A checkpoint fetches the root and two complete inventory controls serially through
the existing 1,600 ms request gate. The closing comparison includes the update
label, every native field and multiplicity, while allowing table row reordering.
All checks precede yard and vehicle callbacks. A failed callback returns no
completed cursor; resuming a strict `complete` cursor performs no requests.

Currency requires at least one admitted arrival in the preceding 60 days,
matching the existing addition-based freshness window used by AutoRecycler.
A current `Updated` label alone cannot revive stale inventory. Future report
labels, future arrivals and recent rejected donors cannot establish currency.
No old donor is removed merely because its individual arrival is old.

Only complete, unredirected HTTP 200 HTML from the verified routes is accepted.
Manual redirects, partial responses, wrong MIME, invalid UTF-8, inconsistent body
lengths, oversized responses and read failures block reconciliation. Each GET has
a combined 20-second request/body deadline, no automatic retry, and the catalog
has a two-minute total deadline. The absolute floor is 178 (535 / 3, rounded down).
The existing 10% rejection, 25% duplicate and 50% previous-run guards remain.

## Offline proof

`src/server/ingestion/fixtures/idipull-census.json.gz` retains all three raw public
responses, sanitized receipts and SHA-256 hashes. Request order in replay is root,
opening inventory, closing inventory; receipts preserve acquisition timestamps.
`idipull-replay.test.ts` runs the real connector, checks 568 stocks / 565 unique
VIN strings, emitted identities, rejected presence, arrival currency, coordinates,
destination and the shared source validation policy. Tests make no live requests.

```sh
bun test src/server/ingestion/idipull-*.test.ts
bun run lint
bun run typecheck
```
