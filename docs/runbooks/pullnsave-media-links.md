# Pull-N-Save media and outbound-link audit

Verified 2026-09-16 against public inventory, JavaScript, search endpoints, and a
fresh `agent-browser --session audit-pullnsave` browser session. No production
writes. Base revision: `b79e8ba`.

## Outcome

- Photos: the existing stock-qualified image builder is correct for the samples.
  No missing available first photo was reproduced. Added live-record projection
  tests and legacy/special-character identifier tests.
- Vehicle links: **blocked, not clean**. `/inventory/` is an empty search form,
  not a vehicle destination. No verified direct vehicle URL or persistent
  yard-and-vehicle filter was found. The generic fallback remains in production
  code because removing it safely also requires shared search/card changes.
- No runtime, request-count, eligibility, raw-accounting, checkpoint, or
  dependency changes are included in this audit commit.

## Photo contract

Public UI source:
<https://www.pullnsave.com/wp-content/plugins/pns-vehicle-search/front-end/assets/js/pns-inventory-functions.js?ver=1.0>

`populateDataTable` constructs image orders 1 through 4 using the complete API
`stockId`. Keep the yard suffix, for example `STK133376-1`. Neither the legacy
display stock `STK133376` nor internal `vehicleRno` `140065` identifies that photo:
both returned the same camera-icon placeholder.

All three samples below were loaded from fresh `/inventory/` navigations, selected
by year/make/model/yard, and verified with visible VINs and actual vehicle photos.
Their exact API records are in `src/server/ingestion/fixtures/pullnsave-media-samples.json`.

| Yard and vehicle                 | VIN               | Stock       | Order 1 bytes | Browser dimensions | Filtered result count |
| -------------------------------- | ----------------- | ----------- | ------------: | ------------------ | --------------------: |
| Salt Lake City, 2006 Honda Civic | JHMFA16896S005350 | STK133376-1 |        114339 | 200 x 200          |                     4 |
| Glendale, 2012 Nissan Versa      | 3N1BC1CP8CK249287 | STK072997-3 |         24629 | 500 x 500          |                     2 |
| Riverside, 2000 Honda Accord     | JHMCG6658YC022383 | STK164520-9 |        101220 | 200 x 200          |                     2 |

Exact photo URLs:

- <https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK133376-1/OrderId/1>
- <https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK072997-3/OrderId/1>
- <https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK164520-9/OrderId/1>

Orders 2, 3, and 4 also returned distinct image bodies for all three stocks.
All responses claimed `image/png`, but the Glendale response was JPEG bytes.
Do not reject a valid image solely for this provider's mislabeled content type.

Legacy positive control: VIN `WVWBD63B75P041155`, stock `STK091580-1`, 2005
Volkswagen Passat, Salt Lake City. The following URL rendered an actual damaged
silver car, 200 x 200, 96809 bytes:
<https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK091580-1/OrderId/1>.

Legacy negative control: VIN `1G1JF52F437297781`, stock `STK082202-1`, 2003
Chevrolet Cavalier. All four orders returned the same 200 x 200 camera icon:
<https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/STK082202-1/OrderId/1>.
It is HTTP 200, `image/png`, 3474 bytes, SHA-256
`77e3d56a6763faae23e1bd6d425aabc086cba7221556e28c131ed277ed3d7e4b`.
HTTP success and image decoding alone do not prove a vehicle photo exists.
The current transform does not download or classify placeholder bodies.

A read-only search returned 12282 records. None had a stock ID containing
characters outside letters, digits, and hyphens. Special-character encoding is
covered synthetically, not claimed as live-provider acceptance. Keep
`encodeURIComponent(stockId)` and do not substitute or strip identifiers.

## Outbound destination evidence

All three modern searches remained at <https://www.pullnsave.com/inventory/>.
Reloading that exact URL reset the year/make/model/yard controls and removed the
results. The image links open a lightbox; they are not vehicle-detail pages.

Rejected candidate:
<https://www.pullnsave.com/inventory/?pns_years=2006&pns_make=4&pns_model=CIVIC&pns_yard=1>
returned HTTP 200 but a fresh browser load had year `""`, make `""`, model `"0"`,
yard `["0"]`, zero rows, and no target VIN. These parameters must not be shipped.

The current form posts `pns_get_inventory_assets` to WordPress admin-ajax using
year/make/model/yard fields and a page nonce. Its JavaScript does not read URL
filters, save results in the URL, or provide a direct detail route.

Also inspected the public legacy script:
<https://www.pullnsave.com/wp-content/plugins/PnsV1_3.3/vehicle-search.js?ver=1.0>.
It supports `makes` and `models` on `/inventory-search/`, but reads the yard from
`select[name=store]`, which does not exist on that page. A `store` query parameter
is not consumed. Fresh browser results:

- <https://www.pullnsave.com/inventory-search/?makes=HONDA&models=CIVIC&store=1>
  displayed `JHMFA16896S005350`, but returned cross-yard Civic results. The
  `store=1` parameter did not scope the search.
- <https://www.pullnsave.com/inventory-search/?makes=NISSAN&models=VERSA>
  returned cross-yard Versa rows. `3N1BC1CP8CK249287` existed in a hidden
  paginated row, not the initial visible results.
- <https://www.pullnsave.com/inventory-search/?makes=HONDA&models=ACCORD>
  returned 206 cross-yard Accord rows, but omitted `JHMCG6658YC022383`, even though
  the current inventory displayed it. Clicking its page-21 control left page 1
  active in the audited browser session.

The legacy parser only replaces `+` and `%2F` in models, and does not decode
makes. A literal POST search for `CHRYSLER` / `TOWN & COUNTRY` returned records;
the URL-parser equivalent `TOWN %26 COUNTRY` did not. `LAND ROVER` worked in a
POST while `LAND+ROVER` did not. This is not a safe universal fallback.

## Integration blocker

Do not set only the provider's `detailsUrl` to null: `src/lib/search-vehicles.ts`
converts null to `""`, and `src/components/search/VehicleCard.tsx` unconditionally
renders `Link href={vehicle.detailsUrl}`. That creates a self-link instead of
an unavailable-link state. Shared files were outside this worker's scope.

The parent needs to decide and implement explicit support for unavailable
outbound destinations in the shared model/UI before clearing this generic URL.
A verified yard-and-vehicle permalink would also resolve the provider blocker,
but none was found in this audit. Do not label this provider fully fixed.

Browser evidence files retained outside the repository:
`/tmp/opencode/pullnsave-slc.png`, `/tmp/opencode/pullnsave-glendale.png`,
`/tmp/opencode/pullnsave-riverside.png`, `/tmp/opencode/pullnsave-legacy-photo.png`,
and `/tmp/opencode/pullnsave-placeholder.png`.
