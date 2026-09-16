# AutoRecycler incomplete location refresh

Cached cities that are blank or `Unknown` are no longer reusable location data.
The next ingestion resolves that organization through its existing organization,
website, and vehicle-details lookups until it finds a non-placeholder city.
Complete cached cities retain the existing cache behavior.

City comes from structured geographic components or the organization city field.
The first segment of a formatted address is often a street, so it is not used as
a city. During a cache repair, preserve the existing organization display name:
vehicle SEO text can incorrectly name another branch.

A successful refresh persists the geographic data. Normal vehicle reconciliation
detects the changed city and queues the search-index update. No separate schema
migration or direct production patch is required. If a cached incomplete location
cannot be resolved, fail the source refresh without replacing its cache or
publishing another incomplete snapshot. Existing published inventory is preserved.

Verified September 16, 2026 using public AutoRecycler responses and an in-memory
SQLite cache seeded with `Unknown`: the Atlanta organization resolves and persists
`Atlanta`, `Georgia`, and `1172 Field Rd NW, Atlanta, GA 30318, USA`. The published
example VIN was `KNADE123666155428`. Production records were not modified.

```sh
bun test src/server/ingestion/autorecycler-geo-cache.test.ts src/server/ingestion/autorecycler-geo.test.ts
bun run check
```
