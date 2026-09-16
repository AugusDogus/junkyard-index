# Provider photos and inventory links

Contracts below reflect September 16, 2026 read-only public-provider checks and
the current branch implementation. App browser QA used local fixtures. These
checks did not publish database, Algolia, or notification changes and do not
establish production deployment verification. Counts and timings are observations.

## Current capability

| Provider             | Vehicle photos                                                                           | Outbound destination                                                            |
| -------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| iPull-uPull          | Bulk public card galleries; 3,880 of 4,043 emitted vehicles had photos.                  | Persistent stock search plus yard/make/model filters; no dedicated detail page. |
| U Pull R Parts       | Per-stock public lookup; 3,017 of 3,311 had photos, 294 explicit empty lists.            | Manual inventory search; no verified persistent filter or detail URL.           |
| Pull-N-Save          | Correct stock-qualified image endpoint; some responses are HTTP 200 camera placeholders. | Manual inventory search; current form does not restore URL filters.             |
| Tear-A-Part          | All 1,660 sampled Utah records supplied a broken placeholder, now normalized to null.    | Manual inventory search; stock and filter query parameters are ignored.         |
| Wrench-A-Part        | Preserves API `photo`; real images verified across three yards.                          | Direct public `/vehicle-info/<VIN>` route.                                      |
| Washington U-Pull-It | Preserves published image sources, including relative URLs; placeholders become null.    | Persistent yard-and-VIN GET search; no dedicated detail page.                   |
| Parts Galore         | No salvage vehicle photos or photo metadata published; null is correct.                  | Manual inventory search; make/model selection is local page state.              |

## Destination and UI contract

- `VehicleDestination.resolve` in `src/lib/vehicle-destination.ts` is shared by
  vehicle cards, email alerts, and Discord embeds.
- Pull-N-Save, Tear-A-Part, U Pull R Parts, and Parts Galore emit null
  `detailsUrl`. The helper also overrides their older stored/queued generic or
  unsupported URLs with the verified inventory entry point.
- These fallbacks say **Search provider inventory**, explain selecting make/model
  and matching VIN/yard, and show the VIN. Cards provide **Copy VIN** with a
  selectable-text fallback on clipboard failure. They are not vehicle links.
- Wrench-A-Part says **View vehicle**; iPull-uPull and Washington say
  **View matching inventory**. Missing/invalid destinations for other sources
  show an unavailable state without an empty or self-link.
- Do not invent stock/filter parameters for manual-search providers. A successful
  page load or a lightbox is not evidence of a persistent vehicle destination.

## iPull-uPull enrichment

Primary runbook: [independent yard ingestion](independent-yard-ingestion.md).

- CSV has no image fields. Read HTML-encoded JSON `data-gallery` from public
  inventory cards; never substitute `data-parts` photos or Coming Soon artwork.
- Bulk requests use `ipull_inventory_pricing_perpage=96`,
  `ipull_inventory_pricing_sort=stock_number`, `ipull_inventory_pricing_order=asc`,
  and `ipull_inventory_pricing_page=N`. No per-vehicle request or nonce is needed.
- Require complete pages, stable totals, exact card counts, unique identities,
  and stock + VIN + yard coverage for every emitted vehicle, including legacy VINs.
  Explicit `data-gallery="[]"` retains a null image with a counted warning.
- Accept published same-origin optimized assets or stock-scoped original uploads.
  Unknown paths, malformed galleries, partial responses, missing coverage, or
  catalog drift fail before yard/vehicle callbacks, preserving prior images.
- Requests and retries share the one-per-second gate. Limits: 4 MiB per media
  page, 20,000 catalog assets, and a 300-second outer checkpoint deadline.
- Observed full run: 45 media pages, 51 total requests, 62.6 seconds; 4,043 emitted,
  3,880 photos and 163 empty galleries. Cursor `0` to `1` is atomic;
  `pagesProcessed: 1` counts that checkpoint, not HTTP pages. Batches remain 250.
- Links use `ipull_inventory_pricing_search=<stock>` with the provider's raw
  `ipull_inventory_pricing_filter[yard_city|make|model]` values. Without stock,
  retain the narrower yard/make/model search.

## U Pull R Parts enrichment and budget

Primary runbook: [U Pull R Parts ingestion](upullrparts-ingestion.md).

- POST URL-encoded data to `https://upullrparts.com/wp-admin/admin-ajax.php`:
  `action=doAaaApiCall&apiAction=getVehicleImages&stockID=<stock>`.
  Use `User-Agent: JunkyardIndex/1.0`.
- Success is `{ "success": 1, "images": [{ "fileName": "...jpg", "url": "..." }] }`.
  A successful empty list means no photo. Missing local stock stays null without
  a request; an upstream `invalid_stock` response is a failure, not no-photo data.
- Deduplicate lookups by stock. Require returned filename/stock agreement and
  exact `https://api.aaaparts.com/staticImages/<fileName>` URLs, at most 100 images.
  Prefer photo order `6, 3, 4, 1, 5, 2`. Timestamped filenames cannot be rebuilt;
  the separate CloudFront parts-photo builder does not describe vehicle photos.
- Photo requests have concurrency **8**, including retry slots, and do **not**
  use the catalog/make 1.5-second gate. Both use at most two retries, with no
  network-error retry or jitter. The gate still covers catalog/make retries.
- Catalog, make resolution, photos, and callbacks share the **600-second** outer
  deadline. Failed/malformed photo lookups abort before yard/vehicle callbacks.
  Timeout cannot return a terminal checkpoint; inspect the failure and retry `0`.
- Observed full run: **470.511 seconds**, 3,311 vehicles, 3,017 photos, 294 empty
  lists; 57 `getVehicles`, 1 `getMakes`, 56 `getModels`, 3,311 `getVehicleImages`.
  Peak photo concurrency was 8, with about 129 seconds left before the deadline.
  This is measured headroom, not a guarantee under slower upstream service.
- Preserve atomic cursor `0` to `1`, 250-row batches, make resolution, accounting,
  and yard eligibility. Do not publish a partial catalog to fit the budget.

## Other image boundaries and limitations

- **Pull-N-Save:** use the complete API `stockId`, including its yard suffix, in
  `https://app.pullnsaveapp.com/v1/Vehicles/Images/StockId/<encoded-stockId>/OrderId/1`.
  Keep `encodeURIComponent`; display stock and `vehicleRno` are not substitutes.
  The transform does not download/classify bodies. HTTP 200 and successful image
  decoding can still be a camera placeholder. Valid JPEGs may claim `image/png`.
  The legacy `/inventory-search/` has incomplete/cross-yard results and unsafe
  label decoding; it is not a supported persistent fallback.
- **Tear-A-Part:** normalize the exact published
  `https://tearapart.com/inventory-photos/resized-images/coming-soon-150x113.png`
  marker to null; it returned 404. Other supplied image URLs remain supported.
  Nebraska's sibling TAP feed is not covered by this repair: its current public
  site uses YardConnect with different stock IDs. Source migration remains a
  follow-up; never join its new images to TAP records by make/model alone.
- **Wrench-A-Part:** retain API `photo`, without extra media requests. Encode the
  normalized VIN in the public Vehicle Browser's detail route. Search-row modals
  do not persist state; `my.wrenchapart.com` links lead to notification sign-in.
- **Washington:** resolve relative/protocol-relative image `src` against inventory.
  Reject unsafe protocols, credentials, and encoded no-image placeholders. Do not
  infer CDN paths from yard codes or use CSS decoration as photos. Links use
  `/inventory/ANY/ANY/?k=1&id=<yard>&view=table&search=<VIN>`, without `pagenum`.
- **Parts Galore:** salvage `#alldata` contains neither stock IDs nor image/detail
  links. The separate retail used-car catalog cannot supply salvage photos without
  a verified identity join. Year/make/model similarity is insufficient.

## Recheck and recovery

1. Run the source's read-only soak from its primary runbook. Inspect counts,
   explicit no-photo results, request failures, and elapsed time against the bounds.
2. Generate canonical destinations from fresh provider records. Open them in a
   fresh browser and verify visible VIN/stock and yard, not hidden table text.
   Inspect image content and nonzero natural dimensions, not HTTP status alone.
3. For manual searches, select the provider controls and match VIN/yard. Reload
   to check whether filters actually persist before changing destination semantics.
4. Reproduce parser/media failures with captured fixtures. Fix the contract before
   retrying atomic sources from cursor `0`; do not weaken completeness or bounds.
5. Check local cards and alert output for photos, null images, matching-inventory
   labels, manual-search explanation, and Copy VIN success/failure. Keep local
   fixture QA distinct from public-provider checks and production verification.
