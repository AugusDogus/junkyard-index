# U Pull It Davie ingestion

`upullitdavie` reads one yard (U Pull It Davie, Davie, FL) from the site's JSON
inventory API, `https://upullitdavie.com/api/inventory/search?page=N`.

## Transport

Since August 2026 the API is read from inside a remote browser, not from the
deployment's egress. Each chunk opens one browser under the provider's
cross-source [session lease](hyperbrowser-sessions.md#session-lease),
navigates to `/inventory` and waits for network idle (the page loads every
subresource; nothing is routed), then requests each catalog page with an
in-page same-origin `fetch` (`Accept: application/json`, no cache, 30-second
timeout), six at a time in groups of 24. The browser disconnects and the
session stops when the chunk ends, before the lease is released, on success,
failure or interruption.

Since November 23, 2026 the browser is a Kernel browser (`BROWSER_PROVIDERS`
in `browser-providers.ts`; stealth, headless, direct egress), as for Big D,
Northwest and Vander Haags ([browser providers](browser-providers.md)).
Hyperbrowser (stealth, accepted cookies, `us-west`, no proxy, no CAPTCHA
solving) remains the one-line fallback. A busy lease, a full plan or a Kernel
spending cap defers the chunk; waiting for the lease does not spend the
chunk's four-minute work deadline.

## Completeness checks

- The first page fixes the catalog: total pages, total count and page size.
  An empty catalog, more than 2,000 pages, or a count that does not fill the
  stated pages fails the read.
- Every page must be the page requested, repeat the first page's totals and
  page size, and hold exactly the expected number of records.
- A complete read must have processed exactly the stated total, and any
  record without a VIN, model or positive year fails the
  read instead of being dropped. A resumed cursor must match the catalog.
- Duplicate VINs are emitted once.

## Measured

| Read                                        | Pages | Vehicles | Browser-seconds |     Cost |
| ------------------------------------------- | ----: | -------: | --------------: | -------: |
| Kernel count-only soak, Nov 23 23:30 UTC    |   120 |    1,436 |             4.9 | $0.00008 |
| Production (Hyperbrowser), Nov 23 07:00 UTC |   121 |    1,446 |               - |        - |

The production catalog had moved between 1,414 and 1,446 vehicles over the
previous week; the soak's 10-vehicle drop is the same yard 16 hours later.
