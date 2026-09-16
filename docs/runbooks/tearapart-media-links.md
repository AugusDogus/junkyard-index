# Tear-A-Part inventory links and photos

Verified 2026-09-16 against live public pages, JavaScript, search responses, and
fresh Chromium sessions named `audit-tearapart`. Baseline `b79e8ba` matched
`origin/main` and the remote main SHA during the audit. No database/index writes.

## Result and remaining limitation

Tear-A-Part's public inventory UI does **not** support the `?stock=` links we
generated. No supported persistent yard/make/model URL was found either. The
repair removes the invented stock parameter and returns
<https://tearapart.com/inventory/>. **This is an unfiltered search entry point,
not a vehicle deep link or a completed persistent-filter fix.** A customer must
select their yard, make, and model and submit the search.

All 1,660 current Utah API records supplied the same missing-photo marker:

<https://tearapart.com/inventory-photos/resized-images/coming-soon-150x113.png>

Opening that URL returned `404 Not Found` (nginx), and the actual inventory
table images had `naturalWidth = 0`. The transform now returns `imageUrl: null`
for this exact marker. It still extracts other supplied image URLs and preserves
VINs, stock numbers, rows, arrival dates, yard metadata, and eligibility.

## Navigation evidence

The public script is:

<https://tearapart.com/wp-content/plugins/tap-inventory-search-system/assets/frontend/js/sif_plugin-frontend-main.js>

Its initialization fetches `sif_get_stores`, `sif_get_locations`, and
`sif_get_makes`, then disables the model selector. It never reads URL search
parameters or a fragment. Changing the make calls `sif_update_models`.
Submitting the form serializes its fields and POSTs `sif_search_products` to
`/wp-admin/admin-ajax.php`, with the page's current nonce. The request fields are
`sif_form_field_store`, `sif_form_field_make`, and `sif_form_field_model`.
Rendering a result creates text cells and the supplied image anchor, with no
vehicle detail anchor or history update.

Fresh browser observations, after closing the session before each navigation:

- `https://tearapart.com/inventory/?stock=STK240556`
- `https://tearapart.com/inventory/?stock=STK100712`
- `https://tearapart.com/inventory/?stock=STK101501&sif_form_field_store=OGDEN&sif_form_field_make=CHRYSLER&sif_form_field_model=TOWN%20%26%20COUNTRY`
- `https://tearapart.com/inventory/` (repaired output)

All four loaded SALT LAKE CITY / Any / Any, with the model selector disabled
and zero result rows.

The requested stocks were absent from the initial page text. Manually selecting
SALT LAKE CITY / GMC / K1500 and submitting returned the single `STK240556`
row, without changing the URL. This proves the API's filtering works but is not
restored by URL navigation. No guessed filter parameters or expiring AJAX nonce
are persisted in the repaired link.

Other published surfaces checked:

- `/used-auto-parts/inventory/` redirects to `/inventory/`.
- `/testinventory/`, listed in `/page-sitemap.xml`, renders the same TAP form.
- `/new-arrivals/` embeds `/new-arrivals.php`, a last-72-hours table, not the
  complete inventory. Its images were empty or coming-soon placeholders. Its
  complete-inventory link redirects to `/inventory/`.
- `/just-in-ogden/` contains an empty iframe `src`, not a vehicle search route.
- The loaded `gm_inventory_search/front-end/js/vehicle-search.js` also uses
  AJAX submission, with no URL restoration contract for this inventory form.

## Representative live vehicles

These rows were verified in the provider API and rendered inventory table.
Every listed row's only anchor was the broken image marker above. Before the
repair, each canonical details URL was
`https://tearapart.com/inventory/?stock=<stock>`; afterwards each is
`https://tearapart.com/inventory/`, with `imageUrl: null`.

| Yard           | Stock     | VIN               | Vehicle                      | Row |
| -------------- | --------- | ----------------- | ---------------------------- | --- |
| Salt Lake City | STK240556 | TKL146F733021     | 1976 GMC K1500               | 35  |
| Salt Lake City | STK240521 | CCL449F314433     | 1979 Chevrolet C10           | 35  |
| Salt Lake City | STK240680 | JHMSM5337BC041578 | 1981 Honda Accord            | 46  |
| Ogden          | STK100558 | GAN5UD133730G     | 1973 MG Midget               | 57  |
| Ogden          | STK100712 | 1332143841        | 1973 Volkswagen Beetle       | 57  |
| Ogden          | STK101501 | 2C8GP44G41R108958 | 2001 Chrysler Town & Country | 77  |

All current Utah stocks matched `STK` followed by digits. Tests additionally
cover the explicitly synthetic `STK/001 A&B?#` and empty stock values, plus
missing metadata and supplied non-placeholder image markup. Special-format
stock support is test coverage, not a claim about observed live vehicles.

## Nebraska sibling

The repair intentionally leaves Nebraska's transformation unchanged, including
its current links and image extraction. A full canonical-object regression
uses live Lincoln stock `LCN062459`, VIN `1FAHP34321W208275`, Ford Focus,
row 403, arrival `2026-08-03T10:26:45.860`.

Read-only streaming still completed all four stores, cursor 4, 2,536 vehicles,
zero errors: Lincoln 867, Omaha North 416, Omaha South 438, Des Moines 815.
Samples included Lincoln `LCN062049` / `GHN5UB242727G`, `LCN061999` /
`J8A18NP002117`, and `LCN062168` / `1C3BC55E1ES102332`.

Unchanged does **not** mean Nebraska's existing media/link behavior is healthy:
its legacy TAP API also supplies a missing-photo URL that returns a not-found
page. The current public `/search-inventory/` page now renders YardConnect,
whose GET form uses `location`, `make`, `model`, `year_start`, and `year_end`.
The inventory includes different stock identifiers and YardSmart image URLs.

Fresh navigation to
<https://upullitne.com/search-inventory/?location=Lincoln&make=FORD&model=FOCUS>
rendered 19 Lincoln Ford Focus results. The yard selector showed Lincoln, but
the case-sensitive make/model selectors were blank despite the filtered rows.
Its first two image records used stock IDs `000000007987` and `000000007865`,
not the TAP `LCN...` identifiers. This is a separate source-contract migration;
do not join those images to TAP vehicles by make/model alone. Parent follow-up
is required before claiming Nebraska's current website contract is supported.

## Verification

- Red regression: 4 failing transform tests on the unchanged implementation.
- TAP transform/client/connector tests: 16 passed, 0 failed.
- `bun run check`: lint and typecheck passed.
- `bun test src`: 765 passed, 0 failed.
- Live read-only Utah stream: complete, cursor 2, 818 + 842 = 1,660 vehicles,
  zero errors and no retained broken-photo markers.
- Browser session closed after verification.

The persistent-filter acceptance criterion remains blocked by the observed
provider contract. This patch is an honest fallback and missing-photo repair,
not evidence that the vendor supports stock or URL-persisted filtering.
